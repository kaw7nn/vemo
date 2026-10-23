// Gera dist/vemo-<versão>.zip com a pasta extension/, pronto para a Chrome Web Store.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const out = path.join(root, 'dist', `vemo-${manifest.version}.zip`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
// icon.svg é só a fonte dos PNGs; não vai no pacote.
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', 'icons/icon.svg', '-x', '.*'], { cwd: path.join(root, 'extension') });
console.log(`${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
