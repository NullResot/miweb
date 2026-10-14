import test from "node:test";
import assert from "node:assert/strict";
import policy from "../desktop/policy.cjs";

const origin = "http://127.0.0.1:53117";
const trust = { origin, webContentsId: 9 };
const trusted = { url: `${origin}/api/open`, frameUrl: `${origin}/`, isMainFrame: true, webContentsId: 9 };

test("desktop credentials are limited to the application main frame and its API", () => {
  assert.equal(policy.canAuthenticateRequest(trusted, trust), true);
  for (const change of [
    { url: "https://example.com/api/open" },
    { url: "http://127.0.0.1:53118/api/open" },
    { url: `${origin}/assets/index.js` },
    { url: `http://user:password@127.0.0.1:53117/api/open` },
    { frameUrl: `${origin}/api/health` },
    { frameUrl: "about:srcdoc", isMainFrame: false },
    { frameUrl: `${origin}/`, isMainFrame: false },
    { webContentsId: 8 },
    { frameUrl: "" },
  ]) assert.equal(policy.canAuthenticateRequest({ ...trusted, ...change }, trust), false, JSON.stringify(change));
});

test("desktop native picker rejects imported or unrelated frames", () => {
  assert.equal(policy.canUsePicker(trusted, trust), true);
  assert.equal(policy.canUsePicker({ ...trusted, isMainFrame: false }, trust), false);
  assert.equal(policy.canUsePicker({ ...trusted, frameUrl: "about:srcdoc" }, trust), false);
  assert.equal(policy.canUsePicker({ ...trusted, webContentsId: 10 }, trust), false);
});

test("desktop only allows application navigation and generated export downloads", () => {
  assert.equal(policy.isAppPage(`${origin}/#editor`, origin), true);
  assert.equal(policy.isAppPage("https://example.com/", origin), false);
  assert.equal(policy.isAppPage(`${origin}/api/open`, origin), false);
  assert.equal(policy.isAppPage("file:///C:/Windows/win.ini", origin), false);
  assert.equal(policy.isExportDownload(`blob:${origin}/a123`, origin), true);
  assert.equal(policy.isExportDownload(`blob:${origin}.example.com/a123`, origin), false);
  assert.equal(policy.isExportDownload(`${origin}/api/health`, origin), false);
});
