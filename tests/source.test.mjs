import test from "node:test";
import assert from "node:assert/strict";
import { parse as parseJs } from "@babel/parser";
import { parse as parseVue, compileTemplate } from "@vue/compiler-sfc";
import {
  instrumentSource,
  exportChanges,
  applyEdits,
  styleProperties,
} from "../server/source.mjs";

const fixture = (source, path, which = 0) => {
  const { code, records } = instrumentSource(source, path);
  const record = [...records.values()][which];
  const node = {
    id: "n1",
    sourceId: record.id,
    selector: "#target",
    label: "目标按钮",
    baseTranslate: "none",
  };
  return { code, record, session: { nodes: [node], records } };
};
test("HTML export changes one attribute and keeps the rest byte-for-byte, including CRLF and Unicode", () => {
  const source =
    '<!doctype html>\r\n<!-- 保留注释 -->\r\n<button id="target" class="cta">开始 ✨</button>\r\n<script>const x = 1;</script>';
  const { code, session } = fixture(source, "index.html");
  assert.match(code, /data-mi-source/);
  const result = exportChanges(session, [{ id: "n1", x: 0, y: -8 }]);
  assert.equal(
    result.files[0].updated,
    source.replace('class="cta"', 'class="cta" style="translate: 0px -8px;"'),
  );
  assert.ok(!result.files[0].updated.includes("data-mi-"));
  assert.match(result.diff, /-<button/);
  assert.match(result.css, /translate: 0px -8px !important/);
});
test("HTML inline CSS preserves data URLs, comments, other values and existing important", () => {
  const source = `<button style="background: url('data:image/svg+xml;a;b'); /* hello; */ color: red; width: 20px !important; padding: 4px">OK</button>`;
  const { session } = fixture(source, "index.html");
  const updated = exportChanges(session, [{ id: "n1", x: 0, y: 0, width: 40 }])
    .files[0].updated;
  assert.match(
    updated,
    /background: url\('data:image\/svg\+xml;a;b'\); \/\* hello; \*\/ color: red;/,
  );
  assert.match(updated, /width: 40px !important/);
  assert.match(updated, /padding: 4px/);
});
test("JSX updates touched object values while preserving expressions, comments and component code", () => {
  const source = `const accent = 'red';\nexport default function View() { return <button className="cta" style={{ color: accent, width: 100 /* keep */ }}>OK</button>; }\n`;
  const { session } = fixture(source, "src/View.tsx");
  const updated = exportChanges(session, [
    { id: "n1", x: 3, y: -2, width: 130 },
  ]).files[0].updated;
  assert.match(updated, /color: accent, width: "130px" \/\* keep \*\//);
  assert.match(updated, /translate: "3px -2px"/);
  assert.doesNotThrow(() =>
    parseJs(updated, { sourceType: "module", plugins: ["jsx", "typescript"] }),
  );
  assert.equal(updated.split("\n")[0], source.split("\n")[0]);
});
test("JSX dynamic style expression and spread retain original evaluation", () => {
  for (const expression of [
    "styles.primary",
    "{ ...styles.primary, width: 10 }",
    "active ? first : second",
  ]) {
    const source = `export const App = () => <button style={${expression}}>go</button>`;
    const { session } = fixture(source, "App.jsx");
    const updated = exportChanges(session, [
      { id: "n1", x: 0, y: 0, width: 80 },
    ]).files[0].updated;
    assert.ok(updated.includes(`...(${expression})`));
    assert.doesNotThrow(() =>
      parseJs(updated, { sourceType: "module", plugins: ["jsx"] }),
    );
  }
});
test("JSX shorthand and duplicate properties are updated with valid syntax", () => {
  for (const object of ["width, color", "width: 1, width: 2"]) {
    const source = `const width=1, color='red'; const App = () => <button style={{${object}}}>go</button>`;
    const { session } = fixture(source, "App.jsx");
    const updated = exportChanges(session, [
      { id: "n1", x: 0, y: 0, width: 80 },
    ]).files[0].updated;
    assert.doesNotThrow(() =>
      parseJs(updated, { sourceType: "module", plugins: ["jsx"] }),
    );
    assert.ok(!/width: [12]/.test(updated));
  }
});
test("attributes that may overwrite style use CSS fallback instead of incorrect source edits", () => {
  for (const [source, path] of [
    [
      "const App=()=><button style={{width:10}} {...props}>go</button>",
      "App.jsx",
    ],
    ['<template><button v-bind="props">go</button></template>', "App.vue"],
  ]) {
    const { session } = fixture(source, path);
    const result = exportChanges(session, [
      { id: "n1", x: 0, y: 0, width: 80 },
    ]);
    assert.equal(result.files.length, 0);
    assert.match(result.css, /width: 80px/);
  }
});
test("Vue mapping handles > inside an attribute and leaves script and scoped styles untouched", () => {
  const source = `<script setup>const size = 2</script>\n<template><button v-if="size > 1" :style="{ color: 'red' }">你好</button></template>\n<style scoped>button { padding: 4px }</style>`;
  const { code, session } = fixture(source, "src/App.vue");
  assert.match(code, /v-if="size > 1" :style=.*data-mi-source=/);
  const updated = exportChanges(session, [{ id: "n1", x: -2, y: 0 }]).files[0]
    .updated;
  assert.match(updated, /translate: &quot;-2px 0px&quot;/);
  assert.equal(parseVue(updated).errors.length, 0);
  assert.equal(updated.split("\n")[0], source.split("\n")[0]);
  assert.equal(updated.split("\n")[2], source.split("\n")[2]);
});
test("Vue static inline styles preserve the unrelated declarations", () => {
  const source =
    '<template><div style="color: red; width: 20px;">hello</div></template>';
  const { session } = fixture(source, "App.vue");
  const updated = exportChanges(session, [{ id: "n1", x: 0, y: 0, width: 55 }])
    .files[0].updated;
  assert.match(updated, /color: red; width: 55px;/);
});
test("multiple edits and empty export do not replace the original file", () => {
  assert.equal(
    applyEdits("abcdef", [
      { start: 1, end: 2, text: "X" },
      { start: 4, end: 5, text: "Y" },
    ]),
    "aXcdYf",
  );
  assert.throws(
    () =>
      applyEdits("abc", [
        { start: 1, end: 3, text: "x" },
        { start: 2, end: 3, text: "y" },
      ]),
    /冲突/,
  );
  const { session } = fixture("<button>OK</button>", "index.html");
  assert.deepEqual(exportChanges(session, []).files, []);
});
test("existing translate and transforms are composed without destroying the baseline", () => {
  assert.equal(
    styleProperties({ x: -8, y: 2 }, { baseTranslate: "10% 3px" }).translate,
    "calc(10% + -8px) calc(3px + 2px)",
  );
});
test('JSX preserves trailing comments and computed properties without invalid object syntax', () => {
  for (const object of ["/* only a comment */", "color: 'red', /* trailing */", "color: 'red', // trailing\n", "width: 20, ['width']: 30"]) {
    const source = `const App = () => <button style={{${object}}}>go</button>`;
    const { session } = fixture(source, 'App.jsx');
    const updated = exportChanges(session, [{ id:'n1', x:0, y:0, width:80 }]).files[0].updated;
    const ast = parseJs(updated, { sourceType:'module', plugins:['jsx'] });
    assert.ok(ast);
    if (object.includes("['width']")) assert.match(updated, /\.\.\.\(/);
    if (object.includes('comment') || object.includes('trailing')) assert.ok(updated.includes(object));
  }
});
test('Vue entity-encoded style values with single quoted attributes still compile after export', () => {
  const source = `<template><button :style='{ color: &#39;red&#39; }'>go</button></template>`;
  const { session } = fixture(source, 'App.vue');
  const updated = exportChanges(session, [{id:'n1',x:0,y:0,width:80}]).files[0].updated;
  const descriptor = parseVue(updated).descriptor;
  assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:'App.vue',id:'test'}).errors, []);
});
test("repeated source instances export only one source edit and conflicting values are rejected", () => {
  const { session } = fixture("<button>hello</button>", "index.html");
  session.nodes.push({ ...session.nodes[0], id: "n2", selector: ".other" });
  assert.equal(
    exportChanges(session, [
      { id: "n1", x: 2, y: 0 },
      { id: "n2", x: 2, y: 0 },
    ]).files.length,
    1,
  );
  assert.throws(
    () =>
      exportChanges(session, [
        { id: "n1", x: 2, y: 0 },
        { id: "n2", x: 4, y: 0 },
      ]),
    /实例/,
  );
});
