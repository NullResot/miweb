import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { mkdtemp, rm, readFile, mkdir, writeFile, realpath, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
// macOS aliases /var to /private/var. Use the canonical path returned to the
// native picker so the fixture and backend root checks describe the same path.
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "miweb-desktop-smoke-")));
const resultsPath = path.join(root, "test-results");
const reportPath = path.resolve(process.env.DESKTOP_SMOKE_REPORT || path.join(resultsPath, "desktop-smoke.json"));
const errors = [];
let application;
let origin;
let fixtureServer;
let activePage;
const report = [];
const verification = {
  schemaVersion: 1,
  ok: false,
  executable: process.env.DESKTOP_EXECUTABLE || "development Electron",
  platform: process.platform,
  hostArchitecture: process.arch,
  dialogAutomation: "Native picker responses and download destination are controlled through Electron APIs; OS dialog UI is not automated.",
  checks: report,
  previewClicks: [],
};
function checked(message) { report.push(message); console.log(`PASS ${message}`); }
const env = { ...process.env, MIWEB_DESKTOP_TEST: "1", MIWEB_DESKTOP_USER_DATA: path.join(temporary, "user-data") };
delete env.ELECTRON_RUN_AS_NODE;

async function waitUntil(action, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await action()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function quitGracefully(app) {
  const child = app.process();
  // app.close() is reserved for failure cleanup. Passing the test requires an
  // explicit Electron Quit with an observed clean process exit before cleanup.
  await app.evaluate(({ app }) => { setImmediate(() => app.quit()); });
  await waitUntil(() => child.exitCode !== null || child.signalCode !== null, "Electron did not exit after explicit Quit.", 12000);
  assert.equal(child.signalCode, null, "Electron should exit without a termination signal.");
  assert.equal(child.exitCode, 0, "Electron should quit successfully.");
  return { code: child.exitCode, signal: child.signalCode };
}

async function returnHome(page) {
  // Compact windows hide the English brand text; the home action is stable.
  await page.getByTitle("返回开始页", { exact: true }).click();
  const confirmation = page.getByRole("dialog").getByRole("button", { name: "打开新页面", exact: true });
  if (await confirmation.isVisible().catch(() => false)) await confirmation.click();
  await page.getByRole("button", { name: "先试用示例" }).waitFor();
}

async function clickPreview(page, selector) {
  // Electron and the installed Playwright driver can ship different Chromium
  // revisions. Read each document's own geometry, without cross-frame CDP
  // bounding boxes. A recreated canvas starts with a provisional fit scale;
  // measuring its frame before the target exists mixes two different layouts.
  const iframe = page.locator("iframe");
  const target = page.frameLocator("iframe").locator(selector);
  const diagnostic = { selector, page: page.url(), attempts: 0 };
  verification.previewClicks.push(diagnostic);
  await target.waitFor({ state: "visible", timeout: 15000 });
  // This overlay is removed only after the iframe bridge installs its input
  // listeners and sends ready. A visible target alone does not establish that.
  await page.locator(".frame-loading").waitFor({ state: "hidden", timeout: 15000 });

  const measure = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clientWidth: element.clientWidth, clientHeight: element.clientHeight };
  };
  const stableGeometry = async (element) => {
    const sample = () => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clientWidth: element.clientWidth, clientHeight: element.clientHeight };
    };
    const deadline = performance.now() + 5000;
    let previous;
    let stableFrames = 0;
    return new Promise((resolve, reject) => {
      const next = () => {
        const current = sample();
        const stable = previous && Object.keys(current).every((key) => Math.abs(current[key] - previous[key]) < 0.1);
        stableFrames = stable && document.fonts.status !== "loading" ? stableFrames + 1 : 0;
        previous = current;
        if (stableFrames >= 3 && current.width > 0 && current.height > 0) return resolve(current);
        if (performance.now() > deadline) return reject(new Error(`Preview layout did not stabilize: ${JSON.stringify(current)}`));
        requestAnimationFrame(next);
      };
      requestAnimationFrame(next);
    });
  };
  const unchanged = (before, after) => Object.keys(before).every((key) => Math.abs(before[key] - after[key]) < 0.1);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    diagnostic.attempts += 1;
    const targetBefore = await target.evaluate(stableGeometry);
    const frame = await iframe.evaluate(stableGeometry);
    const element = await target.evaluate(measure);
    const frameAfter = await iframe.evaluate(measure);
    diagnostic.frame = frameAfter;
    diagnostic.target = element;
    if (!unchanged(targetBefore, element) || !unchanged(frame, frameAfter)) continue;
    const point = {
      x: frame.x + (element.x + element.width / 2) * frame.width / frame.clientWidth,
      y: frame.y + (element.y + element.height / 2) * frame.height / frame.clientHeight,
    };
    diagnostic.point = point;
    diagnostic.frameHit = await iframe.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, point);
    diagnostic.targetHit = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit === element || element.contains(hit);
    });
    assert.equal(diagnostic.frameHit, true, `Preview click is occluded outside the iframe: ${JSON.stringify(diagnostic)}`);
    assert.equal(diagnostic.targetHit, true, `Preview target center is occluded: ${JSON.stringify(diagnostic)}`);
    await page.mouse.click(point.x, point.y);
    await page.getByRole("spinbutton", { name: "X", exact: true }).waitFor({ state: "visible", timeout: 15000 });
    diagnostic.selected = true;
    return;
  }
  throw new Error(`Preview geometry kept changing before the real mouse click: ${JSON.stringify(diagnostic)}`);
}

