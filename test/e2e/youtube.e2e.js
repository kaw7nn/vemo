// Teste ponta a ponta no YouTube de verdade: dois navegadores separados, cada
// um com a extensão, conversando pelo servidor local.
// Uso: npm run e2e   (CHROME=/caminho/do/chromium para outro navegador)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const { startServer } = require('../../server');

const EXTENSION = path.join(__dirname, '../../extension');
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const VIDEO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; // Big Buck Bunny (Blender, CC-BY)
const HEADLESS = process.env.HEADFUL ? false : true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeout = 20000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await Promise.resolve().then(fn).catch((e) => e);
    if (last && !(last instanceof Error)) return last;
    await sleep(250);
  }
  throw new Error(`tempo esgotado esperando: ${what} (último valor: ${last})`);
}

async function openBrowser(label, serverUrl) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `vemo-${label}-`));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: HEADLESS,
    enableExtensions: true,
    userDataDir,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--lang=pt-BR'],
  });
  const extId = await browser.installExtension(EXTENSION);
  const workerTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`));
  const worker = await workerTarget.worker();
  await worker.evaluate((server, name) => chrome.storage.local.set({ server, name }), serverUrl, label);
  const [page] = await browser.pages();
  return { browser, worker, page, userDataDir };
}

async function videoState(page) {
  return page.evaluate(() => {
    const v = document.querySelector('#movie_player video');
    const ad = !!document.querySelector('#movie_player.ad-showing');
    return v ? { playing: !v.paused, time: v.currentTime, ad, url: location.href } : null;
  });
}

async function skipConsent(page) {
  // Em alguns países o YouTube mostra uma tela de cookies antes do vídeo.
  if (!page.url().includes('consent.')) return;
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /aceitar|accept|rejeitar|reject/i.test(b.textContent));
    btn?.click();
  });
  await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
}

async function waitVideoReady(page, label) {
  await skipConsent(page);
  await waitFor(async () => {
    const s = await videoState(page);
    return s && !s.ad && s.time >= 0 ? s : null;
  }, `vídeo pronto em ${label}`, 60000);
}

async function tabId(worker) {
  return worker.evaluate(async () => (await chrome.tabs.query({}))[0].id);
}

async function main() {
  const srv = await startServer({ port: 0, host: '127.0.0.1', log: (m) => console.log('  servidor:', m) });
  const serverUrl = `ws://127.0.0.1:${srv.port}`;
  const A = await openBrowser('Ana', serverUrl);
  const B = await openBrowser('Beto', serverUrl);
  const results = [];
  const step = async (name, fn) => {
    process.stdout.write(`- ${name} ... `);
    await fn();
    results.push(name);
    console.log('ok');
  };

  try {
    await step('Ana abre o vídeo e cria a sala', async () => {
      await A.page.goto(VIDEO, { waitUntil: 'domcontentloaded' });
      await waitVideoReady(A.page, 'Ana');
      await A.page.evaluate(() => document.querySelector('#movie_player video').pause());
      const id = await tabId(A.worker);
      await A.worker.evaluate((tabId) => startSession({ room: 'TESTE1', create: true, tabId }), id);
      await waitFor(() => A.worker.evaluate(() => connected && lastState?.mediaKey === 'youtube:aqz-KE-bpKQ'), 'sala criada com o vídeo da Ana');
    });

    await step('Beto entra pela página inicial e é levado ao mesmo vídeo', async () => {
      await B.page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
      await skipConsent(B.page);
      const id = await tabId(B.worker);
      await B.worker.evaluate((tabId) => startSession({ room: 'TESTE1', create: false, tabId }), id);
      await waitFor(() => B.page.url().includes('aqz-KE-bpKQ'), 'Beto no vídeo da sala', 30000);
      await waitVideoReady(B.page, 'Beto');
    });

    await step('Ana dá play, Beto começa a tocar', async () => {
      await A.page.evaluate(() => document.querySelector('#movie_player video').play().catch(() => {}));
      await waitFor(async () => (await videoState(B.page))?.playing, 'Beto tocando');
    });

    await step('Ana pausa, Beto pausa na mesma posição', async () => {
      await sleep(3000);
      await A.page.evaluate(() => document.querySelector('#movie_player video').pause());
      const b = await waitFor(async () => {
        const s = await videoState(B.page);
        return s && !s.playing ? s : null;
      }, 'Beto pausado');
      const a = await videoState(A.page);
      assert.ok(Math.abs(a.time - b.time) < 1.5, `posições diferentes: Ana ${a.time.toFixed(2)} x Beto ${b.time.toFixed(2)}`);
    });

    // Pulo curto: no Chromium sem tela o YouTube não carrega trechos distantes.
    await step('Ana pula 20s para frente, Beto vai junto', async () => {
      const target = (await videoState(A.page)).time + 20;
      await A.page.evaluate((t) => (document.querySelector('#movie_player video').currentTime = t), target);
      try {
        await waitFor(async () => Math.abs((await videoState(B.page)).time - target) < 1.5, 'Beto no mesmo ponto');
      } catch (err) {
        if (process.env.DEBUG) {
          const dump = (w) => w.evaluate(() => JSON.stringify({ lastState, lastRoomMedia, navTarget, tabMedia: [...tabMedia], connected }));
          console.log('\nA:', await dump(A.worker), '\nB:', await dump(B.worker));
          console.log('A video:', await videoState(A.page), '\nB video:', await videoState(B.page));
        }
        throw err;
      }
    });

    await step('Beto aperta K (play), Ana toca junto e ficam alinhados', async () => {
      await B.page.bringToFront();
      await B.page.keyboard.press('k');
      await waitFor(async () => (await videoState(A.page))?.playing, 'Ana tocando');
      await sleep(6000);
      const [a, b] = await Promise.all([videoState(A.page), videoState(B.page)]);
      assert.ok(a.playing && b.playing, 'os dois deveriam estar tocando');
      assert.ok(Math.abs(a.time - b.time) < 1.5, `fora de sincronia: Ana ${a.time.toFixed(2)} x Beto ${b.time.toFixed(2)}`);
      console.log(`(diferença ${Math.abs(a.time - b.time).toFixed(2)}s) `);
    });

    await step('Beto pausa, Ana pausa', async () => {
      await B.page.evaluate(() => document.querySelector('#movie_player video').pause());
      await waitFor(async () => (await videoState(A.page))?.playing === false, 'Ana pausada');
    });

    console.log(`\n${results.length} passos ok`);
  } catch (err) {
    if (process.env.DEBUG) {
      for (const [label, side] of [['Ana', A], ['Beto', B]]) {
        console.log(`\n--- ${label} ---`);
        console.log((await side.worker.evaluate(() => traceLog.slice(-40))).join('\n'));
        console.log('vídeo:', await videoState(side.page));
      }
    }
    throw err;
  } finally {
    await Promise.all([A.browser.close(), B.browser.close()]);
    await srv.close();
    for (const dir of [A.userDataDir, B.userDataDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nFALHOU:', err.message);
  process.exit(1);
});
