// Lógica das salas, separada do transporte para poder ser testada sem rede.
// Uma sala guarda quem está nela e o último estado do vídeo (play/pausa/posição).

const crypto = require('node:crypto');

const MAX_PEERS = 8;
// Sala vazia continua existindo um tempo, para quem cair conseguir voltar.
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
// Tolerância para aceitar o horário (já convertido para o do servidor) que o cliente manda.
const MAX_CLOCK_SKEW_MS = 5000;

const ROOM_CODE = /^[A-Z0-9]{4,12}$/;

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function createRooms({ now = Date.now } = {}) {
  const rooms = new Map();

  function cleanup() {
    const t = now();
    for (const [code, room] of rooms) {
      if (room.peers.size === 0 && t - room.emptySince > EMPTY_ROOM_TTL_MS) rooms.delete(code);
    }
  }

  function join(code, peer, { create }) {
    cleanup();
    code = normalizeCode(code);
    if (!ROOM_CODE.test(code)) return { error: 'codigo-invalido' };

    let room = rooms.get(code);
    if (!room) {
      if (!create) return { error: 'sala-nao-encontrada' };
      room = { code, peers: new Map(), state: null, emptySince: now() };
      rooms.set(code, room);
    }
    if (room.peers.size >= MAX_PEERS) return { error: 'sala-cheia' };

    const id = crypto.randomUUID();
    room.peers.set(id, { id, name: peer.name, send: peer.send });
    return { room, id };
  }

  function leave(room, id) {
    if (!room.peers.delete(id)) return null;
    if (room.peers.size === 0) room.emptySince = now();
    return room;
  }

  function broadcast(room, fromId, msg) {
    const data = JSON.stringify(msg);
    for (const peer of room.peers.values()) {
      if (peer.id !== fromId) peer.send(data);
    }
  }

  function peerList(room) {
    return [...room.peers.values()].map(({ id, name }) => ({ id, name }));
  }

  // Carimba o estado com o horário do servidor. Se o cliente mandou o próprio
  // carimbo (já convertido), usa ele: elimina a latência cliente→servidor.
  function stamp(clientAt) {
    const t = now();
    if (typeof clientAt === 'number' && Math.abs(clientAt - t) < MAX_CLOCK_SKEW_MS) return clientAt;
    return t;
  }

  return { join, leave, broadcast, peerList, stamp, rooms };
}

module.exports = { createRooms, normalizeCode, MAX_PEERS };
