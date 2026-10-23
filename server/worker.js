// Servidor de salas no Cloudflare: um Worker que encaminha cada conexão para
// o Durable Object da sala. Só passam mensagens de controle; nenhum vídeo.
//
// As conexões usam a API de hibernação: sala parada não fica rodando, e o
// estado de cada pessoa vive no "attachment" do WebSocket.

import { DurableObject } from 'cloudflare:workers';
import { PRIVACY_HTML } from './privacy.js';

const MAX_PEERS = 8;
const MAX_MESSAGE_BYTES = 8 * 1024;
// Sala vazia continua existindo um tempo, para quem cair conseguir voltar.
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
// Tolerância para aceitar o horário (já convertido para o do servidor) que o cliente manda.
const MAX_CLOCK_SKEW_MS = 5000;
const NAME_MAX = 40;
const TEXT_MAX = 2048;
const ROOM_CODE = /^[A-Z0-9]{4,12}$/;

const normalizeCode = (code) => String(code || '').trim().toUpperCase();
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// Conexão que é recusada antes de chegar numa sala: aceita, avisa e fecha.
function rejectSocket(code) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ t: 'error', code }));
  server.close(1008, code);
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      const room = normalizeCode(url.searchParams.get('room'));
      if (!ROOM_CODE.test(room)) return rejectSocket('codigo-invalido');
      return env.ROOMS.getByName(room).fetch(request);
    }

    if (url.pathname === '/health') return Response.json({ ok: true });
    if (url.pathname === '/privacidade') {
      return new Response(PRIVACY_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('Vemo: servidor de salas no ar.\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

export class Room extends DurableObject {
  async fetch(request) {
    const code = normalizeCode(new URL(request.url).searchParams.get('room'));
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code, id: null, name: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Pessoas que já entraram na sala (conexões abertas que mandaram 'hello').
  members(except) {
    return this.ctx.getWebSockets().flatMap((ws) => {
      if (ws === except) return [];
      const att = ws.deserializeAttachment();
      return att?.id ? [{ ws, id: att.id, name: att.name }] : [];
    });
  }

  peerList(except) {
    return this.members(except).map(({ id, name }) => ({ id, name }));
  }

  broadcast(fromWs, msg) {
    const data = JSON.stringify(msg);
    for (const { ws } of this.members(fromWs)) {
      try {
        ws.send(data);
      } catch {
        // conexão caindo; o webSocketClose dela cuida do resto
      }
    }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    const reply = (m) => ws.send(JSON.stringify(m));
    const att = ws.deserializeAttachment();

    if (msg.t === 'ping') {
      reply({ t: 'pong', c: finite(msg.c), s: Date.now() });
      return;
    }

    if (msg.t === 'hello') {
      if (att.id) return;
      const created = await this.ctx.storage.get('created');
      if (!created && msg.create !== true) {
        reply({ t: 'error', code: 'sala-nao-encontrada' });
        return;
      }
      if (this.members(ws).length >= MAX_PEERS) {
        reply({ t: 'error', code: 'sala-cheia' });
        return;
      }
      if (!created) await this.ctx.storage.put('created', true);
      await this.ctx.storage.deleteAlarm();

      const id = crypto.randomUUID();
      const name = text(msg.name, NAME_MAX) || 'Alguém';
      ws.serializeAttachment({ ...att, id, name });
      const state = (await this.ctx.storage.get('state')) || null;
      reply({ t: 'welcome', room: att.code, you: id, peers: this.peerList(), state, s: Date.now() });
      this.broadcast(ws, { t: 'peer-joined', peer: { id, name }, peers: this.peerList() });
      return;
    }

    if (!att.id) return;

    if (msg.t === 'state') {
      const time = finite(msg.time);
      if (time === null || typeof msg.playing !== 'boolean') return;
      const now = Date.now();
      const clientAt = finite(msg.at);
      const state = {
        playing: msg.playing,
        time,
        // Se o cliente mandou o próprio carimbo (já convertido), usa ele:
        // elimina a latência cliente→servidor.
        at: clientAt !== null && Math.abs(clientAt - now) < MAX_CLOCK_SKEW_MS ? clientAt : now,
        mediaKey: text(msg.mediaKey, TEXT_MAX),
        url: text(msg.url, TEXT_MAX),
        title: text(msg.title, TEXT_MAX),
        hb: msg.hb === true,
        nav: msg.nav === true,
        from: att.id,
      };
      await this.ctx.storage.put('state', state);
      this.broadcast(ws, { t: 'state', ...state });
      return;
    }

    if (msg.t === 'buffering') {
      this.broadcast(ws, { t: 'buffering', on: msg.on === true, from: att.id });
    }
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {
      // já fechada
    }
    await this.leave(ws);
  }

  async webSocketError(ws) {
    await this.leave(ws);
  }

  async leave(ws) {
    const att = ws.deserializeAttachment();
    if (!att?.id) return;
    ws.serializeAttachment({ ...att, id: null });
    this.broadcast(ws, { t: 'peer-left', id: att.id, peers: this.peerList(ws) });
    if (this.members(ws).length === 0) await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
  }

  // Sala ficou vazia tempo demais: apaga tudo.
  async alarm() {
    if (this.members().length === 0) await this.ctx.storage.deleteAll();
  }
}
