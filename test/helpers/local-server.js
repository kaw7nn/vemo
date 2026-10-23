// Sobe o Worker local (wrangler dev) numa porta livre para os testes.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startLocalServer({ log = () => {} } = {}) {
  const port = await freePort();
  // Armazenamento próprio por execução: salas de rodadas anteriores não vazam pro teste.
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vemo-wrangler-'));
  const child = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persistDir, '--show-interactive-dev-session=false'], {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`wrangler dev não subiu:\n${output}`)), 60000);
    const onData = (chunk) => {
      output += chunk;
      log(chunk.toString());
      if (/Ready on/.test(output)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`wrangler dev saiu (${code}):\n${output}`));
    });
  });
  child.removeAllListeners('exit');

  return {
    port,
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        child.once('exit', resolve);
        try {
          process.kill(-child.pid, 'SIGTERM'); // o grupo inteiro: npx, wrangler e workerd
        } catch {
          resolve();
        }
      }).then(() => fs.rmSync(persistDir, { recursive: true, force: true })),
  };
}

module.exports = { startLocalServer };
