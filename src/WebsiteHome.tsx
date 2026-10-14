import { ArrowDown, ChevronRight, Download, FolderOpen } from "lucide-react";
import Landing from "./Landing";

export default function WebsiteHome({ base }: { base: string }) {
  const docs = `${base}guide/overview.html`;
  const download = () => document.getElementById("downloads")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  const openDocs = () => { window.location.href = `${base}guide/import.html`; };
  const installers = [
    ["Windows x64", "Miweb-Setup-x64.exe"],
    ["macOS · Apple 芯片", "Miweb-mac-arm64.dmg"],
    ["macOS · Intel", "Miweb-mac-x64.dmg"],
  ];
  const entry = <div className="gallery-entry">
    <p className="gallery-intro">按钮再往上一点，卡片再宽一点。<br />用鼠标和方向键，完成你想要的细节。</p>
    <div className="gallery-input website-download-entry"><Download size={19} /><span>安装微调，直接调整你的网页。</span><a className="gallery-primary" href="#downloads">下载桌面版</a></div>
    <div className="gallery-entry-links"><a href={docs}><FolderOpen size={15} />阅读使用文档</a><a href="#how-it-works">看看怎么用<ChevronRight size={15} /></a></div>
  </div>;
  const downloads = <section className="website-downloads" id="downloads" aria-labelledby="downloads-title">
    <h2 id="downloads-title">安装后，直接开始。</h2>
    <p>内置运行环境与页面渲染器。选择适合你电脑的版本。</p>
    <div>{installers.map(([label, file]) => <a key={file} className="gallery-primary" href={`https://github.com/NullResot/miweb/releases/latest/download/${file}`}><Download size={16} />{label}</a>)}</div>
    <p className="website-install-note">Windows 10 / 11 x64，macOS 13 及以上。<a href={`${base}guide/install.html`}>安装与首次打开说明</a></p>
  </section>;
  return <div className="marketing-home"><div className="home">
    <header className="app-header">
      <a className="logo" href={base}><span className="logo-mark" aria-hidden="true"><span /><span /><span /></span><span>微调<span className="logo-english">miweb</span></span></a>
      <nav className="home-nav" aria-label="首页导航"><a href="#how-it-works">操作演示</a><a href="#your-code">代码交付</a><a href={docs}>文档</a></nav>
      <a className="gallery-primary" href="#downloads">下载桌面版<ArrowDown size={14} /></a>
    </header>
    <Landing full entry={entry} downloads={downloads} location="" onLocationChange={() => {}} onOpen={download} onDemo={download} onImport={openDocs} loading={false} error="" recent={[]} />
  </div></div>;
}
