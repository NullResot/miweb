import postcss from 'postcss';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { safeRequest } from './network.mjs';
import { createRequire } from 'node:module';

const allowed = (file, roots) => roots.some(root=>file===root || file.startsWith(root+path.sep));
function qualifier(input, name, bare=false) {
  if(!new RegExp(`^${name}(?:\\s|\\(|$)`,'i').test(input)) return null;
  let cursor=name.length;
  while(/\s/.test(input[cursor]||'')) cursor++;
  if(input[cursor]!=='(') { if(bare) return {value:'',rest:input.slice(cursor).trim()}; throw new Error('样式导入条件格式错误'); }
  const start=++cursor; let depth=1, quote=null;
  for(;cursor<input.length;cursor++) {
    const char=input[cursor];
    if(char==='\\') { cursor++; continue; }
    if(quote) { if(char===quote) quote=null; continue; }
    if(char==='"'||char==="'") quote=char;
    else if(char==='(') depth++;
    else if(char===')' && --depth===0) return {value:input.slice(start,cursor),rest:input.slice(cursor+1).trim()};
  }
  throw new Error('样式导入条件括号没有闭合');
}
const remote = value => /^https?:\/\//i.test(value);
async function localCss(target, filename, roots) {
  if(!/\.css(?:[?#].*)?$/i.test(target) || /[\\:]/.test(target)) throw new Error('项目预览只支持 CSS 导入，不会执行样式预处理器或构建插件');
  const clean=target.split(/[?#]/)[0];
  const candidates=clean.startsWith('/') ? [path.join(roots[0],'public',clean.slice(1)),path.join(roots[0],clean.slice(1))] : [path.resolve(path.dirname(filename),clean)];
  if(!clean.startsWith('.')&&!clean.startsWith('/')) try { candidates.push(createRequire(filename).resolve(clean)); } catch {}
  let resolved;
  for(const candidate of candidates) { try { resolved=await realpath(candidate); break; } catch {} }
  if(!resolved || !allowed(resolved,roots) || !/\.css$/i.test(resolved)) throw new Error('样式导入必须位于项目目录内');
  return resolved;
}
export async function safeProjectCss(code, filename, roots, stack=[], budget={count:0,bytes:0,deadline:Date.now()+20000}, options={}) {
  // Compare real filesystem paths on both sides of the containment check.
  // Windows temporary directories can use 8.3 names or different casing, and
  // a selected project itself can be a directory junction. Child symlinks still
  // have to resolve inside these canonical roots before any file is read.
  if(!stack.length) {
    roots=await Promise.all(roots.map(root=>realpath(root)));
    if(!remote(filename)) filename=await realpath(filename).catch(()=>filename);
  }
  budget.bytes=(budget.bytes||0)+Buffer.byteLength(code);
  if(stack.length>8 || budget.count>40 || code.length>4*1024*1024 || budget.bytes>8*1024*1024 || Date.now()>budget.deadline) throw new Error('样式导入过多或文件过大，请使用已经启动的开发服务链接');
  const ast=postcss.parse(code,{from:filename}); const imports=[]; ast.walkAtRules(/^import$/i,rule=>imports.push(rule));
  // CSS Modules loads composes/@value dependencies itself, outside Vite's HTTP fs gate.
  // Validate that complete graph before letting its built-in compiler consume the source.
  const aliases=new Map(), moduleReferences=[];
  ast.walkAtRules(/^value$/i,rule=>{
    const alias=rule.params.match(/^([\w-]+)\s*:\s*["']([^"']+)["']\s*$/);
    if(alias) aliases.set(alias[1],alias[2]);
    moduleReferences.push(rule.params);
  });
  ast.walkDecls(/^(?:composes|compose-with)$/i,decl=>moduleReferences.push(decl.value));
  for(const reference of moduleReferences) {
    const match=reference.replace(/\/\*[\s\S]*?\*\//g,'').match(/\bfrom\s+(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*$/);
    if(!match || match[3]==='global') continue;
    const target=match[1]||match[2]||aliases.get(match[3]);
    if(!target || remote(filename)) throw new Error('CSS Modules 的组合样式必须来自项目内的 CSS 文件');
    const resolved=await localCss(target,filename,roots);
    if(stack.includes(resolved)||resolved===filename) continue;
    budget.count++;
    await safeProjectCss(await readFile(resolved,'utf8'),resolved,roots,[...stack,filename],budget,options);
  }
  for(const rule of imports) {
    const match=rule.params.match(/^(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)?\s*([\s\S]*)$/i);
    if(!match) throw new Error('无法识别样式导入，请使用已经启动的开发服务链接');
    const target=match[1]||match[2]||match[3];
    let resolved, raw;
    if(/^data:/i.test(target)) {
      const data=target.match(/^data:text\/css(?:;charset=[\w-]+)?(;base64)?,([\s\S]*)$/i);
      if(!data) throw new Error('样式数据必须是 text/css');
      raw=data[1] ? Buffer.from(data[2],'base64').toString('utf8') : decodeURIComponent(data[2]);
      resolved=filename;
    } else if(remote(target)||target.startsWith('//')||remote(filename)) {
      resolved=new URL(target,remote(filename)?filename:'https://miweb.invalid/').href;
      if(stack.includes(resolved)) { rule.remove(); continue; }
      const response=await safeRequest(resolved,{localAccess:!!options.allowLocalResources,maxBytes:4*1024*1024});
      if(response.status>=400 || !/text\/css/i.test(response.headers['content-type']||'')) throw new Error('远程样式无法加载或不是 CSS');
      resolved=response.url;
      const charset=response.headers['content-type']?.match(/charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
      raw=new TextDecoder(charset).decode(response.body);
    } else {
      resolved=await localCss(target,filename,roots);
      raw=await readFile(resolved,'utf8');
    }
    if(stack.includes(resolved)) { rule.remove(); continue; }
    budget.count++;
    const imported=postcss.parse(await safeProjectCss(raw,resolved,roots,[...stack,filename],budget,options),{from:remote(resolved)?undefined:resolved});
    imported.walkDecls(declaration=>{
      declaration.value=declaration.value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi,(whole,double,single,unquoted)=>{
        const resource=double ?? single ?? unquoted;
        if(/^(?:[a-z][\w+-]*:|#)/i.test(resource)) return whole;
        if(remote(resolved)) return `url("${new URL(resource,resolved).href.replaceAll('"','%22')}")`;
        if(resource.startsWith('/')) return whole;
        const [,file, suffix='']=resource.match(/^([^?#]*)([\s\S]*)$/);
        const absolute=path.resolve(path.dirname(resolved),decodeURIComponent(file)).replaceAll('\\','/');
        return `url("/@fs/${encodeURI(absolute)}${suffix}")`;
      });
    });
    let nodes=imported.nodes; let rest=match[4].trim(); let layer, supports;
    const layerMatch=qualifier(rest,'layer',true); if(layerMatch){layer=layerMatch.value;rest=layerMatch.rest;}
    const supportsMatch=qualifier(rest,'supports'); if(supportsMatch){supports=supportsMatch.value;rest=supportsMatch.rest;}
    const wrap=(name,params)=>{const outer=postcss.atRule({name,params});outer.append(nodes);nodes=[outer];};
    if(rest) wrap('media',rest); if(supports) wrap('supports',`(${supports})`); if(layer!==undefined) wrap('layer',layer);
    rule.replaceWith(...nodes);
  }
  const result=ast.toString();
  if(Buffer.byteLength(result)>8*1024*1024) throw new Error('展开后的样式文件过大');
  return result;
}
