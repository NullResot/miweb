"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, utilityProcess } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { isAppPage, sameOrigin, canAuthenticateRequest, canUsePicker, isExportDownload } = require("./policy.cjs");

app.setName("Miweb");
if (process.env.MIWEB_DESKTOP_TEST === "1" && process.env.MIWEB_DESKTOP_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.MIWEB_DESKTOP_USER_DATA));
}

let window;
let backend;
let origin;
let appSession;
let openingWindow;
let quitting = false;
let shutdownPromise;
const docsUrl = "https://nullresot.github.io/miweb/";
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

app.on("second-instance", () => {
  if (!window || window.isDestroyed()) {
    if (origin && !quitting) void createWindow().catch(showStartupError);
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

function backendEnvironment(key) {
  // Do not pass the developer's Node injection flags or unrelated credentials
  // to the renderer/compiler process. Keep OS paths and explicit proxy settings.
  const allowed = /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|USERPROFILE|HOME|HOMEDRIVE|HOMEPATH|LOCALAPPDATA|APPDATA|PROGRAMDATA|PATHEXT|LANG|LC_.*|DISPLAY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i;
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.test(name)));
  return {
    ...env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "0",
    LOCAL_ACCESS: "1",
    MIWEB_ACCESS_KEY: key,
    PLAYWRIGHT_BROWSERS_PATH: app.isPackaged
      ? path.join(process.resourcesPath, "browsers")
      : (process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(app.getPath("home"), process.platform === "win32" ? "AppData/Local/ms-playwright" : process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright")),
  };
}

async function startBackend(key) {
  let failureOutput = "";
  const child = utilityProcess.fork(path.join(__dirname, "backend.cjs"), ["--production"], {
    cwd: path.dirname(__dirname),
    env: backendEnvironment(key),
    stdio: "pipe",
    serviceName: "Miweb page renderer",
  });
  backend = child;
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => {
    failureOutput = (failureOutput + chunk.toString()).slice(-3000);
    process.stderr.write(chunk);
  });
  child.on("exit", (code) => {
    if (backend === child) backend = undefined;
    if (!quitting && origin) {
      dialog.showErrorBox("Miweb 服务已停止", `本地页面处理服务意外停止（${code}）。请重新打开 Miweb。`);
      app.quit();
    }
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("本地服务启动超时。请重新打开 Miweb。")), 30000);
    const onExit = (code) => finish(new Error(`本地服务未能启动（${code}）。\n${failureOutput}`));
    const onMessage = (message) => {
      if (message?.type !== "miweb-ready") return;
      if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535)
        return finish(new Error("本地服务返回了无效端口。"));
      finish(null, `http://127.0.0.1:${message.port}`);
    };
    const finish = (error, value) => {
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      child.removeListener("message", onMessage);
      if (error) reject(error); else resolve(value);
    };
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

function configureSession(ses, key) {
  const trust = () => ({ origin, webContentsId: window?.webContents.id });
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === "x-miweb-key") delete headers[name];
    }
    const frame = details.frame;
    let frameUrl = "";
    let isMainFrame = false;
    try {
      frameUrl = frame?.url || "";
      isMainFrame = !!frame && frame === window?.webContents.mainFrame;
    } catch { /* A frame may be destroyed while its request is being handled. */ }
    if (canAuthenticateRequest({ ...details, frameUrl, isMainFrame }, trust())) {
      headers["x-miweb-key"] = key;
    }
    callback({ requestHeaders: headers });
  });
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    permission === "clipboard-sanitized-write" &&
    contents === window?.webContents && details.isMainFrame === true &&
    sameOrigin(requestingOrigin, origin),
  );
  ses.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(permission === "clipboard-sanitized-write" &&
      contents === window?.webContents && details.isMainFrame === true &&
      isAppPage(details.requestingUrl, origin)),
  );
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (event, item, contents) => {
    if (contents !== window?.webContents || !isExportDownload(item.getURL(), origin)) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({ title: "保存微调代码", buttonLabel: "保存", defaultPath: path.join(app.getPath("downloads"), path.basename(item.getFilename())) });
  });
}

function registerPicker() {
  let pending = false;
  ipcMain.handle("miweb:select-project", async (event) => {
    const trust = { origin, webContentsId: window?.webContents.id };
    const request = {
      webContentsId: event.sender.id,
      isMainFrame: event.senderFrame === window?.webContents.mainFrame,
      frameUrl: event.senderFrame?.url,
    };
    if (!canUsePicker(request, trust)) throw new Error("请求来源无效");
    if (pending) return null;
    pending = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        title: "选择前端项目文件夹",
        buttonLabel: "打开项目",
        properties: ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    } finally { pending = false; }
  });
}

async function createWindow() {
  if (quitting) return;
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  // Dock activation and a second launch can arrive together. Keep one window,
  // backend, session, and native IPC handler throughout this application run.
  if (openingWindow) return openingWindow;
  openingWindow = openWindow().finally(() => { openingWindow = undefined; });
  return openingWindow;
}

async function openWindow() {
  if (!origin) {
    const key = randomBytes(32).toString("hex");
    origin = await startBackend(key);
    // This partition lives for one application run, including Dock reopening.
    // No backend auth key or stale port is persisted to disk across launches.
    appSession = session.fromPartition(`miweb-${randomBytes(12).toString("hex")}`);
    configureSession(appSession, key);
    registerPicker();
    configureMenu();
  }
  if (quitting) return;
  const icon = path.join(__dirname, "assets", "icon.png");
  window = new BrowserWindow({
    title: "Miweb 微调",
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 640,
    backgroundColor: "#080809",
    show: false,
    ...(fs.existsSync(icon) ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      session: appSession,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if ([`${docsUrl}#how-it-works`, `${docsUrl}guide/overview.html`].includes(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppPage(url, origin)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isAppPage(url, origin)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.once("closed", () => { window = undefined; });
  await window.loadURL(origin + "/");
}

function configureMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Miweb", submenu: [{ role: "about", label: "关于 Miweb" }, { type: "separator" }, { role: "quit", label: "退出" }] },
    { label: "编辑", submenu: [{ role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" }, { role: "cut", label: "剪切" }, { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" }, { role: "selectAll", label: "全选" }] },
    { label: "窗口", submenu: [{ role: "minimize", label: "最小化" }, { role: "close", label: "关闭" }] },
    { label: "帮助", submenu: [{ label: "使用文档", click: () => { void shell.openExternal(`${docsUrl}guide/overview.html`); } }] },
  ]));
}

async function stopBackend() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const child = backend;
    if (!child || !child.pid) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 7000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.postMessage({ type: "miweb-shutdown" });
    });
  })();
  return shutdownPromise;
}

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void stopBackend().finally(() => app.quit());
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
function showStartupError(error) {
  dialog.showErrorBox("无法启动 Miweb", error.message || "本地服务未能启动。");
  app.quit();
}
if (hasLock) app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", () => {
    if (!quitting && (!window || window.isDestroyed())) void createWindow().catch(showStartupError);
  });
}).catch(showStartupError);
