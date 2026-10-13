// End-to-end API checks in a fresh, isolated Linux production container.
// Usage: node tests/docker-smoke.mjs [--build] [--image=miweb:verify] [--url=https://example.com]
// Requires Docker Engine. No host directories are mounted into the container.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = process.argv.find(arg => arg.startsWith('--image='))?.slice(8) || 'miweb:verify';
const project = `miweb-smoke-${randomUUID().slice(0, 12)}`;
let name;
const key = randomBytes(32).toString('hex');
const origin = 'https://miweb-container.test';
const environment = { ...process.env, MIWEB_ACCESS_KEY: key, PUBLIC_ORIGIN: origin, MIWEB_IMAGE: image, MIWEB_PORT: '0' };
const compose = ['compose', '--project-name', project, '--file', path.join(root, 'compose.yaml'), '--env-file', path.join(root, 'deploy/production.env.example')];
let created = false;
const docker = (...args) => {
  const result = spawnSync('docker', args, { cwd: root, env: environment, encoding: 'utf8', stdio: args[0] === 'build' ? 'inherit' : undefined, timeout: 600000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout?.trim() || '';
};
const pass = message => console.log(`PASS ${message}`);
async function fixtureFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await fixtureFiles(path.join(directory, entry.name), relative + '/'));
    else files.push({ path: relative, data: (await readFile(path.join(directory, entry.name))).toString('base64') });
  }
  return files;
}

