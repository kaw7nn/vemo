const test = require('node:test');
const assert = require('node:assert/strict');
const { createSync } = require('../extension/content/sync-core');

// Player falso que dispara os mesmos eventos que um <video> dispararia.
function setup({ key = 'youtube:abc', playing = false, time = 0, userActive = () => false } = {}) {
  let clock = 1_000_000;
  const now = () => clock;
  const sent = [];
  const player = { playing, time, blocked: false, key, lastTick: clock };
  let sync;

  function advance(ms) {
    if (player.playing && !player.blocked) player.time += ms / 1000;
    clock += ms;
  }

  const adapter = {
    mediaKey: () => player.key,
    canonicalUrl: () => `https://www.youtube.com/watch?v=${player.key}`,
    title: () => 'Vídeo',
    isBlocked: () => player.blocked,
    getState: () => ({ playing: player.playing, time: player.time }),
    play() {
      player.playing = true;
      sync.onLocal('play');
    },
    pause() {
      player.playing = false;
      sync.onLocal('pause');
    },
    seek(t) {
      player.time = t;
      sync.onLocal('seeking');
      sync.onLocal('seeked');
    },
  };
  sync = createSync({ adapter, send: (m) => sent.push(m), now, userActive });

  // Ações do usuário: mudam o player e disparam o evento, como na vida real.
  const user = {
    play() {
      player.playing = true;
      sync.onLocal('play');
    },
    pause() {
      player.playing = false;
      sync.onLocal('pause');
    },
    seek(t) {
      player.time = t;
      sync.onLocal('seeking');
      sync.onLocal('seeked');
    },
  };

  return { sync, player, sent, user, advance, now: () => clock };
}

const states = (sent) => sent.filter((m) => m.t === 'state');

test('anunciar manda o estado atual com a marca de troca de vídeo', () => {
  const { sync, sent } = setup({ playing: true, time: 10 });
  sync.announce();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, 'state');
  assert.equal(sent[0].playing, true);
  assert.equal(sent[0].time, 10);
  assert.equal(sent[0].nav, true);
  assert.equal(sent[0].mediaKey, 'youtube:abc');
});

test('pausar aqui avisa a outra pessoa', () => {
  const { sync, sent, user, advance } = setup({ playing: true, time: 10 });
  sync.announce();
  advance(5000);
  user.pause();
  const last = states(sent).at(-1);
  assert.equal(last.playing, false);
  assert.ok(Math.abs(last.time - 15) < 0.01);
});

test('comando remoto é aplicado e não volta como eco', () => {
  const { sync, sent, player } = setup({ playing: true, time: 10 });
  sync.announce();
  sent.length = 0;
  sync.onRemote({ t: 'state', playing: false, time: 30, mediaKey: 'youtube:abc', ageMs: 0 });
  assert.equal(player.playing, false);
  assert.equal(player.time, 30);
  assert.equal(sent.length, 0);
});

test('play remoto compensa o atraso da mensagem', () => {
  const { sync, player } = setup({ playing: false, time: 0 });
  sync.announce();
  sync.onRemote({ t: 'state', playing: true, time: 100, mediaKey: 'youtube:abc', ageMs: 1500 });
  assert.equal(player.playing, true);
  assert.ok(Math.abs(player.time - 101.5) < 0.01);
});

test('diferença pequena não força pulo', () => {
  const { sync, player } = setup({ playing: true, time: 100.4 });
  sync.announce();
  sync.onRemote({ t: 'state', playing: true, time: 100, mediaKey: 'youtube:abc', ageMs: 0 });
  assert.equal(player.time, 100.4);
});

test('estado de outro vídeo é ignorado pelo núcleo', () => {
  const { sync, player } = setup({ playing: true, time: 5 });
  sync.announce();
  sync.onRemote({ t: 'state', playing: false, time: 50, mediaKey: 'youtube:outro', ageMs: 0 });
  assert.equal(player.playing, true);
  assert.equal(player.time, 5);
});

test('quando a outra pessoa trava, aqui espera; quando volta, continua', () => {
  const { sync, player, advance } = setup({ playing: true, time: 20 });
  sync.announce();
  advance(1000);
  sync.onRemote({ t: 'buffering', on: true, from: 'b' });
  assert.equal(player.playing, false);
  const pausedAt = player.time;
  advance(3000);
  sync.onRemote({ t: 'buffering', on: false, from: 'b' });
  assert.equal(player.playing, true);
  assert.ok(Math.abs(player.time - pausedAt) < 0.01);
});

test('se a pessoa que travou sai da sala, o vídeo continua', () => {
  const { sync, player } = setup({ playing: true, time: 20 });
  sync.announce();
  sync.onRemote({ t: 'buffering', on: true, from: 'b' });
  assert.equal(player.playing, false);
  sync.onRemote({ t: 'peer-left', id: 'b' });
  assert.equal(player.playing, true);
});

