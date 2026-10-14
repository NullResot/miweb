import { chromium } from "playwright";
import { allowedAddress, safeRequest, validateUrl } from "./network.mjs";
import { randomUUID } from "node:crypto";

let browserPromise;
let activeCaptures = 0;
async function boundedEvaluate(page, fn, argument) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(fn, argument),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("页面处理超时，请检查页面脚本或改用本地项目")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const browser = () =>
  (browserPromise ||= chromium
    .launch({
      headless: true,
      chromiumSandbox: process.env.CHROMIUM_SANDBOX === "1",
    })
    .catch((error) => {
      browserPromise = undefined;
      throw new Error(
        `页面渲染器无法启动。请在服务端运行 npm run browser:install。${error.message.slice(0, 80)}`,
      );
    }));

export async function closeBrowser() {
  if (browserPromise) await (await browserPromise).close();
  browserPromise = undefined;
}

export async function capturePage(
  url,
  {
    localAccess = false,
    trustedLocalOrigin,
    records = new Map(),
    width = 1280,
    height = 900,
    local = false,
  } = {},
) {
  if (activeCaptures >= 2)
    throw Object.assign(new Error("正在打开其他页面，请稍后重试"), {
      status: 429,
    });
  const entry = await validateUrl(url, localAccess);
  // A public page must not gain access to services on the user's computer/LAN.
  const allowLocalResources = localAccess && entry.addresses.every(({ address }) => !allowedAddress(address));
  activeCaptures++;
  let context;
  try {
    context = await (
      await browser()
    ).newContext({
      viewport: { width, height },
      serviceWorkers: "block",
      acceptDownloads: false,
      colorScheme: "light",
    });
    const assets = new Map();
    const css = new Map();
    let totalBytes = 0;
    let requestCount = 0;
    const page = await context.newPage();
    page.on("popup", (popup) => popup.close().catch(() => {}));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.routeWebSocket("**/*", (ws) => ws.close());
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() !== page.mainFrame())
        return route.abort();
      if (
        requestCount++ > 400 ||
        totalBytes > 60 * 1024 * 1024 ||
        !["GET", "POST", "HEAD"].includes(request.method())
      )
        return route.abort();
      try {
        const response = await safeRequest(request.url(), {
          localAccess: allowLocalResources && (!trustedLocalOrigin || new URL(request.url()).origin === trustedLocalOrigin),
          method: request.method(),
          headers: request.headers(),
          body: request.postDataBuffer(),
          maxBytes: 8 * 1024 * 1024,
          followRedirects: false,
        });
        totalBytes += response.body.length;
        const type =
          response.headers["content-type"] || "application/octet-stream";
        if (/text\/css/.test(type))
          css.set(request.url(), response.body.toString("utf8"));
        if (/^(image\/|font\/|text\/css)|woff|opentype|truetype/.test(type))
          assets.set(request.url(), { body: response.body, type });
        const headers = {
          ...response.headers,
          "access-control-allow-origin": "*",
        };
        for (const name of [
          "content-encoding",
          "content-length",
          "transfer-encoding",
          "set-cookie",
          "content-security-policy",
          "content-security-policy-report-only",
          "x-frame-options",
        ])
          delete headers[name];
        await route.fulfill({
          status: response.status,
          headers,
          body: response.body,
        });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    const response = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 35000 })
      .catch((error) => {
        if (error.name === "TimeoutError")
          throw new Error(
            "网站加载超时，页面脚本可能没有完成加载，请重试或改用本地项目",
          );
        throw new Error(
          `无法打开页面。请检查网址和服务是否运行。${error.message.includes("ERR") ? "网站可能限制了自动访问。" : ""}`,
        );
      });
    if (response && response.status() >= 400)
      throw new Error(
        `网站返回 ${response.status()}，请检查页面地址或访问权限`,
      );
    await page
      .waitForLoadState("networkidle", { timeout: 3000 })
      .catch(() => {});
    await boundedEvaluate(page, async () => {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
      document.getAnimations().forEach((animation) => {
        try {
          animation.finish();
        } catch {}
      });
      // Trigger lazy images in the current page without navigating into any subpage.
      document
        .querySelectorAll('img[loading="lazy"]')
        .forEach((img) => (img.loading = "eager"));
    });
    await page
      .waitForLoadState("networkidle", { timeout: 2000 })
      .catch(() => {});
    const captured = await boundedEvaluate(
      page,
      (cssTexts) => {
        const excluded = new Set([
          "SCRIPT",
        "VITE-ERROR-OVERLAY",
          "STYLE",
          "LINK",
          "META",
          "NOSCRIPT",
          "IFRAME",
          "OBJECT",
          "EMBED",
          "TEMPLATE",
          "SOURCE",
          "PATH",
          "DEFS",
          "CLIPPATH",
          "STOP",
        ]);
        const nodes = [];
        const originals = new Map();
        const selectorFor = (element) => {
          const parts = [];
          let current = element;
          while (current && current !== document.documentElement) {
            if (
              current.id &&
              document.querySelectorAll(`#${CSS.escape(current.id)}`).length ===
                1
            ) {
              parts.unshift(`#${CSS.escape(current.id)}`);
              break;
            }
            const classes = [...current.classList]
              .filter((name) => !name.startsWith("miweb-"))
              .slice(0, 2);
            let part =
              current.tagName.toLowerCase() +
              classes.map((name) => `.${CSS.escape(name)}`).join("");
            if (current.parentElement) {
              const siblings = [...current.parentElement.children].filter(
                (child) => child.tagName === current.tagName,
              );
              if (siblings.length > 1)
                part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
            parts.unshift(part);
            const candidate = parts.join(" > ");
            if (document.querySelectorAll(candidate).length === 1) break;
            current = current.parentElement;
          }
          return parts.join(" > ");
        };
        const elements = [...document.body.querySelectorAll("*")].slice(
          0,
          6000,
        );
        elements.forEach((element) => {
          if (
            excluded.has(element.tagName) ||
            (element.closest("svg") && element.tagName.toLowerCase() !== "svg")
          )
            return;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (style.display === "contents") return;
          const id = `n${nodes.length + 1}`;
          const text = (
            element.getAttribute("aria-label") ||
            element.getAttribute("alt") ||
            element.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 70);
          const layout = [
            "DIV",
            "SECTION",
            "ARTICLE",
            "NAV",
            "MAIN",
            "HEADER",
            "FOOTER",
            "UL",
            "OL",
            "FORM",
          ].includes(element.tagName);
          const ownText = [...element.childNodes]
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 70);
          const label = layout
            ? ownText ||
              element.getAttribute("aria-label") ||
              (element.id
                ? `#${element.id}`
                : element.classList.length
                  ? `.${[...element.classList].slice(0, 2).join(".")}`
                  : element.tagName.toLowerCase())
            : text ||
              (element.id ? `#${element.id}` : element.tagName.toLowerCase());
          const selector = selectorFor(element);
          const parent = element.parentElement?.closest("[data-mi-id]");
          originals.set(id, element.getAttribute("style"));
          const sourceId = element.getAttribute("data-mi-source");
          nodes.push({
            id,
            sourceId,
            parentId: parent?.getAttribute("data-mi-id") || null,
            tag: element.tagName.toLowerCase(),
            label,
            text,
            selector,
            baseTranslate: style.translate,
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
            fontSize: parseFloat(style.fontSize) || 16,
            borderRadius: parseFloat(style.borderRadius) || 0,
            display: style.display,
            importantStyles: [],
            layeredImportant: [],
            inlineImportant: [
              "translate",
              "width",
              "height",
              "box-sizing",
              "font-size",
              "border-radius",
            ].filter(
              (name) => element.style.getPropertyPriority(name) === "important",
            ),
            maxImportantIds: 0,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          });
          element.setAttribute("data-mi-id", id);
        });
        const nodeMap = new Map(nodes.map((node) => [node.id, node]));
        // Constructed stylesheets discard @import. When an imported stylesheet
        // is opaque, its text can reveal !important but not its inherited layer.
        // Conservatively use the inline patch for those important declarations.
        let uncertainImportedLayer = cssTexts.some((text) => /@import\b/i.test(text));
        const readRules = (rules, parentSelector, inLayer = false) => {
          for (const rule of rules) {
            if (
              rule.type === CSSRule.SUPPORTS_RULE &&
              !CSS.supports(rule.conditionText)
            )
              continue;
            const layered = inLayer ||
              (typeof CSSLayerBlockRule !== "undefined" && rule instanceof CSSLayerBlockRule);
            if (rule.type === CSSRule.IMPORT_RULE) {
              const importedLayer = layered || rule.layerName != null;
              try {
                readRules(rule.styleSheet.cssRules, parentSelector, importedLayer);
              } catch {
                if (importedLayer) uncertainImportedLayer = true;
              }
            }
            let selector = rule.selectorText;
            if (selector && parentSelector)
              selector = selector.includes("&")
                ? selector.replaceAll("&", `:is(${parentSelector})`)
                : `:is(${parentSelector}) ${selector}`;
            if (selector && rule.style) {
              const important = [
                "translate",
                "width",
                "height",
                "box-sizing",
                "font-size",
                "border-radius",
              ].filter(
                (name) => rule.style.getPropertyPriority(name) === "important",
              );
              if (important.length)
                try {
                  const ids = (selector.match(/#[\w-]/g) || []).length;
                  const neutral = selector.replace(
                    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|:not\([^()]*:(?:hover|active|focus-visible|focus-within|focus|visited|checked|disabled|enabled|indeterminate|target)[^()]*\)|(?<!\\):(?:hover|active|focus-visible|focus-within|focus|visited|checked|disabled|enabled|indeterminate|target)\b/g,
                    (match, quoted) => quoted || ":is(*)",
                  );
                  const candidates = new Set([
                    ...document.querySelectorAll(selector),
                    ...document.querySelectorAll(neutral),
                  ]);
                  for (const element of candidates) {
                    const node = nodeMap.get(
                      element.getAttribute("data-mi-id"),
                    );
                    if (node) {
                      node.importantStyles.push(...important);
                      if (layered) node.layeredImportant.push(...important);
                      node.maxImportantIds = Math.max(
                        node.maxImportantIds,
                        ids,
                      );
                    }
                  }
                } catch {}
            }
            if (rule.cssRules)
              readRules(rule.cssRules, selector || parentSelector, layered);
          }
        };
        for (const sheet of document.styleSheets)
          try {
            readRules(sheet.cssRules);
          } catch {}
        for (const text of cssTexts)
          try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(text);
            readRules(sheet.cssRules);
          } catch {}
        for (const node of nodes) {
          node.importantStyles = [
            ...new Set([...node.importantStyles, ...node.inlineImportant]),
          ];
          node.layeredImportant = [...new Set(
            uncertainImportedLayer ? node.importantStyles : node.layeredImportant,
          )];
        }
        const clone = document.documentElement.cloneNode(true);
        const runtimeStyles = [...document.querySelectorAll("style")].map(
          (style) => {
            try {
              return (
                [...(style.sheet?.cssRules || [])]
                  .map((rule) => rule.cssText)
                  .join("\n") || style.textContent
              );
            } catch {
              return style.textContent;
            }
          },
        );
        clone.querySelectorAll("style").forEach((style, index) => {
          style.textContent = runtimeStyles[index] || "";
        });
        for (const sheet of document.adoptedStyleSheets || []) {
          const style = document.createElement("style");
          try {
            style.textContent = [...sheet.cssRules]
              .map((rule) => rule.cssText)
              .join("\n");
            clone.querySelector("head").append(style);
          } catch {}
        }
        clone
          .querySelectorAll(
            'script, noscript, iframe, object, embed, base, meta[http-equiv], link[rel="preload"], link[rel="modulepreload"], link[rel="prefetch"], link[rel="manifest"]',
          )
          .forEach((element) => element.remove());
        clone.querySelectorAll("*").forEach((element) => {
          [...element.attributes].forEach((attr) => {
            if (
              /^on/i.test(attr.name) ||
              attr.name === "srcdoc" ||
              attr.name === "nonce" ||
              attr.name === "integrity" ||
              attr.name === "data-mi-source"
            )
              element.removeAttribute(attr.name);
            if (
              ["href", "src", "action", "formaction", "xlink:href"].includes(
                attr.name,
              ) &&
              /^\s*(javascript|vbscript):/i.test(attr.value)
            )
              element.removeAttribute(attr.name);
          });
          if (element.tagName === "IMG") {
            const original = document.querySelector(
              `[data-mi-id="${element.getAttribute("data-mi-id")}"]`,
            );
            if (original?.currentSrc)
              element.setAttribute("src", original.currentSrc);
            element.removeAttribute("srcset");
            element.removeAttribute("loading");
          }
          if (element.tagName === "INPUT") {
            const original = document.querySelector(
              `[data-mi-id="${element.getAttribute("data-mi-id")}"]`,
            );
          if (original?.type === "password") element.removeAttribute('value');
          else
              element.setAttribute("value", original?.value || "");
          if (original?.checked) element.setAttribute('checked',''); else element.removeAttribute('checked');
          }
        if (element.tagName === 'TEXTAREA') { const original=document.querySelector(`[data-mi-id="${element.getAttribute('data-mi-id')}"]`);element.textContent=original?.value || ''; }
        if (element.tagName === 'OPTION') { const original=document.querySelector(`[data-mi-id="${element.getAttribute('data-mi-id')}"]`);if(original?.selected) element.setAttribute('selected','');else element.removeAttribute('selected'); }
        });
        const head = clone.querySelector("head");
        const base = document.createElement("base");
        base.href = document.baseURI;
        head.prepend(base);
        const html = "<!DOCTYPE html>\n" + clone.outerHTML;
        if (html.length > 10 * 1024 * 1024)
          throw new Error("页面内容过大，无法生成快照");
        return {
          html,
          nodes,
          title: document.title || location.hostname,
          finalUrl: location.href,
          originals: Object.fromEntries(originals),
          count: elements.length,
        };
      },
      [...css.values()],
    );
    if (!captured.nodes.some(node=>node.width>0 && node.height>0 && node.display!=='none'))
      throw new Error(
        `页面没有可调整的元素。请确认页面已经加载，或改用本地项目${local && errors[0] ? `。项目报错：${errors[0].slice(0, 160)}` : ""}`,
      );
    for (const node of captured.nodes) {
      const record = records.get(node.sourceId);
      if (!record || record.tag.toLowerCase() !== node.tag) {
        delete node.sourceId;
        continue;
      }
      if (record && record.exportable !== false) {
        node.file = record.path;
        node.line = record.line;
        if (record.kind === "jsx" && node.importantStyles.length)
          node.mappingWarning =
            "原页面有高优先级样式，调整这些属性时会导出布局补丁以保证效果一致";
      } else if (record)
        node.mappingWarning =
          "元素的样式由展开属性决定，将导出 CSS 补丁以保留原有逻辑";
    }
    return {
      ...captured,
      assets,
      css,
      records,
      local,
      id: randomUUID(),
      token: randomUUID(),
      created: Date.now(),
      width,
      height,
      warnings: [
        ...(errors.length && local
          ? ["页面中有脚本报错，部分内容可能没有加载。"]
          : []),
        ...(captured.count >= 6000
          ? ["页面较大，目前展示前 6000 个元素。"]
          : []),
      ],
    };
  } finally {
    activeCaptures--;
    await context?.close().catch(() => {});
  }
}
