const ERRORS = {
  'sala-nao-encontrada': 'Não achei essa sala. Confira o código e se vocês estão no mesmo servidor.',
  'sala-cheia': 'Essa sala já está cheia.',
  'codigo-invalido': 'Código inválido. Use só letras e números.',
  'sem-conexao': 'Não consegui falar com o servidor de salas. Ele está rodando?',
  'servidor-invalido': 'O endereço do servidor parece errado. Use ws://… ou wss://…',
  reconectando: 'Conexão caiu. Tentando reconectar…',
};

const $ = (id) => document.getElementById(id);
let current = null;

function ask(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function render(status) {
  current = status;
  $('error').hidden = !status.error;
  $('error').textContent = ERRORS[status.error] || status.error || '';

  $('out').hidden = status.inRoom;
  $('in').hidden = !status.inRoom;

  if (!$('name').matches(':focus')) $('name').value = status.name;
  if (!$('server').matches(':focus')) $('server').value = status.server;

  if (!status.inRoom) return;

  $('copy').textContent = status.room;
  $('connection').classList.toggle('on', status.connected);
  const others = status.peers.filter((p) => p.id !== status.me);
  $('connection').textContent = !status.connected
    ? 'Conectando…'
    : others.length === 0
      ? 'Esperando a outra pessoa entrar'
      : `Conectado com ${others.length === 1 ? '1 pessoa' : `${others.length} pessoas`}`;

  $('peers').replaceChildren(
    ...others.map((p) => {
      const li = document.createElement('li');
      li.textContent = p.name;
      return li;
    }),
  );

  $('media').hidden = !status.roomMedia?.title;
  $('media').textContent = status.roomMedia?.title ? `Assistindo: ${status.roomMedia.title}` : '';

  $('other-tab').hidden = status.tabId === (await activeTabId());
}

async function refresh() {
  render(await ask({ t: 'status' }));
}

$('create').addEventListener('click', async () => {
  render(await ask({ t: 'create', tabId: await activeTabId() }));
});

$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = $('code').value.trim();
  if (!code) return;
  render(await ask({ t: 'join', code, tabId: await activeTabId() }));
});

$('leave').addEventListener('click', async () => {
  render(await ask({ t: 'leave' }));
});

$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(current.room);
  $('copied').hidden = false;
  setTimeout(() => ($('copied').hidden = true), 1500);
});

$('go-tab').addEventListener('click', async () => {
  const tab = await chrome.tabs.update(current.tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  window.close();
});

$('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  render(await ask({ t: 'settings', name: $('name').value, server: $('server').value }));
  $('settings').open = false;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.t === 'status-changed') refresh();
});

refresh();