test('travar aqui avisa uma vez e destravar avisa de novo', () => {
  const { sync, sent, user } = setup({ playing: true, time: 20 });
  sync.announce();
  sent.length = 0;
  sync.onLocal('waiting');
  sync.onLocal('waiting');
  sync.onLocal('playing');
  assert.deepEqual(sent, [
    { t: 'buffering', on: true },
    { t: 'buffering', on: false },
  ]);
  user.pause();
  assert.equal(states(sent).at(-1).playing, false);
});

test('anúncio do YouTube conta como travado e retoma depois', () => {
  const { sync, sent, player, advance } = setup({ playing: true, time: 20 });
  sync.announce();
  sent.length = 0;
  player.blocked = true;
  sync.tick();
  assert.deepEqual(sent, [{ t: 'buffering', on: true }]);
  // Durante o anúncio os eventos do vídeo do anúncio não contam.
  sync.onLocal('pause');
  // Comando remoto durante o anúncio fica guardado.
  sync.onRemote({ t: 'state', playing: true, time: 60, mediaKey: 'youtube:abc', ageMs: 0 });
  assert.equal(player.time, 20);
  advance(5000);
  player.blocked = false;
  sync.tick();
  assert.deepEqual(sent.at(-1), { t: 'buffering', on: false });
  assert.equal(player.time, 60);
});

test('quem mexeu por último manda batimentos; quem segue corrige atraso grande', () => {
  const leader = setup({ playing: true, time: 0 });
  leader.sync.announce();
  leader.sent.length = 0;
  leader.advance(4100);
  leader.sync.tick();
  const hb = leader.sent.at(-1);
  assert.equal(hb.hb, true);

  const follower = setup({ playing: true, time: 0 });
  follower.sync.adopt({ playing: true, time: 0, mediaKey: 'youtube:abc', ageMs: 0 });
  follower.sync.onRemote({ ...hb, ageMs: 0 });
  assert.ok(Math.abs(follower.player.time - hb.time) < 0.01);
  follower.sent.length = 0;
  follower.advance(5000);
  follower.sync.tick();
  assert.equal(follower.sent.length, 0);
});

test('batimento com diferença pequena não pula', () => {
  const { sync, player } = setup({ playing: true, time: 50 });
  sync.adopt({ playing: true, time: 50, mediaKey: 'youtube:abc', ageMs: 0 });
  sync.onRemote({ t: 'state', hb: true, playing: true, time: 51.5, mediaKey: 'youtube:abc', ageMs: 0 });
  assert.equal(player.time, 50);
});

test('logo após abrir o vídeo da sala, o autoplay não manda na sala', () => {
  const { sync, sent, player, user, advance } = setup({ playing: false, time: 0 });
  sync.adopt({ playing: false, time: 80, mediaKey: 'youtube:abc', ageMs: 0 });
  assert.equal(player.time, 80);
  sent.length = 0;
  advance(500);
  user.play(); // autoplay da página
  assert.equal(player.playing, false);
  assert.equal(sent.length, 0);
  advance(3000);
  user.play(); // agora é o usuário de verdade
  assert.equal(states(sent).at(-1).playing, true);
});

test('pular para outro ponto avisa a outra pessoa', () => {
  const { sync, sent, user } = setup({ playing: true, time: 10 });
  sync.announce();
  sent.length = 0;
  user.seek(300);
  assert.equal(states(sent).at(-1).time, 300);
});

test('pular com o vídeo pausado avisa mesmo sem o evento de fim do pulo', () => {
  const { sync, sent, player } = setup({ playing: false, time: 3 });
  sync.announce();
  sent.length = 0;
  player.time = 120;
  sync.onLocal('seeking'); // 'seeked' não chega: trecho não carregado
  assert.equal(states(sent).length, 1);
  assert.equal(states(sent)[0].time, 120);
});

test('pulo completo (seeking + seeked) gera uma mensagem só', () => {
  const { sync, sent, user } = setup({ playing: true, time: 10 });
  sync.announce();
  sent.length = 0;
  user.seek(200);
  assert.equal(states(sent).length, 1);
});

test('pulo vindo da outra pessoa não volta como eco', () => {
  const { sync, sent, player } = setup({ playing: false, time: 10 });
  sync.announce();
  sent.length = 0;
  sync.onRemote({ t: 'state', playing: false, time: 500, mediaKey: 'youtube:abc', ageMs: 0 });
  assert.equal(player.time, 500);
  assert.equal(sent.length, 0);
});

test('clique de verdade logo após abrir o vídeo vale (não é autoplay)', () => {
  let active = false;
  const { sync, sent, player, user, advance } = setup({ playing: false, time: 0, userActive: () => active });
  sync.adopt({ playing: false, time: 80, mediaKey: 'youtube:abc', ageMs: 0 });
  sent.length = 0;
  advance(500);
  active = true;
  user.play();
  assert.equal(player.playing, true);
  assert.equal(states(sent).at(-1).playing, true);
});
