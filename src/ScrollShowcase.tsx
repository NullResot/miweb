import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowUpRight, MousePointer2 } from "lucide-react";
import "./scroll-showcase.css";

const steps = [
  {
    name: "选中元素",
    title: "点选你想调整的元素。",
    description: "按钮、文字或一张卡片。点击页面，蓝色选框就会跟随你的选择。",
  },
  {
    name: "微调布局",
    title: "向上 12 px，再宽 24 px。",
    description: "拖动到合适的位置，拉宽一点。需要更精确时，用方向键每次移动 1 px。",
  },
  {
    name: "带走代码",
    title: "只带走发生变化的代码。",
    description: "连接项目源码后，查看最小差异，再复制改后的文件。只有网址时，带走布局补丁。",
  },
] as const;

function Pointer() {
  return (
    <MousePointer2 className="mi-preview-pointer" fill="#f5f5f7" stroke="#101012" strokeWidth={1.5} aria-hidden="true" />
  );
}

/** A static product illustration by default; the showcase controls its CSS variables. */
export function ProductPreview({
  compact = false,
  animated = false,
}: {
  compact?: boolean;
  animated?: boolean;
}) {
  return (
    <div
      className={`mi-preview${compact ? " mi-preview--compact" : ""}${animated ? " mi-preview--animated" : ""}`}
      data-ui
      role="img"
      aria-label="界面设计示例网页：好设计，精确到每一像素。蓝色选框展示按钮的位置和尺寸微调。"
    >
      <div className="mi-preview-browser" aria-hidden="true">
        <span className="mi-preview-dots"><i /><i /><i /></span>
        <span>界面预览 · 示例</span>
        <span className="mi-preview-browser-end" />
      </div>
      <div className="mi-preview-page" aria-hidden="true">
        <div className="mi-preview-nav">
          <span className="mi-preview-wordmark">Interface</span>
          <span className="mi-preview-navlinks">产品设计 <i /> 设计系统</span>
        </div>
        <div className="mi-preview-content">
          <div className="mi-preview-copy">
            <span className="mi-preview-intro">从想法，到精确的界面。</span>
            <div className="mi-preview-headline">好设计，<br />精确到每一像素。</div>
            <p className="mi-preview-body">让位置、比例与留白，恰到好处。<br />每一次调整，都清楚可见。</p>
            <div className="mi-preview-action-row">
              <div className="mi-preview-target">
                <span className="mi-preview-cta"><span>开始设计</span><ArrowUpRight size={17} strokeWidth={1.5} /></span>
                <div className="mi-preview-selection">
                  <span className="mi-preview-selection-label">button</span>
                  <i className="mi-preview-handle mi-preview-handle--nw" />
                  <i className="mi-preview-handle mi-preview-handle--ne" />
                  <i className="mi-preview-handle mi-preview-handle--sw" />
                  <i className="mi-preview-handle mi-preview-handle--se" />
                  <i className="mi-preview-handle mi-preview-handle--e" />
                </div>
                <Pointer />
              </div>
              <span className="mi-preview-original-position" />
              <span className="mi-preview-measure">上移 12 px <i /> 宽度 184 px</span>
            </div>
          </div>
          <div className="mi-preview-art">
            <span className="mi-preview-art-title">布局视图<span>示意</span></span>
            <div className="mi-preview-plane mi-preview-plane--back"><span>页面 / Desktop</span><span>1280 × 800</span></div>
            <div className="mi-preview-plane mi-preview-plane--front">
              <div className="mi-preview-plane-bar"><span>.start</span><span>原始尺寸</span></div>
              <div className="mi-preview-plane-lines"><span>宽度 <b>160 px</b></span><span>高度 <b>48 px</b></span></div>
              <div className="mi-preview-plane-target"><span>button</span><i /><i /><i /><i /></div>
              <div className="mi-preview-plane-baseline" />
            </div>
            <div className="mi-preview-art-caption"><span>目标调整</span><span>X <b>0</b></span><span>Y <b>−12</b></span><span>W <b>184</b></span></div>
          </div>
        </div>
        <div className="mi-preview-footer"><span>位置有依据，细节有分寸。</span><span>为屏幕而设计</span></div>
      </div>
    </div>
  );
}

