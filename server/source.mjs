import { parse as parseJs } from "@babel/parser";
import { parse as parseHtml } from "parse5";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { parse as parseTemplate } from "@vue/compiler-dom";
import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";

const keyFor = (path, start) =>
  createHash("sha256").update(`${path}:${start}`).digest("hex").slice(0, 16);
const escapeAttr = (value) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
const openingEnd = (text) => {
  let quote = null;
  for (let i = 1; i < text.length; i++) {
    if (quote) {
      if (text[i] === quote) quote = null;
    } else if (text[i] === '"' || text[i] === "'") quote = text[i];
    else if (text[i] === ">") return i + 1;
  }
  return 0;
};

export function applyEdits(source, edits) {
  let end = source.length;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.end > end || edit.start > edit.end || edit.start < 0)
      throw new Error("源码修改范围冲突");
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    end = edit.start;
  }
  return source;
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "tokens" || key === "comments") continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

// Source offsets always refer to the original file. Instrumentation is used only during preview.
export function instrumentSource(source, path, records = new Map()) {
  const edits = [];
  if (/\.[jt]sx$/.test(path)) {
    const ast = parseJs(source, {
      sourceType: "unambiguous",
      plugins: ["jsx", "typescript"],
    });
    walk(ast, (node) => {
      if (
        node.type !== "JSXOpeningElement" ||
        node.name.type !== "JSXIdentifier" ||
        !/^[a-z]/.test(node.name.name)
      )
        return;
      const id = keyFor(path, node.start);
      const insert = node.end - (node.selfClosing ? 2 : 1);
      const style = node.attributes.find(
        (attr) => attr.type === "JSXAttribute" && attr.name.name === "style",
      );
      const lastSpread = node.attributes.findLast(
        (attr) => attr.type === "JSXSpreadAttribute",
      );
      const exportable = !(
        lastSpread &&
        (!style || lastSpread.start > style.start)
      );
      records.set(id, {
        id,
        path,
        source,
        kind: "jsx",
        start: node.start,
        insert,
        style,
        exportable,
        tag: node.name.name,
        line: node.loc.start.line,
      });
      edits.push({
        start: insert,
        end: insert,
        text: ` data-mi-source="${id}"`,
      });
    });
  } else if (/\.vue$/.test(path)) {
    const sfc = parseSfc(source).descriptor;
    if (!sfc.template || sfc.template.lang) return { code: source, records };
    const base = sfc.template.loc.start.offset;
    const ast = parseTemplate(sfc.template.content);
    const visit = (node) => {
      if (node.type === 1 && node.tagType === 0) {
        const start = base + node.loc.start.offset;
        const opening = node.loc.source.slice(0, openingEnd(node.loc.source));
        if (opening) {
          const insert =
            start + opening.length - (opening.endsWith("/>") ? 2 : 1);
          const id = keyFor(path, start);
          const style =
            node.props.find(
              (prop) =>
                prop.type === 7 &&
                prop.name === "bind" &&
                prop.arg?.content === "style",
            ) ||
            node.props.find((prop) => prop.type === 6 && prop.name === "style");
          const exportable = !node.props.some(
            (prop) => prop.type === 7 && prop.name === "bind" && !prop.arg,
          );
          records.set(id, {
            id,
            path,
            source,
            kind: "vue",
            start,
            insert,
            style,
            base,
            exportable,
            tag: node.tag,
            line: source.slice(0, start).split("\n").length,
          });
          edits.push({
            start: insert,
            end: insert,
            text: ` data-mi-source="${id}"`,
          });
        }
      }
      node.children?.forEach(visit);
    };
    visit(ast);
  } else if (/\.html?$/.test(path)) {
    const ast = parseHtml(source, { sourceCodeLocationInfo: true });
    const visit = (node) => {
      const loc = node.sourceCodeLocation?.startTag;
      if (
        loc &&
        ![
          "html",
          "head",
          "body",
          "script",
          "style",
          "link",
          "meta",
          "title",
          "base",
        ].includes(node.tagName)
      ) {
        const id = keyFor(path, loc.startOffset);
        const insert =
          loc.endOffset -
          (source.slice(loc.startOffset, loc.endOffset).endsWith("/>") ? 2 : 1);
        const style = node.sourceCodeLocation.attrs?.style;
        records.set(id, {
          id,
          path,
          source,
          kind: "html",
          start: loc.startOffset,
          insert,
          style,
          tag: node.tagName,
          styleValue: node.attrs.find((attr) => attr.name === "style")?.value,
          line: loc.startLine,
        });
        edits.push({
          start: insert,
          end: insert,
          text: ` data-mi-source="${id}"`,
        });
      }
      node.childNodes?.forEach(visit);
    };
    visit(ast);
  }
  return { code: applyEdits(source, edits), records };
}