try {
  assert.equal(docker('info', '--format', '{{.OSType}}'), 'linux');
  if (process.argv.includes('--build')) {
    console.log(`Building ${image} from the current working tree...`);
    docker('build', '--tag', image, '.');
  }
  const imageInfo = JSON.parse(docker('image', 'inspect', image))[0];
  assert.equal(imageInfo.Os, 'linux');
  assert.equal(imageInfo.Config.User, 'node');
  console.log(`Image ${imageInfo.Id} (${imageInfo.Os}/${imageInfo.Architecture})`);
  created = true;
  docker(...compose, 'up', '--detach', '--no-build', '--wait', '--wait-timeout', '90');
  name = docker(...compose, 'ps', '--quiet', 'miweb');
  assert.match(name, /^[a-f0-9]{12,64}$/);
  const bound = docker('port', name, '4173/tcp');
  assert.match(bound, /^127\.0\.0\.1:\d+$/);
  const base = `http://${bound}`;
  const api = async (route, body, extra = {}, authorized = true) => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { 'x-miweb-key': key } : {}), origin, ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  };
  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { health = await api('/api/health'); if (health.status === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(health?.status, 200, 'production health endpoint starts');
  assert.equal(health.data.localAccess, false);
  assert.equal(health.data.requiresKey, true);
  const home = await fetch(base, { signal: AbortSignal.timeout(10000) });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<div id="root"/);
  pass('production UI and health; local access disabled; key required');

  assert.equal((await api('/api/demo', {}, {}, false)).status, 401);
  assert.equal((await api('/api/demo', {}, { 'x-miweb-key': 'incorrect' })).status, 401);
  assert.equal((await api('/api/demo', {}, { origin: 'https://untrusted.test' })).status, 403);
  for (const location of ['/etc', 'D:\\private-project', 'http://localhost:4173', 'http://127.0.0.1:4173', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1']) {
    const rejected = await api('/api/open', { location });
    assert.equal(rejected.status, 400, `${location}: ${JSON.stringify(rejected.data)}`);
  }
  for (const filename of ['../outside.html', '.env', 'sub/.env.production']) {
    assert.equal((await api('/api/upload', { files: [{ path: filename, data: Buffer.from('x').toString('base64') }] })).status, 400);
  }
  pass('missing/wrong key, cross-origin, filesystem, loopback, private network and upload traversal rejected');

  const demo = await api('/api/demo', {});
  assert.equal(demo.status, 200, JSON.stringify(demo.data));
  const button = demo.data.nodes.find(node => node.selector === '#start-button');
  assert.equal(button?.file, 'index.html');
  const exported = await api(`/api/sessions/${demo.data.id}/export`, { changes: [{ id: button.id, x: 0, y: -8 }] });
  assert.equal(exported.status, 200);
  assert.equal(exported.data.files.length, 1);
  assert.match(exported.data.files[0].updated, /translate: 0px -8px/);
  assert.equal(exported.data.files[0].original, await readFile(path.join(root, 'examples/atelier/index.html'), 'utf8'));
  pass('Chromium renders demo, preserves original HTML and exports a minimal change');
  const assetFixture = await api('/api/upload', { files: [
    { path: 'index.html', data: Buffer.from('<!doctype html><html><body><img src="badge.svg" width="80" height="40"><button>asset test</button></body></html>').toString('base64') },
    { path: 'badge.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="blue"/></svg>').toString('base64') },
  ] });
  assert.equal(assetFixture.status, 200, JSON.stringify(assetFixture.data));
  const assetPath = assetFixture.data.html.match(/https:\/\/miweb-container\.test(\/api\/sessions\/[^"'\s)]+)/)?.[1];
  assert.ok(assetPath, 'PUBLIC_ORIGIN used for captured assets');
  assert.equal((await api(assetPath, undefined, {}, false)).status, 200);
  pass('PUBLIC_ORIGIN rewrites captured assets; sandbox preview can fetch them without sending the API key');

  for (const [name, selector, filename] of [['react', '#react-target', 'src/main.jsx'], ['vue', '#vue-target', 'src/App.vue']]) {
    const files = await fixtureFiles(path.join(root, 'tests/fixtures', name));
    const uploaded = await api('/api/upload', { files });
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
    const original = uploaded.data.nodes.find(node => node.selector === selector);
    assert.equal(original?.file, filename);
    const edited = await api(`/api/sessions/${uploaded.data.id}/export`, { changes: [{ id: original.id, x: 4, y: -8, width: 180, height: 60 }] });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.equal(edited.data.files.length, 1);
    assert.equal(edited.data.files[0].path, filename);
    assert.equal(edited.data.files[0].original, Buffer.from(files.find(file => file.path === filename).data, 'base64').toString('utf8'));
    assert.match(edited.data.diff, new RegExp(filename.replaceAll('.', '\\.')));
    const replacement = new Map(edited.data.files.map(file => [file.path, Buffer.from(file.updated).toString('base64')]));
    const reproduced = await api('/api/upload', { files: files.map(file => ({ ...file, data: replacement.get(file.path) || file.data })) });
    assert.equal(reproduced.status, 200, JSON.stringify(reproduced.data));
    const actual = reproduced.data.nodes.find(node => node.selector === selector);
    assert.equal(actual?.width, 180);
    assert.equal(actual?.height, 60);
    assert.equal(actual?.baseTranslate, '4px -8px');
    pass(`${name}: folder upload, source mapping, minimal export, and re-import reproduce translation and size`);
  }
  const publicUrl = process.argv.find(arg => arg.startsWith('--url='))?.slice(6);
  if (publicUrl) {
    const remote = await api('/api/open', { location: publicUrl });
    assert.equal(remote.status, 200, JSON.stringify(remote.data));
    assert.equal(remote.data.mode, 'snapshot');
    const node = remote.data.nodes.find(node => ['h1', 'button', 'p', 'a'].includes(node.tag) && node.width > 0);
    assert.ok(node, 'public page contains editable content');
    const patch = await api(`/api/sessions/${remote.data.id}/export`, { changes: [{ id: node.id, x: 2, y: -3 }] });
    assert.equal(patch.status, 200);
    assert.equal(patch.data.files.length, 0);
    assert.match(patch.data.css, /translate: 2px -3px/);
    pass(`public URL capture and selector-based layout export: ${publicUrl}`);
  }
  const runtime = JSON.parse(docker('exec', name, 'node', '-e', 'console.log(JSON.stringify({platform:process.platform,uid:process.getuid(),node:process.version}))'));
  assert.equal(runtime.platform, 'linux');
  assert.notEqual(runtime.uid, 0);
  const processes = docker('top', name, '-eo', 'pid,comm');
  assert.match(processes, /chrome|chromium/);
  const inspection = JSON.parse(docker('inspect', name))[0];
  assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
  assert.ok(inspection.HostConfig.CapDrop.includes('ALL'));
  assert.equal(inspection.State.OOMKilled, false);
  pass(`Linux Chromium running as UID ${runtime.uid}; ${runtime.node}; read-only filesystem and container limits work`);
  console.log(`SUCCESS ${project}; all production-container checks passed using compose.yaml.`);
} catch (error) {
  if (created) {
    try { console.error(docker(...compose, 'logs', '--tail=60', 'miweb')); } catch {}
  }
  throw error;
} finally {
  if (created) {
    try { docker(...compose, 'down', '--timeout', '10'); console.log(`Removed only test project ${project}; image retained.`); }
    catch (error) { console.error(`Cleanup failed for ${project}: ${error.message}`); process.exitCode = 1; }
  }
}
