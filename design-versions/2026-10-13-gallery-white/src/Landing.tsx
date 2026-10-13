import { useRef } from "react";
import { ArrowDown, ArrowUpRight, Check, ChevronRight, FolderOpen, History, Link2 } from "lucide-react";
import ScrollShowcase, { ProductPreview } from "./ScrollShowcase";

type LandingProps = {
  location: string;
  onLocationChange: (value: string) => void;
  onOpen: (location?: string) => void;
  onImport: () => void;
  onDemo: () => void;
  loading: boolean;
  error: string;
  recent: string[];
};

export default function Landing({ location, onLocationChange, onOpen, onImport, onDemo, loading, error, recent }: LandingProps) {
  const address = useRef<HTMLInputElement>(null);
  const start = () => {
    document.getElementById("start")?.scrollIntoView({ behavior: "instant", block: "start" });
    address.current?.focus({ preventScroll: true });
  };

  return (
    <main className="gallery-home">
      <section className="gallery-hero" id="start" aria-labelledby="home-title">
        <h1 id="home-title">把网页调到<br className="gallery-hero-break" />刚刚好。</h1>
        <p className="gallery-intro">按钮再往上一点，卡片再宽一点。<br />用鼠标和方向键，完成你想要的细节。</p>
        <div className="gallery-entry">
          <form className="gallery-input" onSubmit={(event) => { event.preventDefault(); onOpen(); }}>
            <label className="visually-hidden" htmlFor="page-address">网站链接或本地项目地址</label>
            <Link2 size={19} aria-hidden="true" />
            <input id="page-address" ref={address} placeholder="粘贴网站链接，或本地项目路径" value={location} onChange={(event) => onLocationChange(event.target.value)} aria-describedby={error ? "home-error" : undefined} aria-invalid={!!error} autoComplete="off" spellCheck={false} />
            <button className="gallery-primary" type="submit" disabled={loading}>打开页面</button>
          </form>
          <div className="gallery-entry-links">
            <button onClick={onImport}><FolderOpen size={15} />选择项目文件夹</button>
            <button onClick={onDemo}>先试用示例<ChevronRight size={15} /></button>
          </div>
          {error && <div className="gallery-error" id="home-error" role="alert">{error}</div>}
          {recent.length > 0 && <div className="gallery-recent"><span>最近打开</span>{recent.slice(0, 3).map((item) => <button key={item} onClick={() => onOpen(item)} title={item}><History size={13} /><span>{item}</span></button>)}</div>}
        </div>
        <div className="gallery-hero-product">
          <ProductPreview compact />
          <div className="gallery-product-caption"><span>从一个小小的调整开始。</span><a href="#how-it-works">看看怎么用<ArrowDown size={14} /></a></div>
        </div>
      </section>

      <div id="how-it-works" className="gallery-demonstration"><ScrollShowcase onTry={onDemo} /></div>

      <section className="gallery-source" id="your-code" aria-labelledby="source-title">
        <div className="gallery-source-copy">
          <h2 id="source-title">只动想动的地方。<br />其余，保持原样。</h2>
          <p>接入项目源码后，改动会落在对应元素上。<br className="desktop-break" />原来的结构、注释与无关代码，留在原处。</p>
        </div>
        <div className="gallery-diff" aria-label="局部源码修改示意">
          <div className="gallery-diff-heading"><span>index.html</span><span>一处调整</span></div>
          <pre><code><span className="gallery-code-muted">{'<div class="actions">'}</span>{"\n"}<span>{'  <button'}</span>{"\n"}<span className="gallery-code-muted">{'    class="start-button"'}</span>{"\n"}<span className="gallery-code-added"><span aria-hidden="true">+ </span>{'  style="translate: 0px -12px;"'}</span>{"\n"}<span>{'  >开始探索</button>'}</span>{"\n"}<span className="gallery-code-muted">{'</div>'}</span></code></pre>
          <div className="gallery-diff-note"><Check size={15} /><span>看清差异，再把代码带走。</span></div>
        </div>
        <div className="gallery-delivery">
          <div><h3>有项目文件</h3><p>导入 HTML、React 或 Vue 项目，复制修改后的源码，也可以下载最小差异。</p><button onClick={onImport}>选择项目文件夹<ChevronRight size={14} /></button></div>
          <div><h3>只有网站链接</h3><p>直接调整当前页面，带走 CSS 或 JavaScript 布局补丁。原始工程需要你提供。</p><button onClick={start}>输入网站链接<ChevronRight size={14} /></button></div>
        </div>
      </section>

      <section className="gallery-closing" aria-labelledby="closing-title">
        <h2 id="closing-title">你的想法。<br />现在，刚刚好。</h2>
        <p>打开一个页面，亲手调整第一个细节。</p>
        <a className="gallery-primary" href="#start" onClick={(event) => { event.preventDefault(); start(); }}>打开页面<ArrowUpRight size={17} /></a>
      </section>
      <footer className="gallery-footer"><span>微调 miweb</span><p>为已经成形的想法，留一点调整的自由。</p><a href="#start">回到顶部</a></footer>
    </main>
  );
}
