import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { captureProject } from '../../server/project.mjs';
import { closeBrowser } from '../../server/capture.mjs';

test.after(()=>closeBrowser());
async function fixture(t,files) {
  const root=await mkdtemp(path.join(os.tmpdir(),'miweb-isolation-'));
  for(const [file,source] of Object.entries(files)){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),source);}
  t.after(async()=>{if(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('miweb-isolation-'))await rm(root,{recursive:true,force:true});});return root;
}
test('project preview does not execute PostCSS config or expose server VITE environment',async t=>{
  const root=await fixture(t,{
    'index.html':'<html><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>',
    'main.js':'import "./style.css"; document.querySelector("#root").innerHTML=`<button id="target">${import.meta.env.VITE_MIWEB_ISOLATION_PROBE || "not exposed"}</button>`;',
    'style.css':'#target { width: 170px; }',
  });
  const marker=path.join(root,'CONFIG_EXECUTED');
  await writeFile(path.join(root,'postcss.config.cjs'),`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');module.exports={plugins:[]};`);
  const previous=process.env.VITE_MIWEB_ISOLATION_PROBE;process.env.VITE_MIWEB_ISOLATION_PROBE='server-only-probe';
  try {
    const session=await captureProject(root);assert.equal(session.nodes.find(node=>node.selector==='#target')?.text,'not exposed');
    await assert.rejects(access(marker));
  } finally {if(previous===undefined)delete process.env.VITE_MIWEB_ISOLATION_PROBE;else process.env.VITE_MIWEB_ISOLATION_PROBE=previous;}
});
test('an uploaded project can access its own preview but cannot read another loopback service',async t=>{
  let privateHits=0;
  const service=http.createServer((_req,res)=>{privateHits++;res.setHeader('content-type','text/plain');res.end('private-service-probe');});
  await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));t.after(()=>service.close());
  const root=await fixture(t,{'index.html':`<html><body><p id="target">loading</p><script>fetch('http://127.0.0.1:${service.address().port}/secret').then(r=>r.text()).then(t=>document.querySelector('#target').textContent=t).catch(()=>document.querySelector('#target').textContent='blocked');</script></body></html>`});
  const session=await captureProject(root);assert.equal(privateHits,0);assert.equal(session.nodes.find(node=>node.selector==='#target')?.text,'blocked');
});
test('nested plain CSS imports render correctly and retain relative images',async t=>{
  const root=await fixture(t,{
    'index.html':'<html><head><meta charset="utf-8"></head><body><button id="target">CSS import</button><script type="module" src="/main.js"></script></body></html>',
    'main.js':'import "./main.css";',
    'main.css':'@import "nested/child.css" layer(ui) supports((display:grid) or (display:flex)) screen;',
    'nested/child.css':'#target { width:123px; height:60px; background-image:url("my logo.svg"); }',
    'nested/my logo.svg':'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>',
  });
  const session=await captureProject(root);assert.equal(session.nodes.find(node=>node.selector==='#target')?.width,123);
  const external=[...session.assets.keys()].some(url=>decodeURI(url).includes('my logo.svg'));
  const inlined=session.html.includes('data:image/svg+xml,') && decodeURIComponent(session.html).includes("fill='blue'");
  assert.ok(external||inlined,'the relative SVG must be captured or correctly inlined by Vite');
});
test('CSS Modules composition remains functional after dependency validation',async t=>{
  const root=await fixture(t,{
    'index.html':'<html><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>',
    'main.js':'import styles from "./main.module.css";document.querySelector("#root").innerHTML=`<button id="target" class="${styles.button}">Module</button>`;',
    'main.module.css':'.button { composes: base from "./base.css"; height:40px; }',
    'base.css':'.base { width:137px; }',
  });
  const session=await captureProject(root);assert.equal(session.nodes.find(node=>node.selector==='#target')?.width,137);
});
