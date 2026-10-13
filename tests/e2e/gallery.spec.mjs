import { test, expect } from "playwright/test";

const steps = ["选中元素", "微调布局", "带走代码"];

async function scrollShowcaseTo(page, region, progress) {
  // Position the real document along the showcase's travel, then allow the
  // browser's native scroll timeline and IntersectionObserver to paint.
  await region.locator(".mi-showcase-track").evaluate((element, value) => {
    const rect = element.getBoundingClientRect();
    window.scrollTo({ top: scrollY + rect.top + (rect.height - innerHeight) * value, behavior: "instant" });
  }, progress);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("gallery entry and return-to-top remain usable on desktop and mobile", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("刚刚好");
    const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth, height: innerHeight, contentHeight: document.documentElement.scrollHeight }));
    expect(dimensions.content).toBe(dimensions.width);
    expect(dimensions.contentHeight).toBeGreaterThan(dimensions.height);
    const closing = page.getByRole("link", { name: "打开页面", exact: true });
    await closing.scrollIntoViewIfNeeded();
    await closing.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "网站链接或本地项目地址" })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "网站链接或本地项目地址" })).toBeInViewport();
    await page.getByRole("button", { name: "选择项目文件夹", exact: true }).first().click();
    await expect(page.getByRole("dialog")).toContainText("连接本地项目");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("scrolling the showcase reveals selection, actual movement and resizing, then the code change", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const region = page.getByRole("region", { name: "滚动操作演示" });
  const shape = async () => region.locator(".mi-preview-cta").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, relativeY: rect.top - element.closest(".mi-preview").getBoundingClientRect().top };
  });
  await scrollShowcaseTo(page, region, 0.22);
  await expect(region.getByRole("button", { name: steps[0], exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(region.getByRole("heading", { name: "点选你想调整的元素。", exact: true })).toBeInViewport();
  const original = await shape();
  await scrollShowcaseTo(page, region, 0.68);
  await expect(region.getByRole("button", { name: steps[1], exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(region.getByRole("heading", { name: "向上 12 px，再宽 24 px。", exact: true })).toBeInViewport();
  await expect.poll(async () => Math.round((await shape()).width - original.width)).toBe(24);
  await expect.poll(async () => Math.round((await shape()).relativeY - original.relativeY)).toBe(-12);
  await scrollShowcaseTo(page, region, 0.97);
  await expect(region.getByRole("button", { name: steps[2], exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(region.getByRole("heading", { name: "只带走发生变化的代码。", exact: true })).toBeInViewport();
  await expect(region.getByText("其余代码保持原样", { exact: true })).toBeInViewport();
  await expect.poll(() => region.locator(".mi-showcase-code").evaluate((element) => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.95);
  await region.getByRole("button", { name: steps[0], exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(region.getByRole("button", { name: steps[1], exact: true })).toBeFocused();
  await expect(region.getByRole("button", { name: steps[1], exact: true })).toHaveAttribute("aria-pressed", "true");
  await region.getByRole("button", { name: "继续随滚动演示", exact: true }).click();
  await expect(region.getByRole("button", { name: steps[2], exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("mobile reduced motion offers all steps, keyboard controls, and a working editor entry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const region = page.getByRole("region", { name: "滚动操作演示" });
  await expect(region.getByRole("list", { name: "完整操作步骤" }).getByRole("listitem")).toHaveCount(3);
  await expect(region.getByRole("button", { name: steps[2], exact: true })).toHaveAttribute("aria-pressed", "true");
  const first = region.getByRole("button", { name: steps[0], exact: true });
  await first.scrollIntoViewIfNeeded();
  await first.focus();
  const before = await page.evaluate(() => scrollY);
  for (const [key, index] of [["ArrowRight", 1], ["End", 2], ["ArrowLeft", 1], ["Home", 0]]) {
    await page.keyboard.press(key);
    await expect(region.getByRole("button", { name: steps[index], exact: true })).toBeFocused();
    await expect(region.getByRole("button", { name: steps[index], exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  expect(await page.evaluate(() => scrollY)).toBe(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const tryButton = region.getByRole("button", { name: "亲手试一试", exact: true });
  await tryButton.scrollIntoViewIfNeeded();
  await tryButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".page-root strong")).toContainText("Atelier");
  const target = page.frameLocator("iframe").locator("#start-button");
  await target.click();
  await expect(page.getByRole("spinbutton", { name: "Y", exact: true })).toHaveValue("0");
  await target.press("ArrowUp");
  await expect(page.getByRole("spinbutton", { name: "Y", exact: true })).toHaveValue("-1");
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("源码已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("translate: 0px -1px;");
});

async function expectDarkSurfaces(locator) {
  const colors = await locator.evaluateAll((elements) => elements.map((element) => {
    // Composite translucent backgrounds over their actual ancestors. Imported
    // page contents live in an iframe and are deliberately outside this check.
    const chain = [];
    for (let current = element; current; current = current.parentElement) chain.unshift(current);
    let color = [255, 255, 255];
    for (const current of chain) {
      const values = getComputedStyle(current).backgroundColor.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
      const alpha = values[3] ?? 1;
      color = color.map((channel, index) => channel * (1 - alpha) + values[index] * alpha);
    }
    return { element: element.tagName + "." + element.className, color };
  }));
  expect(colors.length).toBeGreaterThan(0);
  for (const surface of colors) expect(Math.max(...surface.color), `${surface.element}: ${surface.color.join(",")}`).toBeLessThan(120);
}

test("dark presentation continues through the editor and import, help, and export dialogs", async ({ page }) => {
  await page.goto("/");
  await expectDarkSurfaces(page.locator("html, body, .home .app-header, .gallery-hero, .gallery-input, .gallery-statement, .mi-showcase, .mi-preview, .gallery-source, .gallery-diff, .gallery-closing"));
  await page.getByRole("button", { name: "选择项目文件夹", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectDarkSurfaces(page.locator(".modal, .modal .folder-drop, .modal input"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "使用帮助与快捷键" }).click();
  await expectDarkSurfaces(page.getByRole("dialog"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "先试用示例", exact: true }).click();
  await expect(page.locator(".page-root strong")).toContainText("Atelier");
  const target = page.frameLocator("iframe").locator("#start-button");
  await target.click();
  await expect(page.getByRole("spinbutton", { name: "Y", exact: true })).toHaveValue("0");
  await target.press("ArrowUp");
  await expectDarkSurfaces(page.locator(".app.editing, .editing .app-header, .editing .layers-panel, .editing .canvas-toolbar, .editing .inspector, .editing .floating-toolbar, .editing .ruler, .editing .number-field, .editing .source-info, .editing .status-bar"));
  await page.getByRole("button", { name: "查看代码与最小差异" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectDarkSurfaces(page.locator(".modal, .code-preview, .export-tabs, .export-file, .export-footer"));
});

test("hero and every narrative chapter visibly change with scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const chapters = page.locator(".gallery-statement > p > span, .mi-showcase-intro, #source-title, .gallery-diff, .gallery-delivery > div, #closing-title > span, .gallery-closing > .gallery-primary");
  const count = await chapters.count();
  expect(count).toBeGreaterThanOrEqual(10);
  await expect.poll(() => chapters.evaluateAll((elements) => elements.filter((element) => Number(getComputedStyle(element).opacity) < 0.2).length)).toBe(count);
  const initial = await chapters.evaluateAll((elements) => elements.map((element) => ({ transform: getComputedStyle(element).transform, opacity: Number(getComputedStyle(element).opacity) })));
  const product = page.locator(".gallery-hero-product > .mi-preview");
  const initialHero = await product.evaluate((element) => getComputedStyle(element).transform);
  await page.evaluate(() => window.scrollTo({ top: document.querySelector(".gallery-hero").getBoundingClientRect().height * 0.8, behavior: "instant" }));
  await expect.poll(() => product.evaluate((element) => getComputedStyle(element).transform)).not.toBe(initialHero);
  for (let index = 0; index < count; index++) {
    const chapter = chapters.nth(index);
    await chapter.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect.poll(() => chapter.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.95);
    await expect.poll(() => chapter.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
    expect(initial[index].opacity).toBeLessThan(0.2);
    expect(initial[index].transform).not.toBe("none");
  }
});

test("reduced motion makes every chapter readable immediately on desktop and mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const states = await page.locator("[data-reveal]").evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return { text: element.textContent.trim(), opacity: Number(style.opacity), transform: style.transform, width: box.width, height: box.height };
    }));
    expect(states.length).toBeGreaterThanOrEqual(10);
    for (const state of states) {
      expect(state.opacity, state.text).toBe(1);
      expect(state.transform, state.text).toBe("none");
      expect(state.width, state.text).toBeGreaterThan(0);
      expect(state.height, state.text).toBeGreaterThan(0);
    }
    expect(await page.locator(".gallery-hero-product > .mi-preview").evaluate((element) => getComputedStyle(element).transform)).toBe("none");
    const closing = page.getByRole("link", { name: "打开页面", exact: true });
    await closing.scrollIntoViewIfNeeded();
    await closing.click();
    await expect(page.getByRole("textbox", { name: "网站链接或本地项目地址" })).toBeFocused();
    await expectDarkSurfaces(page.locator(".home .app-header, .gallery-input, .gallery-statement, .gallery-diff, .gallery-closing"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  }
});
