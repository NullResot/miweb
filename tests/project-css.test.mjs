import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import postcss from 'postcss';
import { safeProjectCss } from '../server/project-css.mjs';

async function fixture(t) {
  const base=await mkdtemp(path.join(os.tmpdir(),'miweb-css-test-'));
  const root=path.join(base,'project'); await mkdir(path.join(root,'nested'),{recursive:true});
  t.after(async()=>{if(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(base).startsWith('miweb-css-test-'))await rm(base,{recursive:true,force:true});});
  return {base,root,entry:path.join(root,'main.css')};
}
test('nested supports, layers and media retain valid structure and imported asset paths',async t=>{
  const {root,entry}=await fixture(t);
  await writeFile(path.join(root,'nested','child.css'),'.card { width:123px; background:url("my logo.svg"); }');
  const css=await safeProjectCss('@import "nested/child.css" layer(ui) supports((display: grid) and (not (display: block))) screen;',entry,[root]);
  const ast=postcss.parse(css); assert.equal(ast.first.name,'layer');assert.equal(ast.first.params,'ui');
  const supports=ast.first.first; assert.equal(supports.name,'supports');assert.equal(supports.params,'((display: grid) and (not (display: block)))');
  assert.equal(supports.first.name,'media');assert.equal(supports.first.params,'screen');
  assert.ok(css.includes('my%20logo.svg')); assert.ok(css.includes('/nested/my%20logo.svg'));
  const selectorCondition=await safeProjectCss('@import "nested/child.css" supports(selector(:has(> span)));',entry,[root]);
  assert.equal(postcss.parse(selectorCondition).first.params,'(selector(:has(> span)))');
});
test('nested remote CSS is expanded before conditions are wrapped',async t=>{
  const {root,entry}=await fixture(t);
  const server=http.createServer((req,res)=>{res.setHeader('content-type','text/css');res.end(req.url==='/first.css'?'@import "leaf.css";':'.remote { background:url("asset.svg"); width:170px; }');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const origin=`http://127.0.0.1:${server.address().port}`;
  await writeFile(path.join(root,'nested','child.css'),`@import "${origin}/first.css";`);
  const css=await safeProjectCss('@import "nested/child.css" supports(display: grid);',entry,[root],[],undefined,{allowLocalResources:true});
  assert.ok(!css.includes('@import'));assert.ok(css.includes(`url("${origin}/asset.svg")`));
  assert.equal(postcss.parse(css).first.name,'supports');
});
test('CSS imports cannot read outside the project or activate preprocessors',async t=>{
  const {base,root,entry}=await fixture(t);await writeFile(path.join(base,'outside.css'),'.secret{color:red}');
  await assert.rejects(safeProjectCss('@import "../outside.css";',entry,[root]),/项目目录/);
  await assert.rejects(safeProjectCss('@import "nested/unsafe.scss";',entry,[root]),/不会执行/);
  await assert.rejects(safeProjectCss('@import "file:///etc/passwd";',entry,[root]),/不会执行/);
  await assert.rejects(safeProjectCss('@import "http://127.0.0.1:1234/private.css";',entry,[root]),/地址不能访问/);
});
test('circular imports terminate and raw/url resources stay separate from CSS processing',async t=>{
  const {root,entry}=await fixture(t);await writeFile(entry,'@import "nested/child.css"; .root{color:red}');
  await writeFile(path.join(root,'nested','child.css'),'@import "../main.css"; .child{color:blue}');
  const css=await safeProjectCss(await import('node:fs/promises').then(fs=>fs.readFile(entry,'utf8')),entry,[root]);
  assert.ok(css.includes('.root'));assert.ok(css.includes('.child'));assert.ok(css.length<200);
});
test('CSS Modules composition and value imports cannot escape through the built-in loader',async t=>{
  const {base,root,entry}=await fixture(t);
  await writeFile(path.join(base,'outside.css'),'.secret { content:"private" }');
  await writeFile(path.join(root,'base.css'),'.base { width:137px }');
  await assert.rejects(safeProjectCss('.button { composes: secret from "../outside.css" }',entry,[root]),/项目目录/);
  await assert.rejects(safeProjectCss('@value file: "../outside.css"; .button { composes: secret from file }',entry,[root]),/项目目录/);
  await assert.rejects(safeProjectCss('@value secret from "../outside.css";',entry,[root]),/项目目录/);
  assert.ok((await safeProjectCss('.button { composes: base from "./base.css" }',entry,[root])).includes('composes'));
});

test('canonical project aliases permit their own imports but reject symlink escapes',async t=>{
  const {base,root}=await fixture(t);
  const alias=path.join(base,'project-alias');
  await symlink(root,alias,'junction');
  await writeFile(path.join(root,'nested','child.css'),'.child { width:141px; }');
  const entry=path.join(alias,'main.css');
  const css=await safeProjectCss('@import "./nested/child.css";',entry,[alias]);
  assert.match(css,/width:141px/);
  assert.ok((await safeProjectCss('.button { composes: child from "./nested/child.css" }',entry,[alias])).includes('composes'));
  await writeFile(entry,'@import "./nested/child.css"; .root { color:blue; }');
  await writeFile(path.join(root,'nested','child.css'),'@import "../main.css"; .child { width:141px; }');
  const circular=await safeProjectCss('@import "./nested/child.css"; .root { color:blue; }',entry,[alias]);
  assert.equal((circular.match(/\.root\b/g)||[]).length,1);
  assert.equal((circular.match(/\.child\b/g)||[]).length,1);
  const external=path.join(base,'external');
  await mkdir(external);
  await writeFile(path.join(external,'outside.css'),'.outside { color:red; }');
  await symlink(external,path.join(root,'nested','escape'),'junction');
  await assert.rejects(safeProjectCss('@import "./nested/escape/outside.css";',entry,[alias]),/项目目录/);
  await assert.rejects(safeProjectCss('.button { composes: outside from "./nested/escape/outside.css" }',entry,[alias]),/项目目录/);
});

test('Windows path casing is canonicalized before the project boundary check',{skip:process.platform!=='win32'},async t=>{
  const {root}=await fixture(t);
  await writeFile(path.join(root,'nested','child.css'),'.child { height:61px; }');
  const inputRoot=root.toUpperCase();
  const css=await safeProjectCss('@import "./nested/child.css";',path.join(inputRoot,'main.css'),[inputRoot]);
  assert.match(css,/height:61px/);
});
