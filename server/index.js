// Servidor de salas: só repassa mensagens de controle entre as pessoas.
// Nenhum vídeo passa por aqui.

const http = require('node:http');
const { WebSocketServer } = require('ws');
const { createRooms } = require('./rooms');

const MAX_MESSAGE_BYTES = 8 * 1024;
const NAME_MAX = 40;
const TEXT_MAX = 2048;

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function startServer({ port = 8787, host = '0.0.0.0', log = console.log } = {}) {
  const rooms = createRooms();

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Vemo: servidor de salas no ar.\n');
  });

  const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (ws) => {
    let room = null;
    let id = null;
    const send = (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    };
    const reply = (msg) => send(JSON.stringify(msg));

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'ping') {
        reply({ t: 'pong', c: finite(msg.c), s: Date.now() });
        return;
      }

      if (msg.t === 'hello') {
        if (room) return;
        const name = text(msg.name, NAME_MAX) || 'Alguém';
        const result = rooms.join(msg.room, { name, send }, { create: msg.create === true });
        if (result.error) {
          reply({ t: 'error', code: result.error });
          return;
        }
        ({ room, id } = result);
        reply({ t: 'welcome', room: room.code, you: id, peers: rooms.peerList(room), state: room.state, s: Date.now() });
        rooms.broadcast(room, id, { t: 'peer-joined', peer: { id, name }, peers: rooms.peerList(room) });
        log(`[${room.code}] ${name} entrou (${room.peers.size})`);
        return;
      }

      if (!room) return;

      if (msg.t === 'state') {
        const time = finite(msg.time);
        if (time === null || typeof msg.playing !== 'boolean') return;
        const state = {
          playing: msg.playing,
          time,
          at: rooms.stamp(finite(msg.at)),
          mediaKey: text(msg.mediaKey, TEXT_MAX),
          url: text(msg.url, TEXT_MAX),
          title: text(msg.title, TEXT_MAX),
          hb: msg.hb === true,
          nav: msg.nav === true,
          from: id,
        };
        room.state = state;
        rooms.broadcast(room, id, { t: 'state', ...state });
        return;
      }

      if (msg.t === 'buffering') {
        rooms.broadcast(room, id, { t: 'buffering', on: msg.on === true, from: id });
      }
    });

    ws.on('close', () => {
      if (!room) return;
      rooms.leave(room, id);
      rooms.broadcast(room, id, { t: 'peer-left', id, peers: rooms.peerList(room) });
      log(`[${room.code}] alguém saiu (${room.peers.size})`);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({ server, wss, port: server.address().port, close: () => new Promise((r) => { wss.close(); server.close(r); }) });
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  startServer({ port }).then(({ port }) => {
    console.log(`Servidor de salas ouvindo em ws://localhost:${port}`);
  });
}

module.exports = { startServer };
