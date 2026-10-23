// Gera as imagens da Chrome Web Store em store/:
//   screenshot-1.png e screenshot-2.png (1280x800) e promo-440x280.png.
// O popup é renderizado de verdade, com dados de exemplo no lugar da extensão.
// Uso: node scripts/store-assets.js   (CHROME=/caminho para outro navegador)

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'store');
const CHROME = process.env.CHROME || '/usr/bin/chromium';

const STATUS_OUT = { inRoom: false, connected: false, error: null, name: 'Ana', server: '', peers: [] };
const STATUS_IN = {
  inRoom: true,
  connected: true,
  room: 'K7QM2P',
  tabId: 1,
  me: 'a',
  peers: [
    { id: 'a', name: 'Ana' },
    { id: 'b', name: 'Beto' },
  ],
  error: null,
  name: 'Ana',
  server: '',
  roomMedia: { title: 'Documentário da noite' },
};

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Inter:wght@400;500&display=swap" rel="stylesheet">`;

async function popupShot(browser, status) {
  const page = await browser.newPage();
  await page.setViewport({ width: 300, height: 600, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((status) => {
    const stub = {
      runtime: { sendMessage: async () => status, onMessage: { addListener() {} } },
      tabs: { query: async () => [{ id: 1 }], update: async () => ({}) },
      windows: { update: async () => {} },
    };
    Object.defineProperty(window, 'chrome', { value: stub, configurable: true });
  }, status);
  await page.goto(`file://${path.join(ROOT, 'extension/popup/popup.html')}`);
  await page.waitForFunction(() => !document.getElementById('out').hidden || !document.getElementById('in').hidden);
  const body = await page.$('body');
  const png = await body.screenshot({ encoding: 'base64' });
  await page.close();
  return `data:image/png;base64,${png}`;
}

const base = `
  :root { --bg: #16131f; --surface: #211d2c; --line: #342e42; --text: #f5efe6; --muted: #a69fb4; --accent: #ff6b4a; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; background: var(--bg); color: var(--text); font-family: Inter, sans-serif; }
  .eyebrow { display: flex; align-items: center; gap: 10px; font: 500 15px Inter; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  h1 { font: 700 60px/1.04 'Bricolage Grotesque'; letter-spacing: -0.02em; }
  p.sub { font: 400 20px/1.5 Inter; color: var(--muted); }
  .popup { border-radius: 14px; border: 1px solid var(--line); box-shadow: 0 30px 80px rgba(0,0,0,.45); display: block; }
`;

function screenshot1(icon, popOut, popIn) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${base}
    .wrap { display: grid; grid-template-columns: 470px 1fr; gap: 56px; align-items: center; height: 100%; padding: 0 80px 0 96px; }
    .copy { display: grid; gap: 24px; }
    .pops { display: flex; gap: 20px; align-items: flex-start; }
    .pops img { width: 279px; }
    .p2 { margin-top: 72px; }
  </style></head><body><div class="wrap">
    <div class="copy">
      <div class="eyebrow"><img src="${icon}" width="26" height="26">Vemo</div>
      <h1>Assista junto, cada um na sua casa.</h1>
      <p class="sub">Crie uma sala, mande o código para quem vai assistir com você, e pronto: vocês estão vendo a mesma coisa, no mesmo segundo.</p>
    </div>
    <div class="pops">
      <img class="popup p1" src="${popOut}">
      <img class="popup p2" src="${popIn}">
    </div>
  </div></body></html>`;
}

function screen(label, color) {
  return `<div class="screen">
    <div class="poster" style="background: radial-gradient(120% 90% at 30% 20%, ${color}, #1d1830 70%)">
      <div class="pause"><span></span><span></span></div>
    </div>
    <div class="bar"><div class="fill"></div><div class="knob"></div></div>
    <div class="row"><span>34:12</span><span>1:32:10</span></div>
    <div class="who">${label}</div>
  </div>`;
}

function screenshot2(icon) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${base}
    .wrap { display: grid; grid-template-rows: auto 1fr; gap: 48px; height: 100%; padding: 80px 96px; }
    .head { display: grid; grid-template-columns: 1fr 420px; gap: 48px; align-items: end; }
    .screens { display: grid; grid-template-columns: 1fr 88px 1fr; align-items: center; }
    .screen { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 16px; }
    .poster { height: 270px; border-radius: 10px; display: grid; place-items: center; }
    .pause { display: flex; gap: 12px; }
    .pause span { width: 18px; height: 62px; border-radius: 4px; background: rgba(245,239,230,.92); }
    .bar { position: relative; height: 6px; margin: 18px 4px 10px; border-radius: 3px; background: var(--line); }
    .fill { width: 37%; height: 100%; border-radius: 3px; background: var(--accent); }
    .knob { position: absolute; left: 37%; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: var(--text); }
    .row { display: flex; justify-content: space-between; font: 500 15px Inter; color: var(--muted); padding: 0 4px; }
    .who { margin-top: 14px; padding: 0 4px; font: 500 18px Inter; }
    .link { display: grid; place-items: center; gap: 10px; color: var(--accent); font: 500 13px Inter; letter-spacing: .1em; text-transform: uppercase; }
    .link .line { width: 56px; height: 2px; background: repeating-linear-gradient(90deg, var(--accent) 0 8px, transparent 8px 14px); }
  </style></head><body><div class="wrap">
    <div class="head">
      <div style="display:grid; gap:20px"><div class="eyebrow"><img src="${icon}" width="26" height="26">Vemo</div><h1>Pausou aqui, pausa lá.</h1></div>
      <p class="sub">Play, pausa e pulo de trecho acontecem nos dois lados. Funciona no YouTube e na Netflix, cada pessoa com a própria conta.</p>
    </div>
    <div class="screens">
      ${screen('Você', '#7a3b52')}
      <div class="link"><img src="${icon}" width="44" height="44"><div class="line"></div></div>
      ${screen('Ana, em outra cidade', '#7a3b52')}
    </div>
  </div></body></html>`;
}

function promo(icon) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${base}
    body { width: 440px; height: 280px; display: grid; place-items: center; }
    .box { display: grid; justify-items: center; gap: 12px; }
    .name { font: 700 58px/1 'Bricolage Grotesque'; letter-spacing: -0.02em; }
    .tag { font: 400 17px Inter; color: var(--muted); }
  </style></head><body><div class="box">
    <img src="${icon}" width="76" height="76">
    <div class="name">Vemo</div>
    <div class="tag">Assista junto, em sincronia.</div>
  </div></body></html>`;
}

async function render(browser, html, width, height, file) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const tmp = `${file}.tmp.png`;
  await page.screenshot({ path: tmp });
  await page.close();
  // A loja pede PNG de 24 bits, sem canal alfa.
  execFileSync('magick', [tmp, '-background', '#16131f', '-alpha', 'remove', '-alpha', 'off', `PNG24:${file}`]);
  fs.rmSync(tmp);
  console.log(path.relative(ROOT, file));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const icon = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'extension/icons/128.png')).toString('base64')}`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files'] });
  try {
    const popOut = await popupShot(browser, STATUS_OUT);
    const popIn = await popupShot(browser, STATUS_IN);
    await render(browser, screenshot1(icon, popOut, popIn), 1280, 800, path.join(OUT, 'screenshot-1.png'));
    await render(browser, screenshot2(icon), 1280, 800, path.join(OUT, 'screenshot-2.png'));
    await render(browser, promo(icon), 440, 280, path.join(OUT, 'promo-440x280.png'));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
