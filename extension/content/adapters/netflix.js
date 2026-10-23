// Módulo da Netflix. Mexer em `video.currentTime` quebra o player deles
// (erro M7375), então os comandos vão para o player interno da Netflix,
// que só é acessível pelo script da página (netflix-page.js).

(function (root) {
  const Vemo = (root.Vemo = root.Vemo || {});
  Vemo.adapters = Vemo.adapters || [];

  function titleId() {
    const m = location.pathname.match(/^\/watch\/(\d+)/);
    return m ? m[1] : null;
  }

  function video() {
    return document.querySelector('.watch-video video') || document.querySelector('video');
  }

  function command(cmd, value) {
    window.postMessage({ source: 'vemo', cmd, value }, location.origin);
  }

  Vemo.adapters.push({
    id: 'netflix',
    matches: (loc) => /(^|\.)netflix\.com$/.test(loc.hostname),
    video,
    mediaKey() {
      const id = titleId();
      return id ? `netflix:${id}` : null;
    },
    canonicalUrl() {
      const id = titleId();
      return id ? `https://www.netflix.com/watch/${id}` : location.href;
    },
    title: () => document.title.replace(/\s*\|\s*Netflix$/, '').replace(/^Netflix$/, '') || 'Netflix',
    isBlocked: () => false,
    getState() {
      const v = video();
      if (!v || v.readyState < 1) return null;
      return { playing: !v.paused, time: v.currentTime };
    },
    play: () => command('play'),
    pause: () => command('pause'),
    seek: (time) => command('seek', Math.round(time * 1000)),
  });
})(globalThis);
