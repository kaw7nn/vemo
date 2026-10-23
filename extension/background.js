// Background (service worker): segura a conexão com o servidor de salas,
// conversa com a aba sincronizada e com o popup, e troca de vídeo quando a
// outra pessoa troca.

const DEFAULT_SERVER = 'wss://vemo.kawannmarcelo7.workers.dev';
const PING_MS = 15000; // também mantém o service worker vivo
const ANNOUNCE_WINDOW_MS = 8000; // logo após trocar de vídeo, ignoramos o vídeo antigo do outro lado
const NAV_GRACE_MS = 15000;
const ALLOWED_HOSTS = [/(^|\.)youtube\.com$/, /(^|\.)netflix\.com$/];

let session = null; // { room, name, server, tabId, create, joined }
let ws = null;
let connected = false;
let reconnectTimer = null;
let reconnectDelay = 1000;
let pingTimer = null;
let me = null;
let peers = [];
let lastError = null;
let lastState = null; // último estado da sala (com `at` no relógio do servidor)
let lastRoomMedia = null;
let localAnnounceAt = 0;
let navTarget = null;
let navAt = 0;
let clockOffset = 0;
let bestRtt = Infinity;

const ports = new Map(); // tabId -> port
// Registro das últimas mensagens, só em memória, para diagnosticar problemas.
const traceLog = [];
function trace(dir, msg) {
  traceLog.push(`${new Date().toISOString().slice(11, 23)} ${dir} ${JSON.stringify(msg).slice(0, 300)}`);
  if (traceLog.length > 200) traceLog.shift();
}
const tabMedia = new Map(); // tabId -> { mediaKey, url, title }

const serverNow = () => Date.now() + clockOffset;

// ---------- sessão ----------

async function settings() {
  const { name = '', server = DEFAULT_SERVER } = await chrome.storage.local.get(['name', 'server']);
  return { name, server };
}

function persist() {
  return chrome.storage.session.set({ session });
}

async function startSession({ room, create, tabId }) {
  await leave();
  const { name, server } = await settings();
  session = { room, name, server, tabId, create, joined: false };
  lastError = null;
  await persist();
  connect();
  notifyPopup();
}

async function leave() {
  if (!session) return;
  const tabId = session.tabId;
  session = null;
  await chrome.storage.session.remove('session');
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  ws = null;
  connected = false;
  me = null;
  peers = [];
  lastState = null;
  lastRoomMedia = null;
  navTarget = null;
  postToTab(tabId, { t: 'active', on: false });
  notifyPopup();
}

// ---------- servidor ----------

function connect() {
  clearTimeout(reconnectTimer);
  if (!session) return;
  let socket;
  try {
    // O código da sala vai no endereço: o servidor usa ele para achar a sala.
    const url = new URL(session.server);
    url.searchParams.set('room', session.room);
    socket = new WebSocket(url.href);
  } catch {
    lastError = 'servidor-invalido';
    leave();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    send({ t: 'hello', room: session.room, name: session.name, create: session.create || session.joined });
  };
  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    onServer(msg);
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    connected = false;
    clearInterval(pingTimer);
    if (!session) return;
    if (!session.joined) {
      lastError = lastError || 'sem-conexao';
      leave();
      return;
    }
    lastError = 'reconectando';
    notifyPopup();
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function ping() {
  send({ t: 'ping', c: Date.now() });
}

function onServer(msg) {
  if (msg.t !== 'pong') trace('srv→', msg);
  switch (msg.t) {
    case 'welcome': {
      const firstJoin = !session.joined;
      connected = true;
      me = msg.you;
      peers = msg.peers;
      lastError = null;
      reconnectDelay = 1000;
      session.joined = true;
      session.room = msg.room;
      persist();
      clearInterval(pingTimer);
      pingTimer = setInterval(ping, PING_MS);
      ping();
      postToTab(session.tabId, { t: 'active', on: true });
      postToTab(session.tabId, { t: 'clear-peers' });
      if (msg.state) onRemoteState(msg.state, { initial: firstJoin });
      else announceIfOnVideo();
      notifyPopup();
      break;
    }
    case 'state':
      onRemoteState(msg, { initial: false });
      break;
    case 'buffering':
      postToTab(session.tabId, msg);
      break;
    case 'peer-joined':
      peers = msg.peers;
      notifyPopup();
      break;
    case 'peer-left':
      peers = msg.peers;
      postToTab(session.tabId, msg);
      notifyPopup();
      break;
    case 'pong': {
      const t1 = Date.now();
      const rtt = t1 - msg.c;
      bestRtt *= 1.1; // deixa amostras novas substituírem as antigas aos poucos
      if (rtt <= bestRtt) {
        bestRtt = rtt;
        clockOffset = msg.s + rtt / 2 - t1;
      }
      break;
    }
    case 'error':
      lastError = msg.code;
      leave();
      break;
  }
}

function withAge(state) {
  return { ...state, ageMs: serverNow() - state.at };
}

function onRemoteState(state, { initial }) {
  if (!session || !state.mediaKey) return;
  const tabId = session.tabId;
  const media = tabMedia.get(tabId)?.mediaKey;

  if (state.mediaKey !== media) {
    if (serverNow() - localAnnounceAt < ANNOUNCE_WINDOW_MS) {
      // Acabamos de trocar de vídeo. Batimentos do vídeo antigo do outro lado
      // são ignorados; se os dois trocaram ao mesmo tempo, vale quem trocou antes.
      if (!state.nav || state.at >= localAnnounceAt) return;
    }
    lastState = state;
    lastRoomMedia = state.mediaKey;
    navigate(tabId, state);
    notifyPopup();
    return;
  }

  lastState = state;
  lastRoomMedia = state.mediaKey;
  const aged = withAge(state);
  postToTab(tabId, initial ? { t: 'adopt', state: aged } : { ...aged, t: 'state' });
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.some((re) => re.test(u.hostname)) ? u.href : null;
  } catch {
    return null;
  }
}

