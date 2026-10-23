// Liga o player da página ao núcleo de sincronização e ao background.

(function () {
  const Vemo = globalThis.Vemo;
  const adapter = (Vemo.adapters || []).find((a) => a.matches(location));
  if (!adapter) return;

  const POLL_MS = 500;
  const MEDIA_EVENTS = ['play', 'pause', 'seeking', 'seeked', 'waiting', 'playing', 'canplay'];

  let port = null;
  let active = false;
  let currentKey = null;

  const sync = Vemo.createSync({
    adapter,
    send: (msg) => post(msg),
    userActive: () => navigator.userActivation?.isActive === true,
  });

  function post(msg) {
    if (!port) return;
    try {
      port.postMessage(msg);
    } catch {
      port = null;
    }
  }

  function reportMedia() {
    post({ t: 'media', mediaKey: currentKey, url: currentKey ? adapter.canonicalUrl() : null, title: currentKey ? adapter.title() : null });
  }

  function connect() {
    try {
      port = chrome.runtime.connect({ name: 'vemo' });
    } catch {
      return; // extensão recarregada: este script ficou órfão
    }
    port.onMessage.addListener(onBackground);
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 1000);
    });
    reportMedia();
  }

  function onBackground(msg) {
    switch (msg.t) {
      case 'active':
        active = msg.on;
        sync.reset();
        if (!active) sync.clearPeers();
        break;
      case 'announce':
        if (active && currentKey) sync.announce();
        break;
      case 'adopt':
        if (active && currentKey && msg.state.mediaKey === currentKey) sync.adopt(msg.state);
        break;
      case 'clear-peers':
        sync.clearPeers();
        break;
      case 'state':
      case 'buffering':
      case 'peer-left':
        if (active && currentKey) sync.onRemote(msg);
        break;
    }
  }

  // O vídeo é identificado pela URL. O player pode ficar "vazio" por um
  // instante (ex.: ao pular para um trecho não carregado) sem que o vídeo
  // tenha mudado, então a prontidão só conta na primeira vez.
  let pageKey = null;

  setInterval(() => {
    const key = adapter.mediaKey();
    if (key !== pageKey) {
      pageKey = key;
      if (currentKey !== null) {
        currentKey = null;
        sync.reset();
        reportMedia();
      }
    }
    if (pageKey && currentKey === null && adapter.getState()) {
      currentKey = pageKey;
      reportMedia(); // o background responde com 'adopt' ou 'announce'
    }
    if (active && currentKey) sync.tick();
  }, POLL_MS);

  // Eventos de mídia não sobem na árvore, mas passam pela captura no document.
  for (const type of MEDIA_EVENTS) {
    document.addEventListener(
      type,
      (event) => {
        if (!active || !currentKey || event.target !== adapter.video()) return;
        sync.onLocal(type);
      },
      true,
    );
  }

  connect();
})();
