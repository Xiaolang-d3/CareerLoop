import { useEffect, useRef, useState } from "react";
import type { ChatAttachment, ChatWorkspaceProps } from "./types";
import { downloadBlob } from "./result-files";
import { PngExportButton } from "./PngExportButton";
import { Download, ImagePlus, Palette, RefreshCw, Sparkles, X } from "lucide-react";
import "./banner-workbench.css";

export type BannerImageEntry = { asset: ChatAttachment; messageId: number; prompt: string };
type BannerWorkbenchProps = {
  open: boolean;
  entries: BannerImageEntry[];
  loadOriginal?: ChatWorkspaceProps["onLoadAttachment"];
  onUsePrompt: (prompt: string) => void;
  onClose: () => void;
  onPreviewImage?: (asset: ChatAttachment) => void;
  busy?: boolean;
  promptStatus?: "ready" | "pending";
};

const entryKey = (entry: BannerImageEntry) => JSON.stringify([entry.messageId, entry.asset.id]);
type Original = { controller: AbortController; file?: Blob; url?: string; error?: string; width?: number; height?: number };

function useOriginals(open: boolean, entries: BannerImageEntry[], loadOriginal: BannerWorkbenchProps["loadOriginal"]) {
  const records = useRef(new Map<string, Original>());
  const loader = useRef(loadOriginal);
  loader.current = loadOriginal;
  const [, redraw] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const signature = JSON.stringify(entries.map(entryKey).sort());
  const available = Boolean(loadOriginal);
  useEffect(() => {
    if (!open) return;
    const current = records.current;
    return () => {
      for (const original of current.values()) {
        original.controller.abort();
        if (original.url) URL.revokeObjectURL(original.url);
      }
      current.clear();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const current = records.current;
    const wanted = new Set(entries.map(entryKey));
    for (const [key, original] of current) {
      if (!wanted.has(key) || !available) {
        original.controller.abort();
        if (original.url) URL.revokeObjectURL(original.url);
        current.delete(key);
      }
    }
    if (!loader.current) { redraw(value => value + 1); return; }
    for (const entry of entries) {
      const key = entryKey(entry);
      if (current.has(key)) continue;
      const original: Original = { controller: new AbortController() };
      current.set(key, original);
      const load = loader.current;
      void Promise.resolve().then(() => {
        if (original.controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        return load(entry.asset, original.controller.signal);
      }).then(({ file }) => {
        if (original.controller.signal.aborted || current.get(key) !== original) return;
        original.file = file;
        original.url = URL.createObjectURL(file);
        redraw(value => value + 1);
      }).catch(() => {
        if (original.controller.signal.aborted || current.get(key) !== original) return;
        original.error = "原图加载失败，请重试。";
        redraw(value => value + 1);
      });
    }
    redraw(value => value + 1);
    // Asset identity, not parent-created arrays or callbacks, defines a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signature, available, attempt]);
  const retry = (key: string) => {
    const original = records.current.get(key);
    original?.controller.abort();
    if (original?.url) URL.revokeObjectURL(original.url);
    records.current.delete(key);
    setAttempt(value => value + 1);
  };
  const failDisplay = (key: string) => {
    const original = records.current.get(key);
    if (original && !original.error) {
      original.error = "图片无法显示，可重试加载或下载原图检查。";
      redraw(value => value + 1);
    }
  };
  const readDimensions = (key: string, image: HTMLImageElement) => {
    const original = records.current.get(key);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (original && width > 0 && height > 0 && (original.width !== width || original.height !== height)) {
      original.width = width;
      original.height = height;
      redraw(value => value + 1);
    }
  };
  return { originals: records.current, retry, failDisplay, readDimensions };
}

function imageDetails(asset: ChatAttachment, original?: Original) {
  const width = original?.width || asset.width, height = original?.height || asset.height;
  return `${width && height ? `${width} × ${height} px` : "尺寸未提供"} · ${asset.model_name || "模型未提供"}`;
}

export function BannerWorkbench({ open, entries, loadOriginal, onUsePrompt, onClose, busy = false, promptStatus, onPreviewImage }: BannerWorkbenchProps) {
  const [subject, setSubject] = useState("");
  const [style, setStyle] = useState("简洁立体，柔和光影");
  const [palette, setPalette] = useState("紫色与奶白");
  const [ratio, setRatio] = useState("3:1");
  const [safeArea, setSafeArea] = useState("left");
  const [direction, setDirection] = useState(0);
  const [briefOpen, setBriefOpen] = useState(() => !entries.some(entry => entry.asset.kind === "image" && entry.asset.origin === "generated"));
  const subjectRef = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<"original" | "compare" | "placement">("original");
  const viewTabs = useRef<Array<HTMLButtonElement | null>>([]);
  const candidates = entries.filter(entry => entry.asset.kind === "image" && entry.asset.origin === "generated");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = candidates.find(entry => entryKey(entry) === selectedKey) || candidates.at(-1);
  const [comparisonKeys, setComparisonKeys] = useState<string[] | null>(null);
  const comparison = candidates.filter(entry => (comparisonKeys || candidates.slice(0, 2).map(entryKey)).includes(entryKey(entry)));
  const requested = candidates.filter(entry => entry === selected || comparison.includes(entry));
  const { originals, retry, failDisplay, readDimensions } = useOriginals(open, requested, loadOriginal);
  const selectedOriginal = selected && originals.get(entryKey(selected));
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [screenshotError, setScreenshotError] = useState("");
  const [placement, setPlacement] = useState({ x: 5, y: 18, width: 90, height: 30 });
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  useEffect(() => {
    if (!open || !screenshot) { setScreenshotUrl(""); return; }
    const url = URL.createObjectURL(screenshot);
    setScreenshotUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [open, screenshot]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open]);
  const prepare = (alternate = false) => {
    if (busy) return;
    const historicalPrompt = alternate && !subject.trim() ? selected?.prompt.trim() : "";
    if (!subject.trim() && !historicalPrompt) return;
    const nextDirection = alternate ? direction + 1 : direction;
    if (alternate) setDirection(nextDirection);
    onUsePrompt([
      "帮我生成一张图片：用于界面的 Banner。",
      "仅生成一张 Banner 图片。",
      ...(historicalPrompt ? ["沿用以下文字需求（未发送原图）：", historicalPrompt] : [
        `主题与用途：${subject.trim()}。视觉风格：${style.trim()}。主色与配色：${palette.trim()}。`,
        `构图目标比例 ${ratio}（仅为构图目标，实际输出尺寸可能不同）。`,
        `主体位于${safeArea === "left" ? "右侧" : "左侧"}，${safeArea === "left" ? "左侧" : "右侧"}预留约 40% 干净低对比空间作为后续文案安全区。`,
      ]),
      "不要生成任何文字、字母、数字、Logo 或水印，文案之后在页面中排版。",
      ...(alternate ? [`探索不同的视觉方向 ${nextDirection}：保留以上需求，重新设计主体造型与光影层次；这是一张新图，不是原图的局部编辑。`] : []),
    ].join("\n"));
  };
  const renderOriginal = (entry: BannerImageEntry, primary = false) => {
    const key = entryKey(entry), original = originals.get(key);
    if (original?.error) return <div className="banner-original-state">
      <p role={primary ? "alert" : undefined}>{original.error}</p>
      {(primary || entry !== selected) && <button type="button" aria-label={`重试加载${entry.asset.original_filename}`} onClick={() => retry(key)}>重试加载</button>}
    </div>;
    if (original?.url) return <img
      src={original.url}
      alt={`${primary ? "当前方案" : "对比方案"}：${entry.asset.original_filename}`}
      onError={() => failDisplay(key)}
      onLoad={event => readDimensions(key, event.currentTarget)}
    />;
    return <p role={primary ? "status" : undefined}>{loadOriginal ? "正在加载原图…" : "暂时无法读取原图"}</p>;
  };
  if (!open) return null;
  return <aside id="banner-design-workbench" role="region" aria-label="Banner 设计台" className={`banner-workbench${candidates.length ? " has-candidates" : ""}${briefOpen ? " is-brief-open" : ""}`} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <header className="banner-workbench-header">
      <div className="banner-heading"><Palette size={18} aria-hidden="true" /><div><h2>Banner 设计台</h2><p>{selected ? `${candidates.length} 个方案 · 选择、比较，再放回页面` : "从一个想法，做出能用的界面配图"}</p></div></div>
      <div className="banner-heading-actions">
        <button type="button" className="banner-brief-toggle" aria-label="编辑需求" aria-expanded={briefOpen} aria-controls="banner-brief-form" onClick={() => setBriefOpen(value => !value)}>{briefOpen ? "收起需求" : "编辑需求"}</button>
        <button ref={closeRef} type="button" className="banner-close" aria-label="关闭 Banner 设计台" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
    </header>
    <nav className="banner-view-tabs" role="tablist" aria-label="设计台视图">
      {([['original', '原图'], ['compare', '候选对比'], ['placement', '页面预览']] as const).map(([id, label], index) => <button key={id} ref={element => { viewTabs.current[index] = element; }} id={`banner-tab-${id}`} type="button" role="tab" aria-selected={view === id} aria-controls={`banner-panel-${id}`} tabIndex={view === id ? 0 : -1} onClick={() => setView(id)} onKeyDown={event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : null;
        if (next !== null) { event.preventDefault(); viewTabs.current[next]?.click(); viewTabs.current[next]?.focus(); }
      }}>{label}{id === 'compare' && comparison.length > 0 ? <span aria-hidden="true">{comparison.length}</span> : null}</button>)}
    </nav>
    <div className="banner-workbench-body">
      <form id="banner-brief-form" className="banner-brief" hidden={!briefOpen} onSubmit={event => { event.preventDefault(); prepare(); }}>
        <div className="banner-section-heading"><h3>创作需求</h3><small>描述目标，不必写提示词</small></div>
        <label>主题与用途<textarea ref={subjectRef} rows={3} maxLength={3000} value={subject} onChange={event => setSubject(event.target.value)} placeholder="例如：会员招募活动，紫色礼盒主体，用于首页顶部…" /></label>
        <label>视觉风格<input maxLength={300} value={style} onChange={event => setStyle(event.target.value)} /></label>
        <label>主色与配色<input maxLength={300} value={palette} onChange={event => setPalette(event.target.value)} /></label>
        <div className="banner-brief-pair">
          <label>目标比例<select value={ratio} onChange={event => setRatio(event.target.value)}><option>3:1</option><option>16:9</option><option>2:1</option><option>1:1</option></select></label>
          <label>文案安全区<select value={safeArea} onChange={event => setSafeArea(event.target.value)}><option value="left">左侧留白</option><option value="right">右侧留白</option></select></label>
        </div>
        <div className={`banner-composition-guide is-${safeArea}`} aria-label={`${ratio}，${safeArea === "left" ? "左侧" : "右侧"}留白的构图示意`}><span>文案留白</span><i aria-hidden="true" /></div>
        <p className="banner-brief-tip">文字在页面中排版，图片里不生成标题或 Logo。</p>
        <details className="banner-capability-note"><summary>生成边界</summary><p>目标比例仅用于布局与提示词，实际输出尺寸可能不同。</p><p>新方案会重新生成，不会局部修改原图</p></details>
      </form>
      <div className="banner-stage">
        <div id="banner-panel-original" role="tabpanel" aria-labelledby="banner-tab-original" hidden={view !== "original"}>
          <section className="banner-current" aria-label="当前方案">
            <div className="banner-canvas">
              {selected ? renderOriginal(selected, true) : <div className="banner-canvas-empty"><ImagePlus size={30} strokeWidth={1.2} aria-hidden="true" /><h3>给你的页面，做一张合适的配图</h3><p>先描述用途和画面，确认指令后再生成。</p><button type="button" onClick={() => { setBriefOpen(true); window.requestAnimationFrame(() => subjectRef.current?.focus()); }}>填写需求</button></div>}
            </div>
            {selected ? <div className="banner-image-info"><strong>方案 {candidates.indexOf(selected) + 1}</strong><span>{imageDetails(selected.asset, selectedOriginal)}</span>{onPreviewImage ? <button type="button" disabled={!selectedOriginal?.file} onClick={() => onPreviewImage(selected.asset)}>放大查看</button> : null}<details><summary>生成指令</summary><p className="banner-lineage">{selected.prompt || "此图片未记录生成指令"}</p></details></div> : null}
          </section>
        </div>
        <div id="banner-panel-compare" role="tabpanel" aria-labelledby="banner-tab-compare" hidden={view !== "compare"}>
          <section className="banner-comparison-section" aria-label="候选对比">
            <div className="banner-section-heading"><h3>把不同方向，放在一起看</h3><p>在下方勾选对比，最多选择 4 张。</p></div>
            {comparison.length < 2 ? <p className="banner-comparison-hint">勾选至少两张候选图，比较不同方向。</p> : null}
            <div className="banner-comparison">{comparison.map(entry => <figure key={entryKey(entry)}>
              {renderOriginal(entry)}
              <figcaption><strong>方案 {candidates.indexOf(entry) + 1}</strong><small>{imageDetails(entry.asset, originals.get(entryKey(entry)))}</small></figcaption>
            </figure>)}</div>
          </section>
        </div>
        <div id="banner-panel-placement" role="tabpanel" aria-labelledby="banner-tab-placement" hidden={view !== "placement"}>
          <section className="banner-placement" aria-label="页面排版预览">
            <div className="banner-placement-heading"><div><h3>放回页面，看看是否合适</h3><p>页面截图仅用于本地排版预览，不会发送给生图模型</p></div><span className="banner-local-badge">仅本地</span></div>
            <div className="banner-placement-tools">
              <label className="banner-upload"><ImagePlus size={15} aria-hidden="true" />{screenshot ? "更换页面截图" : "上传页面截图"}<input type="file" aria-label="上传页面截图" accept="image/png,image/jpeg,image/webp" onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setScreenshotError("请选择 PNG、JPEG 或 WebP 图片。"); return; }
                if (!file.size) { setScreenshotError("页面截图不能是空文件。"); return; }
                if (file.size > 10 * 1024 * 1024) { setScreenshotError("页面截图不能超过 10 MB。"); return; }
                setScreenshotError(""); setScreenshot(file);
              }} /></label>
              {screenshot ? <button type="button" onClick={() => { setScreenshot(null); setScreenshotError(""); }}>移除页面截图</button> : null}
            </div>
            {screenshotError ? <p role="alert">{screenshotError}</p> : null}
            <div className="banner-placement-presets" role="group" aria-label="排版预设">
              <button type="button" onClick={() => setPlacement({ x: 0, y: 8, width: 100, height: 24 })}>顶部通栏</button>
              <button type="button" onClick={() => setPlacement({ x: 10, y: 28, width: 80, height: 24 })}>居中横幅</button>
              <button type="button" onClick={() => { setPlacement({ x: 5, y: 18, width: 90, height: 30 }); setFit("cover"); }}>恢复默认排版</button>
              <label>图片适配<select value={fit} onChange={event => setFit(event.target.value === "contain" ? "contain" : "cover")}><option value="cover">填满并裁切</option><option value="contain">完整显示</option></select></label>
            </div>
            <div className="banner-page-preview">
              {screenshotUrl ? <img className="banner-page-screenshot" src={screenshotUrl} alt="本地页面截图" onError={() => { setScreenshotError("无法读取页面截图，请选择有效图片。"); setScreenshot(null); }} /> : <div className="banner-generic-page"><p>通用页面示意，非原始页面</p><div aria-hidden="true" className="banner-placeholder-nav" /><div aria-hidden="true" className="banner-placeholder-content" /></div>}
              {selectedOriginal?.url && !selectedOriginal.error ? <img src={selectedOriginal.url} alt="页面中的 Banner 排版预览" className="banner-page-overlay" style={{ position: "absolute", left: `${placement.x}%`, top: `${placement.y}%`, width: `${placement.width}%`, height: `${placement.height}%`, objectFit: fit }} /> : <p className="banner-page-empty">选择已加载的图片，查看排版效果</p>}
            </div>
            <div className="banner-placement-controls">{([
              ["x", "横向位置（%）"], ["y", "纵向位置（%）"], ["width", "宽度（%）"], ["height", "高度（%）"],
            ] as const).map(([key, label]) => <label key={key}>{label}<input type="range" aria-label={label} min={key === "width" || key === "height" ? 1 : 0} max={key === "x" ? 100 - placement.width : key === "y" ? 100 - placement.height : key === "width" ? 100 - placement.x : 100 - placement.y} value={placement[key]} onChange={event => setPlacement(previous => ({ ...previous, [key]: Number(event.target.value) }))} /><output>{placement[key]}%</output></label>)}</div>
            <p className="banner-placement-note">仅为本地 CSS 排版预览，不会修改或导出合成图片。</p>
          </section>
        </div>
      </div>
    </div>
    {candidates.length ? <section className="banner-candidates" aria-label="候选方案">
      <div className="banner-candidates-heading"><h3>候选方案 <span>{candidates.length}</span></h3><small>点击查看 · 勾选对比</small></div>
      <div className="banner-candidate-list">{candidates.map((entry, index) => <div key={entryKey(entry)} className={`banner-candidate${selected === entry ? " is-selected" : ""}`}>
        <button type="button" aria-label={`选择方案 ${index + 1}：${entry.asset.original_filename}`} aria-pressed={selected === entry} onClick={() => setSelectedKey(entryKey(entry))}>
          <span className="banner-candidate-thumbnail">{originals.get(entryKey(entry))?.url ? <img src={originals.get(entryKey(entry))!.url} alt="" /> : <ImagePlus size={20} aria-hidden="true" />}</span>
          <span className="banner-candidate-caption"><strong>方案 {index + 1}</strong><small>{index === candidates.length - 1 ? "最新" : `消息 ${entry.messageId}`}</small></span>
        </button>
        <label><input type="checkbox" aria-label={`对比方案 ${index + 1}：${entry.asset.original_filename}`} checked={comparison.includes(entry)} disabled={!comparison.includes(entry) && comparison.length >= 4} onChange={() => {
          const keys = comparison.map(entryKey);
          setComparisonKeys(comparison.includes(entry) ? keys.filter(key => key !== entryKey(entry)) : [...keys, entryKey(entry)]);
        }} />对比</label>
      </div>)}</div>
    </section> : null}
    <footer className="banner-workbench-footer">
      <p role="status">{busy ? "本轮请求处理中，已有方案会保留。" : promptStatus === "pending" ? "指令已准备，请先在输入框选择替换或保留草稿。" : promptStatus === "ready" ? "指令已就绪，在左侧确认模型后发送。" : "只准备指令，确认发送后才调用模型。"}</p>
      <div className="banner-footer-actions">
        {selected && selectedOriginal?.file ? <PngExportButton key={entryKey(selected)} filename={selected.asset.original_filename} load={async () => selectedOriginal.file!} /> : null}
        <button type="button" disabled={!selectedOriginal?.file} onClick={() => { if (selected && selectedOriginal?.file) downloadBlob(selectedOriginal.file, selected.asset.original_filename); }}><Download size={14} aria-hidden="true" />下载原图</button>
        <button type="button" className={!briefOpen && selected ? "banner-prepare" : ""} disabled={(!subject.trim() && !selected?.prompt.trim()) || busy} onClick={() => prepare(true)}><RefreshCw size={14} aria-hidden="true" />另出一个方向</button>
        <button className={briefOpen || !selected ? "banner-prepare" : ""} type="submit" form="banner-brief-form" disabled={!subject.trim() || busy}><Sparkles size={15} aria-hidden="true" />准备生图指令</button>
      </div>
    </footer>
  </aside>;
}

