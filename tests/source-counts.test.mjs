import test from "node:test";
import assert from "node:assert/strict";
import { instrumentSource, exportChanges } from "../server/source.mjs";

test("repeated source instances count as mapped instances but produce one source edit", () => {
  const { records } = instrumentSource('<button>shared</button>', "index.html");
  const sourceId = [...records.keys()][0];
  const nodes = Array.from({ length: 1000 }, (_, index) => ({
    id: `n${index}`, sourceId, selector: `#button-${index}`, label: "shared", baseTranslate: "none",
  }));
  const changes = nodes.map(({ id }) => ({ id, x: 2, y: 0 }));
  const result = exportChanges({ records, nodes }, changes);
  assert.equal(result.mapped, 1000);
  assert.equal(result.total, 1000);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].updated, '<button style="translate: 2px 0px;">shared</button>');
});

test("mixed source and fallback instances report only the instances represented by source edits", () => {
  const { records } = instrumentSource('const App = () => <button>shared</button>', "App.jsx");
  const sourceId = [...records.keys()][0];
  const nodes = [
    { id: "n1", sourceId, selector: "#one", label: "one", baseTranslate: "none" },
    { id: "n2", sourceId, selector: "#two", label: "two", baseTranslate: "none" },
    { id: "n3", selector: "#unmapped", label: "unmapped", baseTranslate: "none" },
  ];
  const result = exportChanges({ records, nodes }, nodes.map(({ id }) => ({ id, x: 2, y: 0 })));
  assert.equal(result.mapped, 2);
  assert.equal(result.total, 3);
  assert.equal(result.files.length, 1);
  assert.match(result.css, /#unmapped/);
});
