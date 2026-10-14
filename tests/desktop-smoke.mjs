import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "miweb-desktop-smoke-"));
const errors = [];
let application;
let origin;
let fixtureServer;
let activePage;
const report = [];
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

async function returnHome(page) {
  await page.getByRole("button", { name: "微调 miweb" }).click();
  const confirmation = page.getByRole("dialog").getByRole("button", { name: "打开新页面", exact: true });
  if (await confirmation.isVisible().catch(() => false)) await confirmation.click();
  await page.getByRole("button", { name: "先试用示例" }).waitFor();
}

async function clickPreview(page, selector) {
  // Electron and the installed Playwright driver can ship different Chromium
  // revisions. Read the transformed iframe geometry rather than relying on
  // cross-frame CDP bounding boxes, then send a real mouse click to the canvas.
  const frame = await page.locator("iframe").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, scaleX: rect.width / element.clientWidth, scaleY: rect.height / element.clientHeight };
  });
  const element = await page.frameLocator("iframe").locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(frame.x + element.x * frame.scaleX, frame.y + element.y * frame.scaleY);
  await page.getByRole("spinbutton", { name: "X", exact: true }).waitFor({ state: "visible" });
}

try {
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
  assert.deepEqual(await page.evaluate(() => ({ bridge: typeof window.miwebDesktop?.selectProject, node: typeof window.require, key: sessionStorage.getItem("miweb-access-key") })), { bridge: "function", node: "undefined", key: null });
  checked("Desktop starts a random loopback server with auth; renderer is sandboxed and no key is exposed.");

  await page.getByRole("button", { name: "先试用示例" }).click();
  await page.locator(".page-root strong").filter({ hasText: "Atelier" }).waitFor({ timeout: 30000 });
  const target = page.frameLocator("iframe").locator("#start-button");
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await page.screenshot({ path: path.join(root, "test-results", "desktop-demo.png") });
  await clickPreview(page, "#start-button");
  await page.keyboard.press("ArrowUp");
  await waitUntil(async () => (await page.getByRole("spinbutton", { name: "Y", exact: true }).inputValue()) === "-1", "Arrow nudge did not update the editor.");
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
  checked("Bundled page renderer imports the demo, keyboard edits export source, native clipboard works, and imported iframe has no native bridge/auth.");

  const patchPath = path.join(temporary, "miweb-changes.patch");
  await application.evaluate(({ BrowserWindow }, patchPath) => {
    BrowserWindow.getAllWindows()[0].webContents.session.once("will-download", (_event, item) => item.setSavePath(patchPath));
  }, patchPath);
  await page.getByRole("button", { name: "查看代码与最小差异" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^最小差异/ }).click();
  await page.getByRole("button", { name: "下载", exact: true }).click();
  await waitUntil(async () => { try { return (await readFile(patchPath, "utf8")).includes("translate: 0px -1px"); } catch { return false; } }, "Native export download was not saved.");
  checked("The real export download reaches Electron's save flow and contains the expected minimal patch.");

  await page.keyboard.press("Escape");
  await returnHome(page);
  const projectPath = path.join(temporary, "project");
  await mkdir(projectPath);
  await writeFile(path.join(projectPath, "index.html"), '<!doctype html><title>Desktop project fixture</title><style>body{margin:70px}button{width:180px;height:60px}</style><button id="desktop-project">Local project</button>');
  await application.evaluate(({ dialog }, projectPath) => {
    dialog.showOpenDialog = async (_window, options) => {
      if (!options.properties.includes("openDirectory")) throw new Error("Expected a directory picker.");
      return { canceled: false, filePaths: [projectPath] };
    };
  }, projectPath);
  const pickerResult = await page.evaluate(() => window.miwebDesktop.selectProject());
  assert.equal(pickerResult, projectPath);
  // Exercise the actual visible project picker button, including renderer hook.
  await page.getByRole("button", { name: "选择项目文件夹", exact: true }).first().click();
  await page.locator(".page-root strong").filter({ hasText: "Desktop project fixture" }).waitFor({ timeout: 30000 });
  await clickPreview(page, "#desktop-project");
  await page.keyboard.press("ArrowRight");
  await waitUntil(async () => (await page.getByRole("spinbutton", { name: "X", exact: true }).inputValue()) === "1", "Native folder project could not be edited.");
  checked("Native folder picker opens a real local source project, and its page remains editable.");

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
  await application.close();
  application = undefined;
  await waitUntil(async () => { try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } }, "Desktop backend still responds after application exit.", 12000);
  checked("Closing the desktop shuts down its backend and releases the listening port.");
  console.log(JSON.stringify({ ok: true, executable: process.env.DESKTOP_EXECUTABLE || "development Electron", checks: report }, null, 2));
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(root, "test-results", "desktop-failure.png") }).catch(() => {});
  throw error;
} finally {
  if (application) await application.close().catch(() => {});
  if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
