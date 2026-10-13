import express from "express";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { parse, serialize } from "parse5";
import { z } from "zod";
import { capturePage, closeBrowser } from "./capture.mjs";
import { captureProject } from "./project.mjs";
import { exportChanges } from "./source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.argv.includes("--production");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const localAccess =
  process.env.LOCAL_ACCESS === "1" ||
  (process.env.LOCAL_ACCESS !== "0" &&
    ["127.0.0.1", "localhost", "::1"].includes(host));
const accessKey = process.env.MIWEB_ACCESS_KEY;
let publicOrigin;
if (process.env.PUBLIC_ORIGIN) {
  const configured = new URL(process.env.PUBLIC_ORIGIN);
  if (
    !["http:", "https:"].includes(configured.protocol) ||
    configured.username ||
    configured.password ||
    configured.pathname !== "/"
  )
    throw new Error(
      "PUBLIC_ORIGIN must be the HTTP(S) origin without credentials or a path.",
    );
  publicOrigin = configured.origin;
}
const originFor = (request) =>
  publicOrigin || `${request.protocol}://${request.get("host")}`;
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !accessKey)
  throw new Error(
    "Public listening requires MIWEB_ACCESS_KEY. Set a key before starting with HOST=0.0.0.0.",
  );
const sessions = new Map();
const ttl =
  Math.max(5, Math.min(Number(process.env.SESSION_TTL_MINUTES) || 120, 1440)) *
  60000;
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "35mb" }));
app.use("/api", (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  const requestHostname = request.hostname.replace(/^\[|\]$/g, "");
  if (
    ["127.0.0.1", "localhost", "::1"].includes(host) &&
    !["127.0.0.1", "localhost", "::1"].includes(requestHostname)
  )
    return response
      .status(403)
      .json({ error: "请使用 localhost 或 127.0.0.1 打开本地服务" });
  if (request.path === "/health") return next();
  const isAsset =
    request.method === "GET" &&
    /^\/sessions\/[^/]+\/assets\//.test(request.path);
  if (
    !isAsset &&
    request.headers.origin &&
    request.headers.origin !== originFor(request)
  )
    return response
      .status(403)
      .json({ error: "请求来源不匹配，请在微调网站内重试" });
  if (accessKey && !isAsset) {
    const input = Buffer.from(request.get("x-miweb-key") || "");
    const expected = Buffer.from(accessKey);
    if (input.length !== expected.length || !timingSafeEqual(input, expected))
      return response
        .status(401)
        .json({ error: "请输入服务访问密钥", needsKey: true });
  }
  next();
});

