// Núcleo da sincronização: decide quando avisar a outra pessoa e quando
// obedecer ao que veio dela. Não conhece YouTube nem Netflix; fala com o
// player por um "adapter" e com a rede por uma função `send`.
//
// Ideia central: guardamos o "estado da sala" (tocando/pausado + posição num
// instante). Um evento local só vira mensagem se deixar o vídeo diferente do
// que a sala espera. Assim, os eventos causados por comandos remotos não
// voltam como eco.

(function (root) {
  const SEEK_TOLERANCE_S = 1.0; // diferença que dispara correção num comando explícito
  const HEARTBEAT_TOLERANCE_S = 2.0; // diferença tolerada na correção periódica
  const CONSISTENT_SLACK_S = 0.5;
  const EXPECT_WINDOW_MS = 2000; // quanto tempo esperamos o evento de um comando nosso
  const SETTLE_MS = 3000; // após carregar um vídeo, eventos locais não mandam na sala
  const HEARTBEAT_MS = 4000;

  // `userActive` diz se houve clique/tecla recente: separa ação humana de autoplay.
  function createSync({ adapter, send, now = () => Date.now(), userActive = () => false }) {
    let room = null; // { playing, time, at } — `at` é o relógio local
    let leader = false; // quem fez a última mudança manda os batimentos
    let lastHeartbeat = 0;
    const peersBuffering = new Set();
    let localBuffering = false;
    let blocked = false; // ex.: anúncio do YouTube
    let settleUntil = 0;
    let deferredApply = false;
    const expected = new Map(); // tipo de evento -> prazo

    const stalled = () => localBuffering || blocked;
    const flowing = () => !!room && room.playing && peersBuffering.size === 0 && !stalled();
    const targetPlaying = () => !!room && room.playing && peersBuffering.size === 0;

    function expectedTime() {
      if (!room) return null;
      return room.time + (flowing() ? (now() - room.at) / 1000 : 0);
    }

    // Congela a posição esperada antes de mudar algo que afete `flowing()`.
    function rebase() {
      if (!room) return;
      room.time = expectedTime();
      room.at = now();
    }

    function setStall(change) {
      const before = stalled();
      rebase();
      change();
      const after = stalled();
      if (before !== after) send({ t: 'buffering', on: after });
    }

    function expect(type) {
      expected.set(type, now() + EXPECT_WINDOW_MS);
    }

    function consumeExpected(type) {
      const until = expected.get(type);
      if (until === undefined) return false;
      expected.delete(type);
      return until >= now();
    }

    function consistent(st) {
      if (!room) return false;
      return st.playing === targetPlaying() && Math.abs(st.time - expectedTime()) <= SEEK_TOLERANCE_S + CONSISTENT_SLACK_S;
    }

    function apply(tolerance) {
      if (!room) return;
      if (blocked) {
        deferredApply = true;
        return;
      }
      deferredApply = false;
      const st = adapter.getState();
      if (!st) return;
      // Play/pausa antes do pulo: assim os eventos do pulo já encontram o
      // player no estado certo e não parecem ação do usuário.
      const want = targetPlaying();
      if (st.playing !== want) {
        expect(want ? 'play' : 'pause');
        if (want) adapter.play();
        else adapter.pause();
      }
      const target = expectedTime();
      if (Math.abs(st.time - target) > tolerance) {
        expect('seeking');
        adapter.seek(target);
      }
    }

    function broadcast(st, extra) {
      send({
        t: 'state',
        playing: st.playing,
        time: st.time,
        mediaKey: adapter.mediaKey(),
        url: adapter.canonicalUrl(),
        title: adapter.title(),
        ...extra,
      });
    }

    // Este lado passa a definir o estado da sala (criou a sala ou trocou de vídeo).
    function announce() {
      const st = adapter.getState();
      if (!st) return;
      leader = true;
      settleUntil = 0;
      room = { playing: st.playing, time: st.time, at: now() };
      lastHeartbeat = now();
      broadcast(st, { nav: true });
    }

    // Acabou de abrir o vídeo que a sala está vendo: segue a sala.
    function adopt(state) {
      settleUntil = now() + SETTLE_MS;
      onRemote({ ...state, t: 'state' });
    }

    function onLocal(type) {
      if (adapter.isBlocked()) return; // eventos do vídeo do anúncio
      const st = adapter.getState();
      if (!st) return;

      if (type === 'waiting') {
        if (targetPlaying() && !localBuffering) setStall(() => (localBuffering = true));
        return;
      }
      if (type === 'playing' || type === 'canplay') {
        if (localBuffering) setStall(() => (localBuffering = false));
        return;
      }
      if (type === 'pause' && localBuffering) setStall(() => (localBuffering = false));
      // 'seeking' dispara na hora; 'seeked' pode nunca vir se o vídeo estiver
      // pausado num trecho não carregado (o YouTube só carrega no play).
      if (type === 'seeked') type = 'seeking';
      if (type !== 'play' && type !== 'pause' && type !== 'seeking') return;

      if (consumeExpected(type) || consistent(st)) return;
      if (now() < settleUntil && !userActive()) {
        apply(SEEK_TOLERANCE_S);
        return;
      }

      leader = true;
      room = { playing: st.playing, time: st.time, at: now() };
      lastHeartbeat = now();
      broadcast(st);
    }

    function onRemote(msg) {
      if (msg.t === 'state') {
        if (msg.mediaKey && msg.mediaKey !== adapter.mediaKey()) return;
        leader = false;
        const ageS = Math.max(0, msg.ageMs || 0) / 1000;
        room = { playing: msg.playing, time: msg.time + (msg.playing ? ageS : 0), at: now() };
        apply(msg.hb ? HEARTBEAT_TOLERANCE_S : SEEK_TOLERANCE_S);
        return;
      }
      if (msg.t === 'buffering') {
        rebase();
        if (msg.on) peersBuffering.add(msg.from);
        else peersBuffering.delete(msg.from);
        apply(SEEK_TOLERANCE_S);
        return;
      }
      if (msg.t === 'peer-left') {
        if (!peersBuffering.has(msg.id)) return;
        rebase();
        peersBuffering.delete(msg.id);
        apply(SEEK_TOLERANCE_S);
      }
    }

    // Chamado periodicamente: detecta anúncio e manda batimentos.
    function tick() {
      const isBlocked = adapter.isBlocked();
      if (isBlocked !== blocked) {
        setStall(() => (blocked = isBlocked));
        if (!blocked && deferredApply) apply(SEEK_TOLERANCE_S);
      }
      if (!leader || !room || blocked || now() - lastHeartbeat < HEARTBEAT_MS) return;
      const st = adapter.getState();
      if (!st || !st.playing) return;
      lastHeartbeat = now();
      room = { playing: st.playing, time: st.time, at: now() };
      broadcast(st, { hb: true });
    }

    // Vídeo trocou ou a sincronização foi desligada.
    function reset() {
      room = null;
      leader = false;
      localBuffering = false;
      blocked = false;
      settleUntil = 0;
      deferredApply = false;
      expected.clear();
    }

    function clearPeers() {
      rebase();
      peersBuffering.clear();
    }

    return { announce, adopt, onLocal, onRemote, tick, reset, clearPeers, _debug: () => ({ room, leader, peersBuffering: [...peersBuffering], localBuffering, blocked }) };
  }

  const api = { createSync };
  root.Vemo = Object.assign(root.Vemo || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