function navigate(tabId, state) {
  const url = safeUrl(state.url);
  if (!url) return;
  if (navTarget === state.mediaKey && Date.now() - navAt < NAV_GRACE_MS) return;
  navTarget = state.mediaKey;
  navAt = Date.now();
  chrome.tabs.update(tabId, { url }).catch(() => {});
}

function announceIfOnVideo() {
  if (tabMedia.get(session.tabId)?.mediaKey) postToTab(session.tabId, { t: 'announce' });
}

// ---------- aba (content script) ----------

function postToTab(tabId, msg) {
  const port = ports.get(tabId);
  if (!port) return;
  trace('→aba', msg);
  try {
    port.postMessage(msg);
  } catch {
    ports.delete(tabId);
  }
}

const isSyncTab = (tabId) => !!session && session.tabId === tabId;

function onContent(tabId, msg) {
  trace(`aba${tabId}→`, msg);
  if (msg.t === 'media') {
    tabMedia.set(tabId, { mediaKey: msg.mediaKey, url: msg.url, title: msg.title });
    if (!isSyncTab(tabId) || !connected || !msg.mediaKey) {
      notifyPopup();
      return;
    }
    const navigating = navTarget && Date.now() - navAt < NAV_GRACE_MS;
    if (msg.mediaKey === navTarget) navTarget = null;
    else if (navigating) return; // página intermediária durante a troca
    if (lastState && lastState.mediaKey === msg.mediaKey) postToTab(tabId, { t: 'adopt', state: withAge(lastState) });
    else postToTab(tabId, { t: 'announce' });
    notifyPopup();
    return;
  }

  if (!isSyncTab(tabId) || !connected) return;

  if (msg.t === 'state') {
    if (navTarget && Date.now() - navAt < NAV_GRACE_MS && msg.mediaKey !== navTarget) return;
    const at = serverNow();
    if (msg.nav || msg.mediaKey !== lastRoomMedia) localAnnounceAt = at;
    lastRoomMedia = msg.mediaKey;
    lastState = { ...msg, at, from: me };
    send({ ...msg, at });
    return;
  }

  if (msg.t === 'buffering') send({ t: 'buffering', on: msg.on === true });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'vemo' || !port.sender?.tab) return;
  const tabId = port.sender.tab.id;
  ports.set(tabId, port);
  port.onMessage.addListener((msg) => onContent(tabId, msg));
  port.onDisconnect.addListener(() => {
    if (ports.get(tabId) === port) ports.delete(tabId);
  });
  port.postMessage({ t: 'active', on: isSyncTab(tabId) && connected });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMedia.delete(tabId);
  if (isSyncTab(tabId)) leave();
});

// ---------- popup ----------

function notifyPopup() {
  chrome.runtime.sendMessage({ t: 'status-changed' }).catch(() => {});
}

async function status() {
  const { name, server } = await settings();
  return {
    inRoom: !!session,
    connected,
    room: session?.room ?? null,
    tabId: session?.tabId ?? null,
    me,
    peers,
    error: lastError,
    name,
    server,
    roomMedia: lastState ? { title: lastState.title, url: lastState.url } : null,
  };
}

function roomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  (async () => {
    switch (msg.t) {
      case 'status':
        break;
      case 'create':
        await startSession({ room: roomCode(), create: true, tabId: msg.tabId });
        break;
      case 'join':
        await startSession({ room: String(msg.code || '').trim().toUpperCase(), create: false, tabId: msg.tabId });
        break;
      case 'leave':
        lastError = null;
        await leave();
        break;
      case 'settings':
        await chrome.storage.local.set({ name: String(msg.name || '').slice(0, 40), server: String(msg.server || DEFAULT_SERVER).trim() });
        break;
      case 'clear-error':
        lastError = null;
        break;
    }
    reply(await status());
  })();
  return true;
});

// Service worker pode ter sido reiniciado: retoma a sala.
chrome.storage.session.get('session').then(({ session: saved }) => {
  if (saved && saved.joined && !session) {
    session = saved;
    connect();
  }
});