const viewSchema = {
  width: z.number().int().min(320).max(2560).default(1280),
  height: z.number().int().min(400).max(1800).default(900),
};
const inputSchema = z.object({
  location: z.string().trim().min(1).max(2048),
  ...viewSchema,
});
const changeSchema = z.object({
  id: z.string().max(30),
  x: z.number().min(-10000).max(10000).default(0),
  y: z.number().min(-10000).max(10000).default(0),
  width: z.number().min(1).max(10000).nullable().optional(),
  height: z.number().min(1).max(10000).nullable().optional(),
  fontSize: z.number().min(1).max(500).nullable().optional(),
  borderRadius: z.number().min(0).max(1000).nullable().optional(),
});
const changesSchema = z.object({ changes: z.array(changeSchema).max(6000) });
const getSession = (id) => {
  const session = sessions.get(id);
  if (!session || Date.now() - session.lastAccess > ttl) {
    sessions.delete(id);
    throw Object.assign(new Error("页面会话已过期，请重新打开页面"), {
      status: 410,
    });
  }
  session.lastAccess = Date.now();
  return session;
};
const absoluteAsset = (url, base, session, origin) => {
  try {
    const resolved = new URL(url, base).href;
    const asset = session.assetUrls.get(resolved);
    return asset
      ? `${origin}/api/sessions/${session.id}/assets/${asset}`
      : resolved;
  } catch {
    return url;
  }
};
function prepareHtml(session, origin) {
  session.assetUrls ||= new Map();
  session.assetFiles ||= new Map();
  for (const [url, asset] of session.assets) {
    if (session.assetUrls.has(url)) continue;
    const key = randomUUID();
    session.assetUrls.set(url, key);
    session.assetFiles.set(key, asset);
  }
  const rewriteCss = (text, base) =>
    text
      .replace(
        /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,
        (_match, _quote, url) =>
          `url("${absoluteAsset(url, base, session, origin).replaceAll('"', "%22")}")`,
      )
      .replace(
        /@import\s+(['"])([^'"]+)\1/g,
        (_match, _quote, url) =>
          `@import "${absoluteAsset(url, base, session, origin).replaceAll('"', "%22")}"`,
      );
  for (const [url, asset] of session.assets) {
    if (/text\/css/.test(asset.type))
      session.assetFiles.set(session.assetUrls.get(url), {
        type: asset.type,
        body: Buffer.from(rewriteCss(asset.body.toString("utf8"), url)),
      });
  }
  const ast = parse(session.html);
  const walk = (node, base) => {
    if (node.tagName === "base")
      base = node.attrs.find((attr) => attr.name === "href")?.value || base;
    if (
      node.tagName === "link" &&
      node.attrs.some(
        (attr) => attr.name === "rel" && attr.value === "stylesheet",
      )
    ) {
      const href = node.attrs.find((attr) => attr.name === "href")?.value;
      const url = new URL(href, base).href;
      const text = session.css.get(url);
      if (text) {
        node.tagName = "style";
        node.nodeName = "style";
        node.attrs = [];
        node.childNodes = [
          { nodeName: "#text", value: text, parentNode: node },
        ];
        base = url;
      }
    }
    if (node.tagName === "style") {
      for (const child of node.childNodes || [])
        if (child.nodeName === "#text") {
          child.value = child.value.replace(
            /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,
            (_match, _quote, url) =>
              `url("${absoluteAsset(url, base, session, origin).replaceAll('"', "%22")}")`,
          );
          child.value = child.value.replace(
            /@import\s+(['"])([^'"]+)\1/g,
            (_match, _quote, url) =>
              `@import "${absoluteAsset(url, base, session, origin).replaceAll('"', "%22")}"`,
          );
        }
    }
    for (const attr of node.attrs || []) {
      if (["src", "poster"].includes(attr.name))
        attr.value = absoluteAsset(attr.value, base, session, origin);
      if (attr.name === "style")
        attr.value = attr.value.replace(
          /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,
          (_match, _quote, url) =>
            `url("${absoluteAsset(url, base, session, origin).replaceAll('"', "%22")}")`,
        );
    }
    for (const child of node.childNodes || []) walk(child, base);
  };
  const base =
    session.html.match(/<base href="([^"]+)"/)?.[1] || session.finalUrl;
  walk(ast, base);
  return serialize(ast);
}

function saveSession(session, request) {
  // Sessions belong to this API's access scope; unguessable resource URLs are only for the sandboxed preview.
  session.lastAccess = Date.now();
  session.bytes =
    [...session.assets.values()].reduce(
      (total, asset) => total + asset.body.length,
      0,
    ) +
    Buffer.byteLength(session.html) +
    [...session.css.values()].reduce(
      (total, text) => total + Buffer.byteLength(text),
      0,
    );
  if (session.bytes > 80 * 1024 * 1024)
    throw new Error("页面资源过大，请导入一个更小的页面");
  let bytes = [...sessions.values()].reduce(
    (total, item) => total + item.bytes,
    0,
  );
  if (sessions.has(session.id)) bytes -= session.bytes;
  for (const existing of [...sessions.values()].sort(
    (a, b) => a.lastAccess - b.lastAccess,
  )) {
    if (sessions.size < 30 && bytes + session.bytes <= 192 * 1024 * 1024) break;
    if (existing.id === session.id) continue;
    sessions.delete(existing.id);
    bytes -= existing.bytes;
  }
  sessions.set(session.id, session);
  const html = prepareHtml(session, originFor(request));
  return {
    id: session.id,
    token: session.token,
    html,
    title: session.title,
    location: session.location || session.finalUrl,
    mode: session.local ? "source" : "snapshot",
    nodes: session.nodes,
    width: session.width,
    height: session.height,
    warnings: session.warnings,
    mappedCount: session.nodes.filter((node) => node.file).length,
  };
}
app.get("/api/health", (_request, response) =>
  response.json({
    ok: true,
    localAccess,
    requiresKey: !!accessKey,
    version: "0.1.0",
  }),
);
app.post("/api/open", async (request, response) => {
  const input = inputSchema.parse(request.body);
  const isUrl = /^https?:\/\//i.test(input.location);
  if (!isUrl && !localAccess)
    throw new Error(
      "公开服务无法读取电脑路径，请选择项目文件夹，或使用网站链接",
    );
  const session = isUrl
    ? await capturePage(input.location, { ...input, localAccess })
    : await captureProject(input.location, { ...input, allowLocalResources:localAccess });
  response.json(saveSession(session, request));
});
app.post("/api/demo", async (request, response) => {
  const viewport = z.object(viewSchema).parse(request.body || {});
  const session = await captureProject(
    path.join(root, "examples", "atelier"),
    viewport,
  );
  session.location = "微调示例 / Atelier";
  response.json(saveSession(session, request));
});

app.post("/api/upload", async (request, response) => {
  const input = z
    .object({
      files: z
        .array(
          z.object({
            path: z.string().max(500),
            data: z.string().max(12 * 1024 * 1024),
          }),
        )
        .min(1)
        .max(800),
      ...viewSchema,
    })
    .parse(request.body);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "miweb-project-"));
  let total = 0;
  try {
    for (const file of input.files) {
      const portable = file.path.replaceAll("\\", "/");
      if (
        portable
          .split("/")
          .some(
            (segment) =>
              ["..", ".", ".git", "node_modules", ".env"].includes(segment) ||
              segment.startsWith(".env."),
          ) ||
        portable.includes(":") ||
        portable.startsWith("/") ||
        portable.includes("\0")
      )
        throw new Error("文件路径不合法。请排除 node_modules、.git 和 .env");
      const target = path.resolve(temporary, portable);
      if (!target.startsWith(temporary + path.sep))
        throw new Error("文件必须位于项目文件夹内");
      const bytes = Buffer.from(file.data, "base64");
      total += bytes.length;
      if (total > 24 * 1024 * 1024)
        throw new Error(
          "项目超过 24 MB。请排除构建产物与大型资源，或使用本地目录",
        );
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    const session = await captureProject(temporary, { ...input, allowLocalResources:localAccess });
    session.location = "已导入的项目";
    response.json(saveSession(session, request));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

app.get("/api/sessions/:id/assets/:asset", (request, response) => {
  const session = getSession(request.params.id);
  const asset = session.assetFiles.get(request.params.asset);
  if (!asset) return response.status(404).end();
  response.setHeader("Content-Type", asset.type);
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; sandbox;",
  );
  response.send(asset.body);
});
app.post("/api/sessions/:id/export", (request, response) => {
  const session = getSession(request.params.id);
  const { changes } = changesSchema.parse(request.body);
  response.json(exportChanges(session, changes));
});
app.post('/api/sessions/:id/ping',(request,response)=>{getSession(request.params.id);response.json({ok:true});});
app.get("/api/sessions/:id", (request, response) =>
  response.json(saveSession(getSession(request.params.id), request)),
);
app.delete("/api/sessions/:id", (request, response) => {
  sessions.delete(request.params.id);
  response.status(204).end();
});

app.use("/api", (error, _request, response, _next) => {
  if (error instanceof z.ZodError)
    return response
      .status(400)
      .json({ error: "输入格式不正确，请检查网址和调整数值" });
  console.error(`[miweb] ${error.message}`);
  response.status(error.status || 400).json({
    error:
      error.type === "entity.too.large"
        ? "导入文件太大，请排除大型资源"
        : error.message || "操作失败，请重试",
  });
});
app.use("/api", (_request, response) =>
  response.status(404).json({ error: "接口不存在" }),
);

let vite;
if (production) {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_request, response) =>
    response.sendFile(path.join(root, "dist", "index.html")),
  );
} else {
  vite = await createViteServer({
    root,
    cacheDir: path.join(root, "node_modules", ".vite-miweb-ui"),
    optimizeDeps: { force: true },
    server: { middlewareMode: true },
    appType: "custom",
  });
  app.use(vite.middlewares);
  app.get("/{*path}", async (request, response, next) => {
    try {
      response
        .type("html")
        .send(
          await vite.transformIndexHtml(
            request.originalUrl,
            await readFile(path.join(root, "index.html"), "utf8"),
          ),
        );
    } catch (error) {
      vite.ssrFixStacktrace(error);
      next(error);
    }
  });
}
const listener = app.listen(port, host, () =>
  console.log(
    `\n  微调 Miweb → http://${host}:${port}\n  本地项目接入: ${localAccess ? "开启" : "关闭"}\n`,
  ),
);
const cleanup = setInterval(() => {
  for (const [id, session] of sessions)
    if (Date.now() - session.lastAccess > ttl) sessions.delete(id);
}, 60000);
cleanup.unref();
async function shutdown() {
  clearInterval(cleanup);
  listener.close();
  await vite?.close();
  await closeBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