export default function ScrollShowcase({ onTry }: { onTry: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const regions = useRef<(HTMLDivElement | null)[]>([]);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const scrollStep = useRef(0);
  const [activeStep, setActiveStep] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 2 : 0);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | null = null;
    const observe = () => {
      observer?.disconnect();
      if (media.matches) return;
      const height = window.innerHeight;
      // CSS owns continuous motion. React only changes the three text states.
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(entry.target.getAttribute("data-step-region"));
          scrollStep.current = index;
          setActiveStep(index);
          setManual(false);
        }
      }, { rootMargin: `-${Math.round(height * 0.4)}px 0px -${Math.round(height * 0.6) - 2}px 0px` });
      for (const region of regions.current) if (region) observer.observe(region);
    };
    const preferenceChanged = () => {
      setReducedMotion(media.matches);
      setManual(false);
      if (media.matches) setActiveStep(2);
      observe();
    };
    preferenceChanged();
    window.addEventListener("resize", observe, { passive: true });
    media.addEventListener("change", preferenceChanged);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", observe);
      media.removeEventListener("change", preferenceChanged);
    };
  }, []);

  const selectStep = (index: number, focus = false) => {
    setActiveStep(index);
    setManual(true);
    if (focus) buttons.current[index]?.focus({ preventScroll: true });
  };
  const handleStepKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % steps.length;
    else if (event.key === "ArrowLeft") next = (index + steps.length - 1) % steps.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = steps.length - 1;
    else return;
    event.preventDefault();
    selectStep(next, true);
  };

  return (
    <section className={`mi-showcase${reducedMotion ? " mi-showcase--reduced" : ""}`} aria-label="滚动操作演示">
      <div className="mi-showcase-intro" data-reveal="intro">
        <h2>看着页面，<br />把细节调到位。</h2>
        <p>从选中一个按钮，到带走几行改动。<br />{reducedMotion ? "逐步了解，或点选下面的三个步骤。" : "向下滚动，看一次完整的微调。"}</p>
      </div>
      <div className="mi-showcase-track" ref={track}>
        {steps.map((step, index) => <div key={step.name} className={`mi-showcase-region mi-showcase-region--${index}`} ref={(element) => { regions.current[index] = element; }} data-step-region={index} aria-hidden="true" />)}
        <div className={`mi-showcase-stage${manual ? " mi-showcase-stage--manual" : ""}`} ref={stage} data-step={activeStep}>
          <div className="mi-showcase-controls" role="group" aria-label="演示步骤">
            {steps.map((step, index) => (
              <button
                key={step.name}
                type="button"
                ref={(element) => { buttons.current[index] = element; }}
                aria-pressed={activeStep === index}
                onClick={() => selectStep(index)}
                onKeyDown={(event) => handleStepKey(event, index)}
              >
                <span className="mi-showcase-step-number" aria-hidden="true">{index + 1}</span>
                {step.name}
              </button>
            ))}
          </div>
          <div className="mi-showcase-media">
            <ProductPreview animated />
            <div className="mi-showcase-code" aria-hidden={activeStep !== 2}>
              <div className="mi-showcase-code-title"><span>index.html</span><span>仅修改样式</span></div>
              <code>
                <span className="mi-showcase-code-removed">− &lt;button class="start"&gt;</span>
                <span className="mi-showcase-code-added">+ &lt;button class="start"<br /><span>    style="translate: 0 -12px;<br />    width: 184px;"&gt;</span></span>
              </code>
              <span className="mi-showcase-code-note">其余代码保持原样</span>
            </div>
          </div>
          <div className="mi-showcase-caption" aria-live="polite" aria-atomic="true">
            <h3>{steps[activeStep].title}</h3>
            <p>{steps[activeStep].description}</p>
          </div>
          <p className="mi-showcase-footnote">示例操作演示{manual && !reducedMotion ? <> · <button type="button" onClick={() => { setManual(false); setActiveStep(scrollStep.current); }}>继续随滚动演示</button></> : reducedMotion ? " · 已减少动态效果" : " · 也可点选上方步骤"}</p>
        </div>
      </div>
      {reducedMotion && (
        <ol className="mi-showcase-static" aria-label="完整操作步骤">
          {steps.map((step) => <li key={step.name}><h3>{step.name}</h3><p>{step.description}</p></li>)}
        </ol>
      )}
      <div className="mi-showcase-outro">
        <p>你的下一个细节，<br />现在就可以调。</p>
        <button type="button" onClick={onTry}>亲手试一试</button>
      </div>
    </section>
  );
}
