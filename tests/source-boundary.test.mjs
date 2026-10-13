import test from "node:test";
import assert from "node:assert/strict";
import { instrumentSource, exportChanges } from "../server/source.mjs";

function sessionFor(source, path = "index.html") {
  const { records } = instrumentSource(source, path);
  const record = [...records.values()][0];
  return {
    records,
    nodes: [
      {
        id: "n1",
        sourceId: record.id,
        selector: "#target",
        label: "target",
        baseTranslate: "none",
      },
    ],
  };
}
test("HTML entity-encoded declarations retain their decoded meaning after style edits", () => {
  const session = sessionFor(
    `<button style="font-family: &#39;A &amp; B&#39;; color:red;">go</button>`,
  );
  const updated = exportChanges(session, [{ id: "n1", x: 0, y: 1 }]).files[0]
    .updated;
  assert.match(updated, /font-family: 'A &amp; B'; color:red;/);
  assert.ok(!updated.includes("&amp;#39;"));
});
test("prototype-looking object keys are left untouched", () => {
  const session = sessionFor(
    `const App=()=> <button style={{constructor: null, width:20}}>go</button>`,
    "App.jsx",
  );
  assert.match(
    exportChanges(session, [{ id: "n1", x: 0, y: 0, width: 80 }]).files[0]
      .updated,
    /constructor: null/,
  );
});
test("HTML preserves exactly one important declaration when changing a locked property", () => {
  const session = sessionFor(
    '<button style="width:140px!important">go</button>',
  );
  session.nodes[0].importantStyles = ["width"];
  session.nodes[0].inlineImportant = ["width"];
  const exported = exportChanges(session, [
    { id: "n1", x: 0, y: 0, width: 180 },
  ]);
  assert.match(exported.files[0].updated, /width:180px !important/);
  assert.ok(!exported.files[0].updated.includes("!important !important"));
  assert.ok(exported.javascript);
});
test("different original translations in repeated source instances use per-instance patches", () => {
  const session = sessionFor("const App=()=> <div>go</div>", "App.jsx");
  session.nodes.push({
    ...session.nodes[0],
    id: "n2",
    selector: "#other",
    baseTranslate: "10px",
  });
  const exported = exportChanges(session, [
    { id: "n1", x: 2, y: 0 },
    { id: "n2", x: 2, y: 0 },
  ]);
  assert.equal(exported.files.length, 0);
  assert.match(exported.css, /calc\(10px \+ 2px\)/);
});
