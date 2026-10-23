const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer } = require('../server');

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.type === msg.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  const opened = new Promise((r) => ws.on('open', r));
  return {
    ws,
    opened,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(type) {
      const i = queue.findIndex((m) => m.t === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i < 0) return;
          waiters.splice(i, 1);
          reject(new Error(`timeout esperando ${type}`));
        }, 500);
      });
    },
  };
}

test('servidor de salas', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', log: () => {} });
  t.after(() => srv.close());

  const a = client(srv.port);
  const b = client(srv.port);
  await Promise.all([a.opened, b.opened]);

  await t.test('entrar numa sala que não existe falha', async () => {
    b.send({ t: 'hello', room: 'NAOEXISTE', create: false });
    assert.equal((await b.next('error')).code, 'sala-nao-encontrada');
  });

  await t.test('criar e entrar', async () => {
    a.send({ t: 'hello', room: 'abc123', name: 'Ana', create: true });
    const wa = await a.next('welcome');
    assert.equal(wa.room, 'ABC123');
    assert.equal(wa.state, null);

    b.send({ t: 'hello', room: 'ABC123', name: 'Beto', create: false });
    const wb = await b.next('welcome');
    assert.equal(wb.peers.length, 2);
    const joined = await a.next('peer-joined');
    assert.equal(joined.peer.name, 'Beto');
  });

  await t.test('estado vai para o outro, não volta como eco, e fica guardado', async () => {
    const at = Date.now();
    a.send({ t: 'state', playing: false, time: 42.5, at, mediaKey: 'youtube:x', url: 'https://www.youtube.com/watch?v=x', title: 'X' });
    const got = await b.next('state');
    assert.equal(got.playing, false);
    assert.equal(got.time, 42.5);
    assert.equal(got.at, at);
    await assert.rejects(a.next('state'));

    const c = client(srv.port);
    await c.opened;
    c.send({ t: 'hello', room: 'ABC123', name: 'Caio' });
    const wc = await c.next('welcome');
    assert.equal(wc.state.time, 42.5);
    c.ws.close();
    await a.next('peer-left');
  });

  await t.test('estado inválido é descartado', async () => {
    a.send({ t: 'state', playing: 'sim', time: 1 });
    a.send({ t: 'state', playing: true, time: 'x' });
    await assert.rejects(b.next('state'));
  });

  await t.test('carimbo de tempo absurdo é trocado pelo do servidor', async () => {
    a.send({ t: 'state', playing: true, time: 1, at: 1 });
    const got = await b.next('state');
    assert.ok(Math.abs(got.at - Date.now()) < 1000);
  });

  await t.test('buffering e saída', async () => {
    b.send({ t: 'buffering', on: true });
    const buf = await a.next('buffering');
    assert.equal(buf.on, true);
    assert.ok(buf.from);
    b.ws.close();
    const left = await a.next('peer-left');
    assert.equal(left.id, buf.from);
  });

  await t.test('ping devolve o relógio do servidor', async () => {
    a.send({ t: 'ping', c: 123 });
    const pong = await a.next('pong');
    assert.equal(pong.c, 123);
    assert.ok(Math.abs(pong.s - Date.now()) < 1000);
  });

  a.ws.close();
});
