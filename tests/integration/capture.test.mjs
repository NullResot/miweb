import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { captureProject } from "../../server/project.mjs";
import { capturePage, closeBrowser } from "../../server/capture.mjs";
import { exportChanges } from "../../server/source.mjs";

test.after(() => closeBrowser());
test("busy page scripts time out and do not leave the renderer unusable", async (t) => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      req.url === "/busy"
        ? "<html><body><p>busy</p><script>addEventListener('DOMContentLoaded',()=>setTimeout(()=>{while(true){}},50))</script></body></html>"
        : "<html><body><button>healthy</button></body></html>",
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(
    capturePage(base + "/busy", { localAccess: true }),
    /超时/,
  );
  const recovered = await capturePage(base + "/safe", { localAccess: true });
  assert.ok(recovered.nodes.some((node) => node.tag === "button"));
});
test("static HTML project renders and exports original source", async () => {
  const session = await captureProject(path.resolve("examples/atelier"));
  const node = session.nodes.find((node) => node.selector === "#start-button");
  assert.ok(node?.file === "index.html");
  assert.ok(session.html.includes("开始我的创作"));
  assert.ok(!session.html.includes("<script"));
  const result = exportChanges(session, [{ id: node.id, x: 0, y: -8 }]);
  assert.equal(result.files.length, 1);
  assert.ok(result.files[0].updated.includes('style="translate: 0px -8px;"'));
});
test("React project renders JSX, maps component elements and repeated instances", async () => {
  const session = await captureProject(path.resolve("tests/fixtures/react"));
  const node = session.nodes.find((node) => node.selector === "#react-target");
  assert.ok(
    node?.file === "src/main.jsx",
    JSON.stringify({ nodes: session.nodes, warnings: session.warnings }),
  );
  const repeated = session.nodes.filter((node) =>
    node.text.startsWith("重复元素"),
  );
  assert.equal(repeated.length, 2);
  assert.equal(repeated[0].sourceId, repeated[1].sourceId);
  assert.ok(
    exportChanges(session, [
      { id: node.id, x: 2, y: 0 },
    ]).files[0].updated.includes('translate: "2px 0px"'),
  );
});
test("Vue SFC renders with scoped CSS and maps native elements", async () => {
  const session = await captureProject(path.resolve("tests/fixtures/vue"));
  const node = session.nodes.find((node) => node.selector === "#vue-target");
  assert.ok(
    node?.file === "src/App.vue",
    JSON.stringify({ nodes: session.nodes, warnings: session.warnings }),
  );
  assert.equal(node.borderRadius, 8);
  assert.equal(
    exportChanges(session, [{ id: node.id, x: 0, y: -3 }]).files[0].path,
    "src/App.vue",
  );
});
test("exported React and Vue source reproduces the edited dimensions and translation", async () => {
  for (const [name, selector] of [
    ["react", "#react-target"],
    ["vue", "#vue-target"],
  ]) {
    const directory = path.resolve(`tests/fixtures/${name}`);
    const original = await captureProject(directory);
    const node = original.nodes.find((node) => node.selector === selector);
    const result = exportChanges(original, [
      { id: node.id, x: 4, y: -8, width: 180, height: 60 },
    ]);
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "miweb-export-test-"),
    );
    try {
      await cp(directory, temporary, {
        recursive: true,
        filter: (filename) => !filename.includes("node_modules"),
      });
      for (const file of result.files)
        await writeFile(path.join(temporary, file.path), file.updated);
      const rendered = await captureProject(temporary);
      const changed = rendered.nodes.find((node) => node.selector === selector);
      assert.equal(changed.width, 180, name);
      assert.equal(changed.height, 60, name);
      assert.equal(changed.baseTranslate, "4px -8px", name);
    } finally {
      if (
        path
          .resolve(temporary)
          .startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(temporary).startsWith("miweb-export-test-")
      )
        await rm(temporary, { recursive: true, force: true });
    }
  }
});
test("link mode captures JavaScript content, follows redirects and removes active scripts", async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(302, { location: "/view/" });
      response.end();
    } else if (request.url === "/view/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<html><head><title>Remote</title><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script>document.querySelector("#root").innerHTML = `<button id="remote-button" onclick="alert(1)">JS rendered</button>`;</script></body></html>',
      );
    } else if (request.url === "/view/style.css") {
      response.setHeader("Content-Type", "text/css");
      response.end("button { width: 140px; }");
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const session = await capturePage(
    `http://127.0.0.1:${server.address().port}/`,
    { localAccess: true },
  );
  assert.ok(session.finalUrl.endsWith("/view/"));
  const node = session.nodes.find((node) => node.selector === "#remote-button");
  assert.equal(node.width, 140);
  assert.ok(
    !session.html.includes("onclick=") && !session.html.includes("<script"),
  );
  assert.equal(
    exportChanges(session, [{ id: node.id, x: 1, y: 0 }]).files.length,
    0,
  );
});
test("snapshot includes CSSOM-generated styles and elements hidden at the capture width", async (t) => {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<html><head><style></style></head><body><p>visible</p><button id="mobile">mobile</button><script>document.styleSheets[0].insertRule("#mobile { display:none; color:red; }"); document.styleSheets[0].insertRule("@media(max-width:600px) { #mobile { display:block; } }");</script></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const session = await capturePage(
    `http://127.0.0.1:${server.address().port}/`,
    { localAccess: true },
  );
  assert.ok(session.nodes.some((node) => node.selector === "#mobile"));
  assert.match(session.html, /#mobile/);
  assert.match(session.html, /display: none/);
});
