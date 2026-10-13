import { test, expect } from "playwright/test";
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";

let server, address;
test("important hover rules are detected before hover and do not cause incorrect JSX export", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "网站链接或本地项目地址" })
    .fill(path.resolve("tests/fixtures/important"));
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.locator(".page-root strong")).toHaveText(
    "Important fixture",
  );
  const frame = page.frameLocator("iframe");
  await frame.locator("#react-important").click();
  await page.getByRole("spinbutton", { name: "字号" }).fill("18");
  await page.getByRole("spinbutton", { name: "字号" }).press("Enter");
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("CSS 补丁已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "font-size: 18px !important",
  );
});
test("one adjustment to 1000 component instances remains exportable and preserves the original source", async ({
  page,
}) => {
  const original = await readFile("tests/fixtures/many/main.jsx", "utf8");
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "网站链接或本地项目地址" })
    .fill(path.resolve("tests/fixtures/many"));
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.locator(".page-root strong")).toHaveText("Many fixture");
  const frame = page.frameLocator("iframe");
  await frame.locator("#item-0").click();
  await frame.locator("#item-0").press("ArrowDown");
  await expect
    .poll(() =>
      frame
        .locator("button[data-mi-id]")
        .evaluateAll(
          (elements) =>
            elements.filter((e) => getComputedStyle(e).translate === "0px 1px")
              .length,
        ),
    )
    .toBe(1000);
  await expect(page.locator(".source-info")).toContainText(/1000\s*个实例/);
  const pendingExport = page.waitForResponse((response) => response.url().endsWith("/export") && response.request().method() === "POST");
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  const exported = await (await pendingExport).json();
  await expect(page.getByRole("status")).toContainText("源码已复制");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const insertion = ' style={{ translate: "0px 1px" }}';
  expect(exported.files).toHaveLength(1);
  expect(exported.files[0].updated.replace(insertion, "")).toBe(original);
  // Windows clipboard normalizes LF to CRLF; exported files retain original bytes.
  expect(copied.replace(insertion, "").replaceAll("\r\n", "\n")).toBe(original.replaceAll("\r\n", "\n"));
  expect(await readFile("tests/fixtures/many/main.jsx", "utf8")).toBe(original);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
