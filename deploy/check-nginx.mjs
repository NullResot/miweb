// Validate the supplied HTTPS proxy template in isolated containers.
// Add --proxy [--image=miweb:verify] to test the live HTTPS -> Miweb chain.
// Does not install certificates or modify host nginx. Requires openssl + Docker.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import https from 'node:https';
const directory = path.dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(path.join(directory, '.nginx-validation-'));
const name = `miweb-nginx-check-${randomUUID().slice(0, 12)}`;
const app = `${name}-app`;
const proxy = `${name}-proxy`;
const key = randomBytes(32).toString('hex');
const environment = { ...process.env, MIWEB_ACCESS_KEY: key };
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', env: environment, windowsHide: true, timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout.trim();
};
try {
  const openssl = process.env.OPENSSL_PATH || 'openssl';
  run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-noenc', '-days', '1', '-subj', '/CN=tune.example.com', '-addext', 'subjectAltName=DNS:tune.example.com', '-keyout', path.join(temporary, 'privkey.pem'), '-out', path.join(temporary, 'fullchain.pem')]);
  const nginx = process.env.NGINX_IMAGE || 'nginx:stable';
  const mounts = ['--mount', `type=bind,source=${path.join(directory, 'nginx.conf')},target=/etc/nginx/conf.d/default.conf,readonly`, '--mount', `type=bind,source=${temporary},target=/etc/letsencrypt/live/tune.example.com,readonly`];
  run('docker', ['run', '--rm', '--name', name, '--network=none', ...mounts, '--entrypoint', 'nginx', nginx, '-t']);
  console.log('PASS nginx -t with the supplied HTTPS template and a temporary certificate');
  if (process.argv.includes('--proxy')) {
    const image = process.argv.find(arg => arg.startsWith('--image='))?.slice(8) || 'miweb:verify';
    run('docker', ['run', '--detach', '--pull=never', '--name', app, '--init', '--read-only', '--tmpfs', '/tmp:size=1g,mode=1777', '--shm-size=1g', '--memory=2g', '--cpus=2', '--pids-limit=256', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--publish', '127.0.0.1::443', '--env', 'MIWEB_ACCESS_KEY', '--env', 'LOCAL_ACCESS=0', '--env', 'PUBLIC_ORIGIN=https://tune.example.com', image]);
    // Sharing only this test app's network namespace preserves the exact
    // production nginx.conf upstream: http://127.0.0.1:4173.
    run('docker', ['run', '--detach', '--name', proxy, '--network', `container:${app}`, ...mounts, '--entrypoint', 'nginx', nginx, '-g', 'daemon off;']);
    const binding = run('docker', ['port', app, '443/tcp']);
    assert.match(binding, /^127\.0\.0\.1:\d+$/);
    const port = Number(binding.split(':')[1]);
    const ca = await readFile(path.join(temporary, 'fullchain.pem'));
    const request = (route, body, authenticated = true, origin = 'https://tune.example.com') => new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const connection = https.request({ hostname: '127.0.0.1', port, path: route, servername: 'tune.example.com', ca, method: payload ? 'POST' : 'GET', headers: { host: 'tune.example.com', origin, ...(authenticated ? { 'x-miweb-key': key } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) }, timeout: 90000 }, response => {
        const parts = [];
        response.on('data', chunk => parts.push(chunk));
        response.on('end', () => { const text = Buffer.concat(parts).toString('utf8'); let data; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: response.statusCode, data }); });
      });
      connection.on('timeout', () => connection.destroy(new Error('HTTPS proxy request timed out')));
      connection.on('error', reject);
      connection.end(payload);
    });
    let health;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { health = await request('/api/health'); if (health.status === 200) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(health?.status, 200);
    assert.equal(health.data.localAccess, false);
    assert.equal(health.data.requiresKey, true);
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(home.data, /<div id="root"/);
    assert.equal((await request('/api/demo', {}, false)).status, 401);
    assert.equal((await request('/api/demo', {}, true, 'https://untrusted.test')).status, 403);
    const demo = await request('/api/demo', {});
    assert.equal(demo.status, 200, JSON.stringify(demo.data));
    const button = demo.data.nodes.find(node => node.selector === '#start-button');
    assert.ok(button);
    const exported = await request(`/api/sessions/${demo.data.id}/export`, { changes: [{ id: button.id, x: 0, y: -8 }] });
    assert.equal(exported.status, 200);
    assert.match(exported.data.files[0].updated, /translate: 0px -8px/);
    console.log('PASS verified TLS -> unchanged Nginx upstream -> Miweb UI, health, key/origin checks, Chromium capture and source export');
  }
} finally {
  // Exact container names belong to this invocation, including timeout cleanup.
  let cleanupFailed = false;
  for (const ownContainer of [proxy, app, name]) {
    const removal = spawnSync('docker', ['rm', '--force', ownContainer], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    if (removal.error || (removal.status !== 0 && !/No such container/i.test(removal.stderr || ''))) {
      cleanupFailed = true;
      process.exitCode = 1;
      console.error(`Could not remove ${ownContainer}: ${removal.error?.message || removal.stderr}`);
    }
  }
  if (path.dirname(temporary) === directory && path.basename(temporary).startsWith('.nginx-validation-')) await rm(temporary, { recursive: true, force: true });
  if (!cleanupFailed) console.log(`Removed only ${name} test resources and temporary certificates.`);
}
