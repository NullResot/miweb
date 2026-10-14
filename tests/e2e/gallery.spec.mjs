import { test, expect } from "playwright/test";

const website = "http://127.0.0.1:4288/miweb/";
const steps = ["选中元素", "微调布局", "带走代码"];
async function scrollToStep(page, region, progress) {
  await region.locator('.mi-showcase-track').evaluate((element, value) => {
    const rect = element.getBoundingClientRect();
    window.scrollTo({top: scrollY + rect.top + (rect.height - innerHeight) * value, behavior:'instant'});
  }, progress);
}

test("software start screen fits the window without outer scrollbars", async ({page}) => {
  for (const [width,height] of [[1440,900],[1040,666],[800,640],[390,844]]) {
    await page.setViewportSize({width,height}); await page.goto('/');
    await expect(page.getByRole('heading',{level:1})).toContainText('刚刚好');
    await expect(page.locator('.gallery-statement, .mi-showcase, .gallery-source, .gallery-footer')).toHaveCount(0);
    await expect(page.getByRole('textbox',{name:'网站链接或本地项目地址'})).toBeInViewport();
    await expect(page.getByRole('button',{name:'打开页面',exact:true})).toBeInViewport();
    await expect(page.getByRole('button',{name:'先试用示例',exact:true})).toBeInViewport();
    expect(await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}))).toEqual({w:width,h:height});
    await page.mouse.wheel(0,900); expect(await page.evaluate(()=>scrollY)).toBe(0);
  }
});

test("compact software entry keeps errors and project import accessible",async({page})=>{
  await page.setViewportSize({width:800,height:640}); await page.goto('/');
  await page.getByRole('textbox',{name:'网站链接或本地项目地址'}).fill('http://127.0.0.1:1');
  await page.getByRole('button',{name:'打开页面',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button',{name:'先试用示例',exact:true})).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBe(640);
  await page.getByRole('button',{name:'选择项目文件夹',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('连接本地项目');
  await page.keyboard.press('Escape');
});

test("website retains the full scrolling selection, movement, resize and code animation",async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto(website);
  const region=page.getByRole('region',{name:'滚动操作演示'});
  const shape=()=>region.locator('.mi-preview-cta').evaluate(element=>({width:element.getBoundingClientRect().width,y:element.getBoundingClientRect().top-element.closest('.mi-preview').getBoundingClientRect().top}));
  await scrollToStep(page,region,.22);
  await expect(region.getByRole('button',{name:steps[0],exact:true})).toHaveAttribute('aria-pressed','true');
  const before=await shape();
  await scrollToStep(page,region,.68);
  await expect(region.getByRole('button',{name:steps[1],exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>Math.round((await shape()).width-before.width)).toBe(24);
  await expect.poll(async()=>Math.round((await shape()).y-before.y)).toBe(-12);
  await scrollToStep(page,region,.97);
  await expect(region.getByRole('button',{name:steps[2],exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>region.locator('.mi-showcase-code').evaluate(el=>Number(getComputedStyle(el).opacity))).toBeGreaterThan(.95);
  await region.getByRole('button',{name:steps[0],exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(region.getByRole('button',{name:steps[1],exact:true})).toBeFocused();
});

test("website chapters reveal with scrolling and document navigation remains separate",async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(website);
  const chapters=page.locator('[data-reveal]');expect(await chapters.count()).toBeGreaterThanOrEqual(10);
  for(const chapter of await chapters.all()) {
    await chapter.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    await expect.poll(()=>chapter.evaluate(el=>Number(getComputedStyle(el).opacity))).toBeGreaterThan(.95);
  }
  await page.getByRole('link',{name:'文档',exact:true}).click();
  await expect(page).toHaveURL(/guide\/overview/);
  await expect(page.locator('.VPSidebar')).toBeVisible();
  await page.getByRole('link',{name:'首页',exact:true}).click();
  await expect(page.locator('.marketing-home')).toBeVisible();expect(errors).toEqual([]);
});

test("website mobile reduced motion retains the demo and working download links",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto(website);
  const region=page.getByRole('region',{name:'滚动操作演示'});
  await expect(region.getByRole('list',{name:'完整操作步骤'}).getByRole('listitem')).toHaveCount(3);
  await expect(region.getByRole('button',{name:steps[2],exact:true})).toHaveAttribute('aria-pressed','true');
  const download=page.locator('.gallery-input .gallery-primary');await download.click();
  await expect(page.getByRole('heading',{name:'安装后，直接开始。',exact:true})).toBeInViewport();
  const links=page.locator('.website-downloads .gallery-primary');await expect(links).toHaveCount(3);
  for(const link of await links.all())await expect(link).toHaveAttribute('href',/github.com\/NullResot\/miweb\/releases\/latest\/download\//);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});

test("software editor and dialogs keep the dark presentation",async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'先试用示例',exact:true}).click();
  await expect(page.locator('.page-root strong')).toContainText('Atelier');
  const target=page.frameLocator('iframe').locator('#start-button');await target.click();await target.press('ArrowUp');
  await page.getByRole('button',{name:'查看代码与最小差异'}).click();await expect(page.getByRole('dialog')).toBeVisible();
  const backgrounds=await page.locator('.app.editing, .inspector, .modal, .code-preview').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundColor));
  for(const color of backgrounds)expect(Math.max(...color.match(/\d+/g).slice(0,3).map(Number))).toBeLessThan(120);
});