const cssName = (name) =>
  name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
export function styleProperties(change, node) {
  const result = {};
  if (change.x || change.y) {
    const original = node?.baseTranslate;
    if (original && original !== "none") {
      const [x = "0px", y = "0px", z] = original.split(/\s+(?![^()]*\))/);
      result.translate = `calc(${x} + ${change.x || 0}px) calc(${y} + ${change.y || 0}px)${z ? ` ${z}` : ""}`;
    } else result.translate = `${change.x || 0}px ${change.y || 0}px`;
  }
  if (change.width != null) result.width = `${change.width}px`;
  if (change.height != null) result.height = `${change.height}px`;
  if (change.width != null || change.height != null)
    result.boxSizing = "border-box";
  if (change.fontSize != null) result.fontSize = `${change.fontSize}px`;
  if (change.borderRadius != null)
    result.borderRadius = `${change.borderRadius}px`;
  return result;
}

function editInlineCss(raw, properties) {
  // Respect semicolons inside quoted URLs, CSS functions, and comments.
  const pending = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [cssName(key), value]),
  );
  const edits = [];
  let start = 0,
    quote = null,
    depth = 0,
    comment = false;
  for (let i = 0; i <= raw.length; i++) {
    const char = raw[i];
    if (comment) {
      if (char === "*" && raw[i + 1] === "/") {
        comment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && raw[i + 1] === "*") {
      comment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    if (char === ")") depth--;
    if ((char === ";" && depth === 0) || i === raw.length) {
      const declaration = raw.slice(start, i);
      const match = declaration.match(/^(\s*([\w-]+)\s*:\s*)([\s\S]*?)(\s*)$/);
      if (match && Object.hasOwn(pending, match[2].toLowerCase())) {
        const name = match[2].toLowerCase();
        edits.push({
          start: start + match[1].length,
          end: i - match[4].length,
          text: `${pending[name]}${/!important\s*$/i.test(match[3]) && !/!important\s*$/i.test(pending[name]) ? " !important" : ""}`,
        });
      }
      start = i + 1;
    }
  }
  let result = applyEdits(raw, edits);
  const touched = new Set(
    edits.map((edit) =>
      raw
        .slice(0, edit.start)
        .match(/([\w-]+)\s*:\s*$/)?.[1]
        ?.toLowerCase(),
    ),
  );
  for (const [name, value] of Object.entries(pending))
    if (!touched.has(name)) {
      if (result && !result.trimEnd().endsWith(";")) result += ";";
      result += `${result ? " " : ""}${name}: ${value};`;
    }
  return result;
}

function recordEdit(record, properties) {
  const { source, style, insert } = record;
  const objectFields = Object.entries(properties)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
  if (record.kind === "jsx") {
    if (!style)
      return {
        start: insert,
        end: insert,
        text: ` style={{ ${objectFields} }}`,
      };
    if (style.value?.type !== "JSXExpressionContainer")
      throw new Error("这个元素的 style 不是 React 样式对象，请导出 CSS 补丁");
    const expression = style.value.expression;
    if (expression.type === "ObjectExpression") {
      // Change only touched values, and insert missing properties at the closing brace.
      const edits = [];
      const rest = { ...properties };
      const hasSpread = expression.properties.some(
        (prop) =>
          prop.type === "SpreadElement" ||
          prop.type === "ObjectMethod" ||
          prop.computed,
      );
      if (hasSpread)
        return {
          start: expression.start,
          end: expression.end,
          text: `{ ...(${source.slice(expression.start, expression.end)}), ${objectFields} }`,
        };
      if (!hasSpread) {
        for (const prop of expression.properties) {
          const key = prop.key?.name || prop.key?.value;
          if (
            prop.type === "ObjectProperty" &&
            !prop.computed &&
            Object.hasOwn(properties, key)
          ) {
            edits.push(
              prop.shorthand
                ? {
                    start: prop.start,
                    end: prop.end,
                    text: `${key}: ${JSON.stringify(properties[key])}`,
                  }
                : {
                    start: prop.value.start,
                    end: prop.value.end,
                    text: JSON.stringify(properties[key]),
                  },
            );
            delete rest[key];
          }
        }
      }
      const fields = Object.entries(rest)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(", ");
      if (fields) {
        const prefix =
          expression.properties.length &&
          expression.extra?.trailingComma == null
            ? ","
            : "";
        edits.push({
          start: expression.end - 1,
          end: expression.end - 1,
          text: `${prefix} ${fields} `,
        });
      }
      return edits;
    }
    const original = source.slice(expression.start, expression.end);
    return {
      start: expression.start,
      end: expression.end,
      text: `{ ...(${original}), ${objectFields} }`,
    };
  }
  if (record.kind === "vue") {
    if (!style) {
      const css = editInlineCss("", properties);
      return {
        start: insert,
        end: insert,
        text: ` style="${escapeAttr(css)}"`,
      };
    }
    if (style.type === 7) {
      if (!style.exp) throw new Error("无法定位绑定样式，请导出 CSS 补丁");
      const start = record.base + style.loc.start.offset;
      const end = record.base + style.loc.end.offset;
      const prefix = source
        .slice(start, record.base + style.exp.loc.start.offset)
        .replace(/["']$/, "");
      const original = style.exp.content;
      return {
        start,
        end,
        text: `${prefix}"${escapeAttr(`[(${original}), { ${objectFields} }]`)}"`,
      };
    }
    const start = record.base + style.loc.start.offset;
    const end = record.base + style.loc.end.offset;
    return {
      start,
      end,
      text: `style="${escapeAttr(editInlineCss(style.value?.content || "", properties))}"`,
    };
  }
  if (!style)
    return {
      start: insert,
      end: insert,
      text: ` style="${escapeAttr(editInlineCss("", properties))}"`,
    };
  const raw = source.slice(style.startOffset, style.endOffset);
  const oldValue =
    record.styleValue ??
    raw.match(/^style\s*=\s*["']([\s\S]*)["']$/i)?.[1] ??
    raw.match(/^style\s*=\s*([^\s]*)/i)?.[1] ??
    "";
  return {
    start: style.startOffset,
    end: style.endOffset,
    text: `style="${escapeAttr(editInlineCss(oldValue, properties))}"`,
  };
}

export function exportChanges(session, changes) {
  const bySource = new Map();
  let mappedInstances = 0;
  const active = changes.filter(
    (change) =>
      Object.keys(
        styleProperties(
          change,
          session.nodes.find((node) => node.id === change.id),
        ),
      ).length,
  );
  const css = active
    .map((change) => {
      const node = session.nodes.find((node) => node.id === change.id);
      if (!node) throw new Error("元素已不存在，请重新打开页面");
      if (
        /[{}\n\r]/.test(node.selector.replace(/\\(?:[0-9a-f]{1,6}\s?|.)/gi, ""))
      )
        throw new Error("无法安全导出这个选择器");
      const blocked = Object.keys(styleProperties(change, node)).some((key) =>
        node.importantStyles?.includes(cssName(key)),
      );
      const specificity =
        "#miweb-unused" +
        Array.from(
          { length: Math.min(128, (node.maxImportantIds || 0) + 1) },
          (_, index) => `#miweb-unused-${index}`,
        ).join("");
      const selector = blocked
        ? `:is(${node.selector}, ${specificity})`
        : node.selector;
      return `/* ${node.label.replaceAll("*/", "").replaceAll('<','\\3c ')} */\n${selector} {\n${Object.entries(
        styleProperties(change, node),
      )
        .map(([key, value]) => `  ${cssName(key)}: ${value} !important;`)
        .join("\n")}\n}`;
    })
    .join("\n\n");
  for (const change of active) {
    const node = session.nodes.find((node) => node.id === change.id);
    if (
      !node?.sourceId ||
      !session.records.has(node.sourceId) ||
      session.records.get(node.sourceId).exportable === false
    )
      continue;
    const record = session.records.get(node.sourceId);
    const properties = styleProperties(change, node);
    if (
      record.kind === "jsx" &&
      Object.keys(properties).some((key) =>
        node.importantStyles?.includes(cssName(key)),
      )
    )
      continue;
    if (change.x || change.y) {
      const sameSource = session.nodes.filter(
        (item) => item.sourceId === node.sourceId,
      );
      if (sameSource.some((item) => item.baseTranslate !== node.baseTranslate))
        continue;
    }
    const prior = bySource.get(node.sourceId);
    if (
      prior &&
      JSON.stringify(prior.change) !==
        JSON.stringify({ ...change, id: prior.change.id })
    )
      throw new Error("同一个源码元素有多个实例，修改值需要一致");
    bySource.set(node.sourceId, { change, node });
    mappedInstances++;
  }
  const files = new Map();
  for (const [sourceId, { change, node }] of bySource) {
    const record = session.records.get(sourceId);
    const properties = styleProperties(change, node);
    if (record.kind !== "jsx")
      for (const key of Object.keys(properties))
        if (node.importantStyles?.includes(cssName(key)))
          properties[key] += " !important";
    if (!files.has(record.path))
      files.set(record.path, {
        path: record.path,
        original: record.source,
        edits: [],
      });
    files
      .get(record.path)
      .edits.push(...[recordEdit(record, properties)].flat());
  }
  const result = [...files.values()].map((file) => {
    const updated = applyEdits(file.original, file.edits);
    return {
      path: file.path,
      original: file.original,
      updated,
      diff: createTwoFilesPatch(
        `a/${file.path}`,
        `b/${file.path}`,
        file.original,
        updated,
        "",
        "",
        { context: 3 },
      ),
    };
  });
  const needsJavaScript = active.some((change) => {
    const node = session.nodes.find((node) => node.id === change.id);
    return (
      node.maxImportantIds > 126 ||
      Object.keys(styleProperties(change, node)).some((key) =>
        node.inlineImportant?.includes(cssName(key)) ||
        node.layeredImportant?.includes(cssName(key)),
      )
    );
  });
  const patches = active.map((change) => {
    const node = session.nodes.find((node) => node.id === change.id);
    return {
      selector: node.selector,
      properties: Object.fromEntries(
        Object.entries(styleProperties(change, node)).map(([key, value]) => [
          cssName(key),
          value,
        ]),
      ),
    };
  });
  const javascript = needsJavaScript
    ? `/* 微调布局补丁：覆盖原有高优先级 !important，保留其他样式 */\n(() => {\n  const patches = ${JSON.stringify(patches, null, 2)};\n  const expected = new WeakMap();\n  const apply = () => {\n    for (const patch of patches) for (const element of document.querySelectorAll(patch.selector)) {\n      const values = expected.get(element) || {};\n      for (const [name, value] of Object.entries(patch.properties)) {\n        if (element.style.getPropertyValue(name) !== values[name] || element.style.getPropertyPriority(name) !== 'important') {\n          element.style.setProperty(name, value, 'important');\n          values[name] = element.style.getPropertyValue(name);\n        }\n      }\n      expected.set(element, values);\n    }\n  };\n  let pending = false;\n  const observer = new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; apply(); }); } });\n  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'id'] });\n  apply();\n})();`
    : "";
  return {
    css,
    javascript,
    files: result,
    mapped: mappedInstances,
    total: active.length,
    diff: result.map((file) => file.diff).join("\n"),
  };
}
