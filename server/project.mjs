import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import { instrumentSource } from "./source.mjs";
import { safeProjectCss } from './project-css.mjs';
import { capturePage } from "./capture.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath, stat, readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dependencies = path.join(appRoot, "node_modules");

export async function captureProject(
  projectPath,
  { width, height, entry = "index.html", allowLocalResources=false } = {},
) {
  const absolute = await realpath(projectPath).catch(() => {
    throw new Error(
      "找不到这个项目目录。请输入服务所在电脑上的完整路径，或选择项目文件夹",
    );
  });
  if (!(await stat(absolute)).isDirectory())
    throw new Error("请输入项目目录，而不是文件路径");
  const entryPath = path.resolve(absolute, entry);
  const relativeEntry = path.relative(absolute, entryPath);
  if (
    relativeEntry.startsWith("..") ||
    path.isAbsolute(relativeEntry) ||
    !/\.html?$/.test(entry)
  )
    throw new Error("入口必须是项目目录内的 HTML 文件");
  const resolvedEntry = await realpath(entryPath).catch(() => {
    throw new Error(
      "目录中没有 index.html。支持 HTML 或 Vite 的 React/Vue 项目；也可以输入已经启动的 localhost 链接",
    );
  });
  if (!resolvedEntry.startsWith(absolute + path.sep))
    throw new Error("入口文件不能位于项目目录之外");
  const original = await readFile(resolvedEntry, "utf8");
  const records = new Map();
  const instrumentation = {
    name: "miweb-source-map",
    enforce: "pre",
    async transform(code, id) {
      const filename = id.split("?")[0];
      if (/[?&](?:raw|url)(?:[=&]|$)/.test(id)) return;
      if(/\.(?:scss|sass|less|styl|stylus|sss)(?:$|\?)/i.test(id) || /[?&]lang=(?:scss|sass|less|styl|stylus|sss)/i.test(id)) throw new Error('项目预览不会运行样式预处理器，请先启动项目开发服务并输入页面链接');
      if(/\.css(?:$|\?)/i.test(id) || (id.includes('type=style') && !/[?&]lang(?:=|\.)/.test(id))) {
        const expanded=await safeProjectCss(code,filename,[absolute,dependencies],[],undefined,{allowLocalResources});
        // Keep the input that CSS Modules hashes identical to the original project.
        return {code:/\.module\.css$/i.test(filename)||id.includes('&module')?code:expanded,map:null};
      }
      if (
        id.includes("?") ||
        !/\.(jsx|tsx|vue)$/.test(filename) ||
        filename.includes("node_modules")
      )
        return;
      const relative = path.relative(absolute, filename).replaceAll("\\", "/");
      if (relative.startsWith("..")) return;
      return {
        code: instrumentSource(code, relative, records).code,
        map: null,
      };
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return instrumentSource(
          html,
          relativeEntry.replaceAll("\\", "/"),
          records,
        ).code;
      },
    },
  };
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "miweb-vite-"));
  let server;
  try {
    server = await createServer({
      configFile: false,
      envFile: false,
      envPrefix: [],
      css: { postcss: { plugins: [] } },
      root: absolute,
      cacheDir,
      logLevel: "silent",
      plugins: [
        instrumentation,
        react({ babel: { babelrc: false, configFile: false } }),
        vue(),
      ],
      resolve: {
        alias: [
          {
            find: /^react$/,
            replacement: path.join(dependencies, "react/index.js"),
          },
          {
            find: /^react\/(.*)$/,
            replacement: `${dependencies.replaceAll("\\", "/")}/react/$1`,
          },
          {
            find: /^react-dom$/,
            replacement: path.join(dependencies, "react-dom/index.js"),
          },
          {
            find: /^react-dom\/(.*)$/,
            replacement: `${dependencies.replaceAll("\\", "/")}/react-dom/$1`,
          },
          {
            find: /^vue$/,
            replacement: path.join(
              dependencies,
              "vue/dist/vue.runtime.esm-bundler.js",
            ),
          },
          { find: "@", replacement: path.join(absolute, "src") },
        ],
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        hmr: false,
        fs: { strict: true, allow: [absolute, dependencies] },
        watch: { ignored: ["**/*"] },
      },
      optimizeDeps: {
        noDiscovery: true,
        include: [
          "react",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ],
      },
    });
    await server.listen();
    const address = server.httpServer.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const result = await capturePage(
      `http://127.0.0.1:${address.port}/${relativeEntry.replaceAll("\\", "/")}`,
      { width, height, records, localAccess: true, local: true, trustedLocalOrigin: allowLocalResources ? undefined : origin },
    );
    result.location = projectPath;
    result.finalUrl = projectPath;
    result.title ||= path.basename(absolute);
    result.originalHtml = original;
    return result;
  } finally {
    await server?.close();
    if (
      path.resolve(cacheDir).startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(cacheDir).startsWith("miweb-vite-")
    )
      await rm(cacheDir, { recursive: true, force: true });
  }
}
