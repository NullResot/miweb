import { createRequire } from 'node:module';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
// Recent Electron packages install the executable lazily. A release build must
// have the complete distribution before electron-builder copies electronDist.
const electronInstall = path.join(path.dirname(require.resolve('electron/package.json')), 'install.js');
const electronResult = spawnSync(process.execPath, [electronInstall], { stdio: 'inherit', env: process.env, windowsHide: true });
if (electronResult.error) throw electronResult.error;
if (electronResult.status !== 0) process.exit(electronResult.status || 1);
const core = path.dirname(require.resolve('playwright-core/package.json'));
const destination = path.resolve('desktop-resources/browsers');
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData/Local/ms-playwright')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches/ms-playwright')
    : path.join(os.homedir(), '.cache/ms-playwright'));
const { browsers } = JSON.parse(await readFile(path.join(core, 'browsers.json'), 'utf8'));
await mkdir(destination, { recursive: true });
for (const name of ['chromium-headless-shell', 'ffmpeg', ...(process.platform === 'win32' ? ['winldd'] : [])]) {
  const browser = browsers.find((item) => item.name === name);
  if (!browser) continue;
  const folder = `${name.replaceAll('-', '_')}-${browser.revision}`;
  const source = path.join(cache, folder);
  if (path.resolve(source) === path.join(destination, folder)) continue;
  if (await stat(source).catch(() => null)) await cp(source, path.join(destination, folder), { recursive: true });
}
const result = spawnSync(process.execPath, [path.join(core, 'cli.js'), 'install', '--only-shell', 'chromium'], {
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: destination },
  stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log('Desktop Chromium staged:', destination);