const requests = [];
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/layout.css") {
      res.setHeader("content-type", "text/css");
      res.end("#remote-target { background:rgb(221,238,255); padding:8px }");
    } else if (req.url === "/badge.svg") {
      res.setHeader("content-type", "image/svg+xml");
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="blue"/></svg>',
      );
    } else if (req.url === "/host-styles") {
      res.setHeader("content-type", "text/html;charset=utf-8");
      res.end('<html><head><title>Host styles fixture</title><style>div{width:17px!important;height:19px!important;padding:30px!important;border:11px solid red!important;background:hotpink!important;position:absolute!important;left:3px!important;top:4px!important;display:none!important}button{margin:70px;width:160px;height:48px}</style></head><body><button id="isolated-target">Resize me</button></body></html>');
    } else if (req.url === "/form-state") {
      res.setHeader("content-type", "text/html;charset=utf-8");
      res.end('<html><head><title>Form state fixture</title></head><body><input id="enabled" type="checkbox"><input id="disabled" type="checkbox" checked><select id="choice"><option value="a" selected>A</option><option value="b">B</option></select><select id="multiple" multiple><option value="a" selected>A</option><option value="b">B</option><option value="c">C</option></select><textarea id="message">Initial text</textarea><input id="text" value="Initial value"><script>document.querySelector("#enabled").checked=true;document.querySelector("#disabled").checked=false;document.querySelector("#choice").value="b";for(const option of document.querySelector("#multiple").options)option.selected=option.value!=="a";document.querySelector("#message").value="Changed <text> & message";document.querySelector("#text").value="Updated value";</script></body></html>');
    } else {
      res.setHeader("content-type", "text/html;charset=utf-8");
      res.end(
        '<html><head><meta charset="utf-8"><title>Remote fixture</title><style>@import url(/layout.css);</style></head><body><div id="root"></div><a href="/subpage">Subpage</a><script>window.importedRuns=1;document.querySelector("#root").innerHTML=`<button id="remote-target" style="width:140px!important;height:44px!important">Remote button</button><img src="/badge.svg">`;</script></body></html>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise((resolve) => server.close(resolve)));
test("page-wide important div rules do not hide or distort selection and resize handles", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("textbox", { name: "网站链接或本地项目地址" }).fill(`${address}/host-styles`);
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.locator(".page-root strong")).toHaveText("Host styles fixture");
  const frame = page.frameLocator("iframe");
  const target = frame.locator("#isolated-target");
  await target.click();
  const selection = frame.locator('[data-mi-ui="selection"]');
  await expect(selection).toBeVisible();
  const targetBox = await target.boundingBox();
  const selectionBox = await selection.boundingBox();
  expect(selectionBox.x).toBeCloseTo(targetBox.x, 1);
  expect(selectionBox.y).toBeCloseTo(targetBox.y, 1);
  expect(selectionBox.width).toBeCloseTo(targetBox.width, 1);
  expect(selectionBox.height).toBeCloseTo(targetBox.height, 1);
  expect(await selection.evaluate((element) => getComputedStyle(element).borderColor)).toBe("rgb(53, 105, 239)");
  const handle = frame.locator('[data-mi-handle="e"]');
  await expect(handle).toBeVisible();
  expect(await handle.evaluate((element) => element.getBoundingClientRect().width)).toBe(7);
  const scale = await page.locator("iframe").evaluate((element) => element.getBoundingClientRect().width / element.clientWidth);
  const dot = await handle.boundingBox();
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(dot.x + dot.width / 2 + 12 * scale, dot.y + dot.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("spinbutton", { name: "宽度" })).toHaveValue("172");
  expect(errors).toEqual([]);
});
test("URL snapshots retain programmatically changed checkbox, select and textarea values", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "网站链接或本地项目地址" }).fill(`${address}/form-state`);
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.locator(".page-root strong")).toHaveText("Form state fixture");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#enabled")).toBeChecked();
  await expect(frame.locator("#disabled")).not.toBeChecked();
  await expect(frame.locator("#choice")).toHaveValue("b");
  await expect(frame.locator("#multiple")).toHaveValues(["b", "c"]);
  await expect(frame.locator("#message")).toHaveValue("Changed <text> & message");
  await expect(frame.locator("#text")).toHaveValue("Updated value");
});
test("URL snapshot preserves dynamic content and assets while isolating scripts and blocking navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "网站链接或本地项目地址" })
    .fill(address.replace("http://", "HTTP://"));
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.locator(".page-root strong")).toHaveText("Remote fixture");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#remote-target")).toBeVisible();
  expect(
    await frame.locator("body").evaluate(() => window.importedRuns),
  ).toBeUndefined();
  expect(
    await frame.locator("body").evaluate(() => {
      try {
        return parent.document.body.tagName;
      } catch {
        return "isolated";
      }
    }),
  ).toBe("isolated");
  await expect
    .poll(() => frame.locator("img").evaluate((e) => e.naturalWidth))
    .toBe(80);
  expect(
    await frame
      .locator("#remote-target")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toBe("rgb(221, 238, 255)");
  const before = requests.filter((url) => url === "/subpage").length;
  await frame.getByRole("link", { name: "Subpage" }).click();
  expect(requests.filter((url) => url === "/subpage").length).toBe(before);
  await expect(frame.locator("#remote-target")).toBeVisible();
  await frame.locator("#remote-target").click();
  await frame.locator("#remote-target").press("ArrowRight");
  await page.getByRole("button", { name: "复制补丁", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("CSS 补丁已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "translate: 1px 0px !important",
  );
});
test("inline important styles get a functioning JavaScript patch instead of a non-working CSS export", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "网站链接或本地项目地址" })
    .fill(address);
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.locator(".page-root strong")).toHaveText("Remote fixture");
  const frame = page.frameLocator("iframe");
  await frame.locator("#remote-target").click();
  await page.getByRole("spinbutton", { name: "宽度" }).fill("190");
  await page.getByRole("spinbutton", { name: "宽度" }).press("Enter");
  await expect
    .poll(() =>
      frame
        .locator("#remote-target")
        .evaluate((e) => e.getBoundingClientRect().width),
    )
    .toBe(190);
  await page.getByRole("button", { name: "复制补丁", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("布局补丁已复制");
  const javascript = await page.evaluate(() => navigator.clipboard.readText());
  expect(javascript).toContain("MutationObserver");
  const original = await context.newPage();
  await original.goto(address);
  await original.addScriptTag({ content: javascript });
  await expect
    .poll(() =>
      original
        .locator("#remote-target")
        .evaluate((e) => e.getBoundingClientRect().width),
    )
    .toBe(190);
  await original
    .locator("#remote-target")
    .evaluate((e) => e.style.setProperty("width", "120px"));
  await expect
    .poll(() =>
      original
        .locator("#remote-target")
        .evaluate((e) => e.getBoundingClientRect().width),
    )
    .toBe(190);
  await original.close();
  await page.getByRole("button", { name: "查看代码与最小差异" }).click();
  await expect(page.locator(".modal-heading p")).toContainText("将 JavaScript 补丁放到原页面脚本中");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "JavaScript 补丁" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "CSS 补丁" })
    .click();
  await expect(page.locator(".export-warning")).toContainText(
    "CSS 无法单独覆盖",
  );
});
test("React important stylesheet rules fall back to a CSS patch with enough specificity", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "网站链接或本地项目地址" })
    .fill(path.resolve("tests/fixtures/important"));
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.locator(".page-root strong")).toHaveText(
    "Important fixture",
  );
  const frame = page.frameLocator("iframe");
  await frame.locator("#react-important").click();
  await page.getByRole("spinbutton", { name: "宽度" }).fill("180");
  await page.getByRole("spinbutton", { name: "宽度" }).press("Enter");
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("CSS 补丁已复制");
  const css = await page.evaluate(() => navigator.clipboard.readText());
  expect(css).toContain(":is(");
  const original = await context.newPage();
  await original.setContent(
    '<style>#root #react-important{width:140px!important}</style><div id="root"><button id="react-important">button</button></div>',
  );
  await original.addStyleTag({ content: css });
  await expect
    .poll(() =>
      original
        .locator("#react-important")
        .evaluate((e) => e.getBoundingClientRect().width),
    )
    .toBe(180);
  await original.close();
});
