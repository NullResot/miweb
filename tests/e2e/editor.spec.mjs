import { test, expect } from "playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import http from "node:http";

async function demo(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "先试用示例" }).click();
  await expect(page.locator(".page-root strong")).toContainText("Atelier");
  const frame = page.frameLocator("iframe");
  await frame.locator("#start-button").click();
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("0");
  return frame;
}
async function number(page, name, value) {
  await page.getByRole("spinbutton", { name, exact: true }).fill(String(value));
  await page.getByRole("spinbutton", { name, exact: true }).press("Enter");
}
const errorFree = (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors).toEqual([]);
};
test("Escape cancels a numeric draft and numeric limits are enforced", async ({
  page,
}) => {
  await demo(page);
  const width = await page
    .getByRole("spinbutton", { name: "宽度" })
    .inputValue();
  await page.getByRole("spinbutton", { name: "宽度" }).fill("200");
  await page.getByRole("spinbutton", { name: "宽度" }).press("Escape");
  await expect(page.getByRole("spinbutton", { name: "宽度" })).toHaveValue(
    width,
  );
  await number(page, "字号", 999);
  await expect(page.getByRole("spinbutton", { name: "字号" })).toHaveValue(
    "500",
  );
  await number(page, "圆角", -5);
  await expect(page.getByRole("spinbutton", { name: "圆角" })).toHaveValue("0");
  await page.getByRole("spinbutton", { name: "X", exact: true }).fill("");
  await page.getByRole("spinbutton", { name: "X", exact: true }).press("Enter");
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("0");
  await page.getByRole("spinbutton", { name: "宽度" }).fill("180");
  await page.evaluate(() => {
    window.__qaGeometry = new Promise((resolve) => {
      const listener = (event) => {
        if (event.data?.type !== "geometry" || event.data.rect?.width !== 155) return;
        window.removeEventListener("message", listener);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      };
      window.addEventListener("message", listener);
    });
  });
  await page.frameLocator("iframe").locator("#start-button").evaluate((element) => {
    element.style.width = "155px";
    window.dispatchEvent(new Event("resize"));
  });
  await page.evaluate(() => window.__qaGeometry);
  await expect(page.getByRole("spinbutton", { name: "宽度" })).toHaveValue("180");
  await page.getByRole("spinbutton", { name: "宽度" }).press("Enter");
  await expect.poll(() => page.frameLocator("iframe").locator("#start-button").evaluate((element) => element.getBoundingClientRect().width)).toBe(180);
});
test("removing the final edit while comparing restores an editable canvas", async ({
  page,
}) => {
  const check = errorFree(page);
  const frame = await demo(page);
  const target = frame.locator("#start-button");
  for (const action of ["restore", "undo", "clear"]) {
    await target.press("ArrowRight");
    await page.getByRole("button", { name: "查看调整前", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "宽度" })).toBeDisabled();
    if (action === "restore") {
      await page.getByRole("button", { name: "恢复此元素", exact: true }).click();
    } else if (action === "undo") {
      await page.getByRole("button", { name: "撤销 Ctrl/⌘ Z" }).click();
    } else {
      await page.getByRole("button", { name: "清空调整", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "清空调整", exact: true }).click();
    }
    await expect(page.locator(".compare-note")).toHaveCount(0);
    await expect(page.getByRole("spinbutton", { name: "宽度" })).toBeEnabled();
    await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toHaveValue("0");
    await expect(frame.locator('[data-mi-ui="selection"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "查看调整前", exact: true })).toBeDisabled();
  }
  await target.press("ArrowRight");
  await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toHaveValue("1");
  check();
});
test("open sessions keep alive once per minute and stop after returning home", async ({ page }) => {
  await page.clock.install();
  await demo(page);
  const pings = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/ping")) pings.push(request.url());
  });
  const pendingPing = page.waitForResponse((response) => response.url().endsWith("/ping"));
  await page.clock.fastForward(60_001);
  expect((await pendingPing).status()).toBe(200);
  expect(pings).toHaveLength(1);
  await page.getByRole("button", { name: "微调 miweb" }).click();
  await expect(page.getByRole("button", { name: "先试用示例" })).toBeVisible();
  await page.clock.fastForward(120_001);
  expect(pings).toHaveLength(1);
});
test("home, help, focus trap, empty URL and failed import have usable states", async ({
  page,
}) => {
  const check = errorFree(page);
  await page.goto("/");
  await page.screenshot({ path: "test-results/landing-desktop.png" });
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("输入网站链接");
  await page.getByRole("button", { name: "使用帮助与快捷键" }).click();
  await expect(page.getByRole("dialog")).toContainText("Alt + 方向键");
  await page.keyboard.press("Tab");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "网站链接或本地项目地址" })
    .fill("http://127.0.0.1:1");
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法打开页面");
  await expect(page.locator(".loading-shade")).toHaveCount(0);
  check();
});
test("all numeric controls, keyboard modifiers, undo, redo, compare, source copy and diff download", async ({
  page,
}) => {
  const check = errorFree(page);
  const original = await readFile("examples/atelier/index.html", "utf8");
  const frame = await demo(page);
  const target = frame.locator("#start-button");
  await target.press("ArrowUp");
  await target.press("Shift+ArrowRight");
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("10");
  await expect(
    page.getByRole("spinbutton", { name: "Y", exact: true }),
  ).toHaveValue("-1");
  const width = Number(
    await page.getByRole("spinbutton", { name: "宽度" }).inputValue(),
  );
  await target.press("Alt+ArrowRight");
  await expect(page.getByRole("spinbutton", { name: "宽度" })).toHaveValue(
    String(width + 1),
  );
  await number(page, "宽度", 160);
  await number(page, "高度", 65);
  await number(page, "字号", 18);
  await number(page, "圆角", 8);
  await page.getByRole("button", { name: "撤销 Ctrl/⌘ Z" }).click();
  await expect(page.getByRole("spinbutton", { name: "圆角" })).toHaveValue(
    "26",
  );
  await page.getByRole("button", { name: "重做 Ctrl/⌘ Shift Z" }).click();
  await expect(page.getByRole("spinbutton", { name: "圆角" })).toHaveValue("8");
  await expect
    .poll(() => target.evaluate((e) => getComputedStyle(e).fontSize))
    .toBe("18px");
  await page.getByRole("button", { name: "查看调整前", exact: true }).click();
  await expect
    .poll(() => target.evaluate((e) => getComputedStyle(e).translate))
    .toBe("none");
  await expect(page.getByRole("spinbutton", { name: "宽度" })).toBeDisabled();
  await page.getByRole("button", { name: "回到调整后", exact: true }).click();
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("改后的源码已复制");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const insertion =
    ' style="translate: 10px -1px; width: 160px; height: 65px; box-sizing: border-box; font-size: 18px; border-radius: 8px;"';
  expect(copied.replace(insertion, "").replaceAll("\r\n", "\n")).toBe(
    original.replaceAll("\r\n", "\n"),
  );
  expect(copied).not.toContain("data-mi-");
  expect(await readFile("examples/atelier/index.html", "utf8")).toBe(original);
  await page.getByRole("button", { name: "查看代码与最小差异" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^最小差异/ })
    .click();
  await expect(page.locator(".code-preview")).toContainText("@@");
  await page.screenshot({ path: "test-results/export-desktop.png" });
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("miweb-changes.patch");
  expect(await readFile(await download.path(), "utf8")).toContain(insertion);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "CSS 补丁" })
    .click();
  await expect(page.locator(".code-preview")).toContainText("#start-button");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "恢复此元素", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("0");
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("10");
  check();
});
test("mouse move and every resize handle produce precise changes at non-100% zoom", async ({
  page,
}) => {
  const frame = await demo(page);
  const target = frame.locator("#start-button");
  const scale = await page
    .locator("iframe")
    .evaluate((e) => e.getBoundingClientRect().width / e.clientWidth);
  let box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 12 * scale,
    box.y + box.height / 2 - 6 * scale,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("12");
  await expect(
    page.getByRole("spinbutton", { name: "Y", exact: true }),
  ).toHaveValue("-6");
  for (const handle of ["e", "s", "se", "w", "n", "sw", "ne", "nw"]) {
    const before = await target.evaluate((e) => ({
      w: e.getBoundingClientRect().width,
      h: e.getBoundingClientRect().height,
    }));
    const dot = await frame
      .locator(`[data-mi-handle="${handle}"]`)
      .boundingBox();
    const dx = /[ew]/.test(handle) ? 6 : 0,
      dy = /[ns]/.test(handle) ? 4 : 0;
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      dot.x + dot.width / 2 + dx * scale,
      dot.y + dot.height / 2 + dy * scale,
      { steps: 5 },
    );
    await page.mouse.up();
    if (dx)
      await expect(page.getByRole("spinbutton", { name: "宽度" })).toHaveValue(
        String(Math.round(before.w + (handle.includes("w") ? -6 : 6))),
      );
    if (dy)
      await expect(page.getByRole("spinbutton", { name: "高度" })).toHaveValue(
        String(Math.round(before.h + (handle.includes("n") ? -4 : 4))),
      );
  }
});
test("rapid key presses, refresh recovery, clear, and branching undo history", async ({
  page,
}) => {
  const frame = await demo(page);
  const target = frame.locator("#start-button");
  for (let i = 0; i < 30; i++) await target.press("ArrowRight");
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("30");
  await page.reload();
  await page.frameLocator("iframe").locator("#start-button").click();
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("30");
  await page.getByRole("button", { name: "清空调整", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "清空调整", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("0");
  await page.getByRole("button", { name: "撤销 Ctrl/⌘ Z" }).click();
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue("30");
  await number(page, "X", 31);
  await expect(
    page.getByRole("button", { name: "重做 Ctrl/⌘ Shift Z" }),
  ).toBeDisabled();
});
test("leaving or failing to open a new page preserves current edits", async ({
  page,
}) => {
  const frame = await demo(page);
  await frame.locator("#start-button").press("ArrowUp");
  await page
    .getByRole("textbox", { name: "网站链接或本地项目地址" })
    .fill("http://127.0.0.1:1");
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("先带走本次改动");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "继续调整" })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Y", exact: true }),
  ).toHaveValue("-1");
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await page.getByRole("button", { name: "打开新页面", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法打开页面");
  await expect(page.locator(".page-root strong")).toContainText("Atelier");
  await expect(
    page.getByRole("spinbutton", { name: "Y", exact: true }),
  ).toHaveValue("-1");
});
test("React local path, repeated instances and multiple source files export correctly", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "网站链接或本地项目地址" })
    .fill(path.resolve("tests/fixtures/react"));
  await page.getByRole("button", { name: "打开页面", exact: true }).click();
  await expect(page.locator(".page-root strong")).toContainText(
    "React fixture",
  );
  await page.getByRole("textbox", { name: "搜索页面元素" }).fill("重复");
  await page.locator(".layer-row").filter({ hasText: "重复元素 1" }).click();
  await page.keyboard.press("ArrowRight");
  const frame = page.frameLocator("iframe");
  await expect
    .poll(() =>
      frame
        .locator(".repeated")
        .evaluateAll((els) => els.map((e) => getComputedStyle(e).translate)),
    )
    .toEqual(["1px", "1px"]);
  await frame.locator("#child-target").click();
  await frame.locator("#child-target").press("ArrowDown");
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("最小差异");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "改后源码" })
    .click();
  const options = await page
    .getByRole("combobox", { name: "导出文件" })
    .locator("option")
    .allTextContents();
  expect(options.sort()).toEqual(["src/Button.jsx", "src/main.jsx"]);
  await page
    .getByRole("combobox", { name: "导出文件" })
    .selectOption({ label: "src/Button.jsx" });
  await expect(page.locator(".code-preview")).toContainText(
    'translate: "0px 1px"',
  );
});
test("Vue folder import, parent selection, dimension changes and source delivery", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "本地项目", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("tests/fixtures/vue"));
  await expect(page.locator(".page-root strong")).toContainText("Vue fixture");
  const frame = page.frameLocator("iframe");
  await frame.locator("#vue-target").click();
  await expect(page.locator(".source-info")).toContainText("src/App.vue");
  await page.getByRole("button", { name: "选择父元素", exact: true }).click();
  await expect(page.locator(".element-tag")).toHaveText("main");
  await frame.locator("#vue-target").click();
  await number(page, "宽度", 180);
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("源码已复制");
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code).toContain("width: &quot;180px&quot;");
  expect(code).toContain("<style scoped>");
});
test("desktop, tablet, mobile and zoom retain all primary controls without document overflow", async ({
  page,
}) => {
  const frame = await demo(page);
  await page.screenshot({ path: "test-results/editor-desktop.png" });
  for (const [name, width] of [
    ["手机 390px", 390],
    ["平板 768px", 768],
    ["桌面 1280px", 1280],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect
      .poll(() => frame.locator("body").evaluate(() => innerWidth))
      .toBe(width);
  }
  await page.getByRole("combobox", { name: "画布缩放" }).selectOption("100");
  await expect
    .poll(() =>
      page.locator("iframe").evaluate((e) => e.getBoundingClientRect().width),
    )
    .toBe(1280);
  await page.getByRole("combobox", { name: "画布缩放" }).selectOption("fit");
  for (const [width, height] of [
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "手机 390px" }).click();
    const bounds = await page.evaluate(() => ({
      w: innerWidth,
      sw: document.documentElement.scrollWidth,
      h: innerHeight,
      sh: document.documentElement.scrollHeight,
    }));
    expect(bounds.sw).toBe(bounds.w);
    expect(bounds.sh).toBe(bounds.h);
    await expect(
      page.getByRole("button", { name: "复制代码", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "字号" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "圆角" })).toBeVisible();
    await page.screenshot({ path: `test-results/viewport-${width}.png` });
  }
});
