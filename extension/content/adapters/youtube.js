// Módulo do YouTube: o player é um <video> comum, dá pra controlar direto.

(function (root) {
  const Vemo = (root.Vemo = root.Vemo || {});
  Vemo.adapters = Vemo.adapters || [];

  function videoId() {
    if (location.pathname !== '/watch') return null;
    return new URLSearchParams(location.search).get('v');
  }

  function video() {
    return document.querySelector('#movie_player video.html5-main-video') || document.querySelector('#movie_player video');
  }

  Vemo.adapters.push({
    id: 'youtube',
    matches: (loc) => /(^|\.)youtube\.com$/.test(loc.hostname),
    video,
    mediaKey() {
      const id = videoId();
      return id ? `youtube:${id}` : null;
    },
    canonicalUrl() {
      const id = videoId();
      return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : location.href;
    },
    title: () => document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, ''),
    isBlocked: () => !!document.querySelector('#movie_player.ad-showing'),
    getState() {
      const v = video();
      if (!v || v.readyState < 1) return null;
      return { playing: !v.paused, time: v.currentTime };
    },
    play() {
      const v = video();
      if (v) v.play().catch(() => {});
    },
    pause() {
      const v = video();
      if (v) v.pause();
    },
    seek(time) {
      const v = video();
      if (v) v.currentTime = time;
    },
  });
})(globalThis);