try {
  await mkdir(resultsPath, { recursive: true });
  application = await electron.launch({
    ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: path.resolve(process.env.DESKTOP_EXECUTABLE), args: [] } : { args: [path.join(root, "desktop/main.cjs")] }),
    cwd: root,
    env,
    timeout: 45000,
  });
  application.process().stdout.on("data", (chunk) => process.stdout.write(chunk));
  application.process().stderr.on("data", (chunk) => process.stderr.write(chunk));
  const page = await application.firstWindow({ timeout: 45000 });
  activePage = page;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 45000 });
  await page.getByRole("button", { name: "先试用示例" }).waitFor();
  origin = new URL(page.url()).origin;
  const health = await (await fetch(`${origin}/api/health`)).json();
  assert.equal(health.localAccess, true);
  assert.equal(health.requiresKey, true);
  const unauthenticated = await fetch(`${origin}/api/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unauthenticated.status, 401);
  const prefs = await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const prefs = win.webContents.getLastWebPreferences();
    return { nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, webviewTag: prefs.webviewTag };
  });
  assert.deepEqual(prefs, { nodeIntegration: false, sandbox: true, contextIsolation: true, webviewTag: false });
  verification.runtime = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    executable: process.execPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    architecture: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chromium: process.versions.chrome,
    backendPids: app.getAppMetrics().filter((metric) => metric.name === "Miweb page renderer").map((metric) => metric.pid),
  }));
  assert.equal(verification.runtime.backendPids.length, 1, "Expected one native backend utility process.");
  if (process.env.DESKTOP_EXECUTABLE) assert.equal(verification.runtime.packaged, true);
  assert.deepEqual(await page.evaluate(() => ({ bridge: typeof window.miwebDesktop?.selectProject, node: typeof window.require, key: sessionStorage.getItem("miweb-access-key") })), { bridge: "function", node: "undefined", key: null });
  checked("Desktop starts a random loopback server with auth; renderer is sandboxed and no key is exposed.");

  await page.getByRole("button", { name: "先试用示例" }).click();
  await page.locator(".page-root strong").filter({ hasText: "Atelier" }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(resultsPath, "desktop-demo.png") });
  await clickPreview(page, "#start-button");
  await page.keyboard.press("ArrowUp");
  await waitUntil(async () => (await page.getByRole("spinbutton", { name: "Y", exact: true }).inputValue()) === "-1", "Arrow nudge did not update the editor.");
  const shortcutModifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${shortcutModifier}+z`);
  await waitUntil(async () => (await page.getByRole("spinbutton", { name: "Y", exact: true }).inputValue()) === "0", "The platform undo shortcut did not restore the editor position.");
  await page.keyboard.press(`${shortcutModifier}+Shift+z`);
  await waitUntil(async () => (await page.getByRole("spinbutton", { name: "Y", exact: true }).inputValue()) === "-1", "The platform redo shortcut did not restore the edit.");
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "源码已复制" }).waitFor();
  const copied = await application.evaluate(({ clipboard }) => clipboard.readText());
  assert.match(copied, /translate: 0px -1px/);
  assert.equal(await page.frameLocator("iframe").locator("body").evaluate(() => typeof window.miwebDesktop), "undefined");
  const iframeAuth = await page.frameLocator("iframe").locator("body").evaluate(async ({ origin }) => {
    try {
      const response = await fetch(origin + "/api/demo", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
      return response.status;
    } catch { return "blocked"; }
  }, { origin });
  assert.notEqual(iframeAuth, 200);
  checked("Bundled page renderer imports the demo, platform undo/redo and keyboard edits export source, native clipboard works, and imported iframe has no native bridge/auth.");

  const patchPath = path.join(temporary, "miweb-changes.patch");
  await application.evaluate(({ BrowserWindow }, patchPath) => {
    globalThis.miwebSmokeDownload = null;
    BrowserWindow.getAllWindows()[0].webContents.session.once("will-download", (_event, item) => {
      globalThis.miwebSmokeDownload = item.getSaveDialogOptions();
      item.setSavePath(patchPath);
    });
  }, patchPath);
  await page.getByRole("button", { name: "查看代码与最小差异" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^最小差异/ }).click();
  await page.getByRole("button", { name: "下载", exact: true }).click();
  await waitUntil(async () => { try { return (await readFile(patchPath, "utf8")).includes("translate: 0px -1px"); } catch { return false; } }, "Native export download was not saved.");
  const saveOptions = await application.evaluate(() => globalThis.miwebSmokeDownload);
  assert.equal(saveOptions.title, "保存微调代码");
  assert.equal(saveOptions.buttonLabel, "保存");
  assert.equal(path.basename(saveOptions.defaultPath), "miweb-changes.patch");
  checked("The real export download receives native save-dialog options and writes the expected minimal patch.");

  await page.keyboard.press("Escape");
  await returnHome(page);
  const projectPath = path.join(temporary, "project");
  await mkdir(projectPath);
  await writeFile(path.join(projectPath, "index.html"), '<!doctype html><title>Desktop project fixture</title><style>body{margin:70px}button{width:180px;height:60px}</style><button id="desktop-project">Local project</button>');
  await application.evaluate(({ dialog }, projectPath) => {
    globalThis.miwebSmokePickerCalls = 0;
    dialog.showOpenDialog = async (_window, options) => {
      if (!options.properties.includes("openDirectory")) throw new Error("Expected a directory picker.");
      globalThis.miwebSmokePickerCalls += 1;
      if (globalThis.miwebSmokePickerCalls === 1) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: [projectPath] };
    };
  }, projectPath);
  assert.equal(await page.evaluate(() => window.miwebDesktop.selectProject()), null);
  const pickerResult = await page.evaluate(() => window.miwebDesktop.selectProject());
  assert.equal(pickerResult, projectPath);
  // Exercise the actual visible project picker button, including renderer hook.
  await page.getByRole("button", { name: "选择项目文件夹", exact: true }).first().click();
  await page.locator(".page-root strong").filter({ hasText: "Desktop project fixture" }).waitFor({ timeout: 30000 });
  await clickPreview(page, "#desktop-project");
  await page.keyboard.press("ArrowRight");
  await waitUntil(async () => (await page.getByRole("spinbutton", { name: "X", exact: true }).inputValue()) === "1", "Native folder project could not be edited.");
  checked("Native folder picker opens a real local source project, and its page remains editable.");

  for (const [framework, selector, title, sourceFile] of [
    ["react", "#react-target", "React fixture", "src/main.jsx"],
    ["vue", "#vue-target", "Vue fixture", "src/App.vue"],
  ]) {
    await returnHome(page);
    const fixturePath = path.join(temporary, framework);
    await cp(path.join(root, "tests/fixtures", framework), fixturePath, {
      recursive: true,
      filter: (filename) => !filename.split(path.sep).includes("node_modules"),
    });
    const sourceBefore = await readFile(path.join(fixturePath, sourceFile), "utf8");
    await page.getByRole("textbox", { name: "网站链接或本地项目地址" }).fill(fixturePath);
    await page.getByRole("button", { name: "打开页面", exact: true }).click();
    await page.locator(".page-root strong").filter({ hasText: title }).waitFor({ timeout: 30000 });
    await clickPreview(page, selector);
    await page.keyboard.press("ArrowRight");
    await waitUntil(async () => (await page.getByRole("spinbutton", { name: "X", exact: true }).inputValue()) === "1", `${framework} source project could not be edited.`);
    await page.getByRole("button", { name: "复制代码", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "源码已复制" }).waitFor();
    assert.match(await application.evaluate(({ clipboard }) => clipboard.readText()), /translate[^\n]*1px 0px/);
    assert.equal(await readFile(path.join(fixturePath, sourceFile), "utf8"), sourceBefore, "Export should leave the imported source intact.");
    checked(`Bundled compiler opens a real ${framework} project and exports its edited original source.`);
  }

  await returnHome(page);
  fixtureServer = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html;charset=utf-8");
    response.end('<!doctype html><title>Desktop URL fixture</title><button id="desktop-url" style="margin:50px;width:160px;height:50px">URL page</button>');
  });
  await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
  await page.getByRole("textbox", { name: "网站链接或本地项目地址" }).fill(`127.0.0.1:${fixtureServer.address().port}`);
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await page.locator(".page-root strong").filter({ hasText: "Desktop URL fixture" }).waitFor({ timeout: 30000 });
  await clickPreview(page, "#desktop-url");
  await page.keyboard.press("ArrowDown");
  await page.getByRole("button", { name: "复制补丁", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "CSS 补丁已复制" }).waitFor();
  assert.match(await application.evaluate(({ clipboard }) => clipboard.readText()), /translate:\s*0px 1px/);
  checked("Local deployment URL capture and CSS patch export work in the real desktop app.");

  const before = page.url();
  await page.evaluate(() => { window.location.href = "https://example.com/"; });
  assert.equal(page.url(), before);
  await page.evaluate(() => { window.open("https://example.com/", "_blank"); });
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.deepEqual(errors, []);
  checked("External navigation and popup windows are denied; no renderer errors occurred.");

  if (process.platform === "darwin") {
    const backendPids = verification.runtime.backendPids;
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await waitUntil(() => page.isClosed(), "The macOS main window did not close.");
    assert.equal(application.process().exitCode, null, "Closing the macOS window should keep the Dock app running.");
    assert.equal((await fetch(`${origin}/api/health`)).status, 200);
    const reopenedPromise = application.waitForEvent("window", { timeout: 15000 });
    await application.evaluate(({ app }) => { app.emit("activate"); app.emit("activate"); });
    const reopened = await reopenedPromise;
    activePage = reopened;
    await reopened.waitForURL(`${origin}/`, { timeout: 15000 });
    reopened.on("pageerror", (error) => errors.push(error.message));
    await reopened.locator(".page-root strong").filter({ hasText: "Desktop URL fixture" }).waitFor({ timeout: 15000 });
    await clickPreview(reopened, "#desktop-url");
    await waitUntil(async () => (await reopened.getByRole("spinbutton", { name: "Y", exact: true }).inputValue()) === "1", "macOS window reopening did not restore the editing session.");
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    assert.deepEqual(await application.evaluate(({ app }) => app.getAppMetrics().filter((metric) => metric.name === "Miweb page renderer").map((metric) => metric.pid)), backendPids);
    assert.equal(await reopened.evaluate(() => window.miwebDesktop.selectProject()), projectPath);
    await returnHome(reopened);
    await reopened.getByRole("button", { name: "先试用示例" }).click();
    await reopened.locator(".page-root strong").filter({ hasText: "Atelier" }).waitFor({ timeout: 30000 });
    assert.deepEqual(errors, []);
    checked("macOS window close keeps the Dock app alive; activation restores edits in one trusted window with the same backend and working picker.");
  }

  verification.shutdown = await quitGracefully(application);
  application = undefined;
  await waitUntil(async () => { try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } }, "Desktop backend still responds after application exit.", 12000);
  await waitUntil(() => verification.runtime.backendPids.every((pid) => {
    try { process.kill(pid, 0); return false; } catch (error) { if (error.code === "ESRCH") return true; throw error; }
  }), "Desktop backend utility process survived application Quit.", 12000);
  checked("Explicit Quit exits Electron cleanly, stops its backend process, and releases the listening port.");
  verification.ok = true;
} catch (error) {
  verification.error = error.stack || error.message;
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(resultsPath, "desktop-failure.png") }).catch(() => {});
  throw error;
} finally {
  if (application) await application.close().catch(() => {});
  if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve));
  await rm(temporary, { recursive: true, force: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(verification, null, 2) + "\n");
  console.log(JSON.stringify(verification, null, 2));
}
