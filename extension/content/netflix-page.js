// Roda dentro da página da Netflix (world MAIN) para usar o player interno.
// Recebe comandos do content script via postMessage.

(function () {
  function player() {
    try {
      const api = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = api.getAllPlayerSessionIds();
      const id = ids.find((s) => s.startsWith('watch')) || ids[0];
      return id ? api.getVideoPlayerBySessionId(id) : null;
    } catch {
      return null;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'vemo') return;

    const p = player();
    if (!p) return;
    if (msg.cmd === 'play') p.play();
    else if (msg.cmd === 'pause') p.pause();
    else if (msg.cmd === 'seek' && Number.isFinite(msg.value)) p.seek(msg.value);
  });
})();
