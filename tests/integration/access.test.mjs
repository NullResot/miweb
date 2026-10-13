import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';

test('service access key, public-mode boundaries and proxy origin are enforced', async t => {
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const accessKey = randomUUID();
  const child = spawn(process.execPath, ['server/index.mjs', '--production'], {
    cwd: process.cwd(), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), LOCAL_ACCESS: '0', MIWEB_ACCESS_KEY: accessKey, PUBLIC_ORIGIN: 'https://public.example' },
  });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { health = await fetch(base + '/api/health').then(response => response.json()); if (health.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(health?.ok, 'service starts');
  assert.equal(health.requiresKey, true);
  assert.equal(health.localAccess, false);
  const post = (route, body, extra = {}) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  assert.equal((await post('/api/demo', {})).status, 401);
  const headers = { 'x-miweb-key': accessKey, origin: 'https://public.example' };
  assert.equal((await post('/api/open', { location: 'D:\\private\\project' }, headers)).status, 400);
  assert.equal((await post('/api/open', { location: 'http://127.0.0.1:1234' }, headers)).status, 400);
  assert.equal((await post('/api/demo', {}, { ...headers, origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await post('/api/upload', { files: [{ path: '../outside.html', data: 'eA==' }] }, headers)).status, 400);
  assert.equal((await post('/api/upload', { files: [{ path: '.env', data: 'eA==' }] }, headers)).status, 400);
  assert.equal((await post('/api/sessions/missing/export', { changes: [] }, headers)).status, 410);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/health', { headers: { host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
});
