import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";
import { capturePage, closeBrowser } from "../../server/capture.mjs";
import { exportChanges } from "../../server/source.mjs";

test.after(() => closeBrowser());

test("page-owned or tag-mismatched source markers do not create false shared source instances", async (t) => {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<button id="one" data-mi-source="page-owned">one</button><button id="two" data-mi-source="page-owned">two</button><button id="mismatch" data-mi-source="known">three</button>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const session = await capturePage(`http://127.0.0.1:${server.address().port}/`, {
    localAccess: true,
    records: new Map([["known", { id: "known", tag: "div", path: "App.jsx", line: 1 }]]),
  });
  for (const selector of ["#one", "#two", "#mismatch"]) {
    const node = session.nodes.find((item) => item.selector === selector);
    assert.ok(node);
    assert.equal(node.sourceId, undefined);
    assert.equal(node.file, undefined);
  }
});

test("exported patches override layered important declarations, including imported layers", async (t) => {
  let opaqueOrigin;
  const server = http.createServer((request, response) => {
    if (request.url === "/layer.css") {
      response.setHeader("Content-Type", "text/css");
      return response.end("#target { width: 100px !important; }");
    }
    if (request.url === "/outer.css") {
      response.setHeader("Content-Type", "text/css");
      return response.end('@import "/layer.css" layer(base);');
    }
    const styles = {
      "/block": "@layer base { #target { width: 100px !important; } }",
      "/nested": "@layer base { @media (min-width: 1px) { #target { width: 100px !important; } } }",
      "/named-import": '@import "/layer.css" layer(base);',
      "/anonymous-import": '@import "/layer.css" layer;',
      "/unlayered": "#target { width: 100px !important; }",
    };
    response.setHeader("Content-Type", "text/html");
    const stylesheet = request.url === "/opaque-import"
      ? `<link rel="stylesheet" href="${opaqueOrigin}/outer.css">`
      : `<style>${styles[request.url] || ""}</style>`;
    response.end(`<!doctype html><html><head>${stylesheet}</head><body><button id="target">target</button></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const opaqueServer = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/css");
    response.end(request.url === "/outer.css"
      ? '@import "/layer.css" layer(base);'
      : '#target { width: 100px !important; }');
  });
  await new Promise((resolve) => opaqueServer.listen(0, "127.0.0.1", resolve));
  t.after(() => opaqueServer.close());
  opaqueOrigin = `http://127.0.0.1:${opaqueServer.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const route of ["/block", "/nested", "/named-import", "/anonymous-import", "/opaque-import", "/unlayered"]) {
    await t.test(route, async () => {
      const session = await capturePage(origin + route, { localAccess: true });
      const target = session.nodes.find((node) => node.selector === "#target");
      assert.equal(target.width, 100);
      const exported = exportChanges(session, [{ id: target.id, x: 0, y: 0, width: 180 }]);
      const page = await browser.newPage();
      try {
        await page.goto(origin + route);
        await page.addStyleTag({ content: exported.css });
        if (route !== "/unlayered") {
          assert.ok(target.layeredImportant.includes("width"));
          assert.ok(exported.javascript);
          assert.equal(await page.locator("#target").evaluate((element) => element.getBoundingClientRect().width), 100,
            "An unlayered CSS patch cannot beat layered !important, regardless of specificity");
          await page.addScriptTag({ content: exported.javascript });
          assert.equal(await page.locator("#target").evaluate((element) => element.getBoundingClientRect().width), 180);
          await page.locator("#target").evaluate((element) => element.style.setProperty("width", "90px", "important"));
          await page.waitForFunction(() => document.querySelector("#target").getBoundingClientRect().width === 180);
        } else {
          assert.equal(exported.javascript, "");
          assert.equal(await page.locator("#target").evaluate((element) => element.getBoundingClientRect().width), 180);
        }
      } finally {
        await page.close();
      }
    });
  }
});
