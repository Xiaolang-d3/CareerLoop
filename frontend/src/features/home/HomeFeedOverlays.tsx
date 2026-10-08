import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bookmark, Copy, EyeOff, FolderPlus, Plus, SlidersHorizontal, Sparkles, X } from "lucide-react";
import type { FetchJson, HomePreferences, HomeReadableItem } from "./types";
import { FeedActions, validWebUrl } from "./HomeFeedCards";

export type HomeMenuTarget = { item: HomeReadableItem; anchor: HTMLButtonElement };

export function HomeMoreMenu({ target, bookmarked, onClose, onBookmark, onSave, onAnalyze, onHide, onCopy }: {
  target: HomeMenuTarget; bookmarked: boolean; onClose: () => void;
  onBookmark: () => void; onSave: () => void; onAnalyze: () => void; onHide: () => void; onCopy: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rect = target.anchor.getBoundingClientRect();
  const menuHeight = 6 * 32 + 16;
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8));
  const left = Math.max(8, Math.min(rect.right - 216, window.innerWidth - 224));
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !target.anchor.contains(event.target as Node)) onClose(); };
    const close = () => onClose();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", close); target.anchor.focus(); };
  }, [target, onClose]);
  const actions = [
    { label: bookmarked ? "取消收藏" : "收藏", icon: Bookmark, action: onBookmark },
    { label: "存入文件库", icon: FolderPlus, action: onSave },
    { label: "交给 AI 分析", icon: Sparkles, action: onAnalyze },
    { label: "复制链接", icon: Copy, action: onCopy },
    { label: "隐藏此条", icon: EyeOff, action: onHide }
  ];
  return <div ref={ref} className="home-menu" role="menu" aria-label={`更多操作：${target.item.title}`} style={{ top, left }} onKeyDown={(event) => {
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); onClose(); return; }
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") || []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }}>{actions.map(({ label, icon: Icon, action }) => <button key={label} role="menuitem" type="button" onClick={() => { onClose(); action(); }}><Icon size={16} />{label}</button>)}</div>;
}

function HomeDialog({ title, children, onClose, labelledBy, closeDisabled = false }: { title: string; children: ReactNode; onClose: () => void; labelledBy: string; closeDisabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  return <div className="home-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-busy={closeDisabled} aria-labelledby={labelledBy} className="home-dialog" onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); if (!closeDisabled) onClose(); }
    if (event.key !== "Tab") return;
    const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']") || []);
    if (!elements.length) { event.preventDefault(); return; }
    const first = elements[0]; const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}><div className="home-dialog-head"><h2 id={labelledBy}>{title}</h2><button type="button" className="home-icon-btn" aria-label="关闭" disabled={closeDisabled} onClick={onClose}><X size={18} /></button></div>{children}</div></div>;
}

export function HomeInterestDialog({ preferences, savePreferences, onClose }: { preferences: HomePreferences; savePreferences: (preferences: HomePreferences) => Promise<void>; onClose: () => void }) {
  const [topics, setTopics] = useState(preferences.topics);
  const [repositories, setRepositories] = useState(preferences.repositories.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <HomeDialog title="兴趣设置" labelledBy="home-interest-title" onClose={onClose} closeDisabled={busy}><form onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    const parsed = [...new Set(repositories.split(/[\n,，]/).map((value) => value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "")).filter(Boolean))];
    if (parsed.some((repository) => !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))) { setError("仓库格式应为 owner/repository，每行一个公开仓库。"); return; }
    if (parsed.length > 8) { setError("最多关注 8 个公开仓库。"); return; }
    setBusy(true); setError(null);
    try { await savePreferences({ topics, repositories: parsed }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "兴趣设置保存失败，请重试。"); }
    finally { setBusy(false); }
  }}><p className="home-dialog-description">选择想关注的方向，并添加公开 GitHub 仓库以获取版本更新。</p><fieldset className="home-interest-topics"><legend><SlidersHorizontal size={16} />关注方向</legend><div className="home-chips">{["AI", "Agent", "MCP", "RAG", "评测", "开发工具"].map((key) => <button className={`home-chip${topics.includes(key) ? " on" : ""}`} type="button" key={key} disabled={busy} aria-pressed={topics.includes(key)} onClick={() => setTopics((current) => current.includes(key) ? current.filter((topic) => topic !== key) : [...current, key])}>{key}</button>)}</div></fieldset><label className="home-field">公开仓库<textarea rows={5} value={repositories} disabled={busy} onChange={(event) => setRepositories(event.target.value)} placeholder="例如 owner/repository，每行一个" /><span>最多 8 个公开仓库，只读取公开发布说明。清空后停止关注仓库更新。</span></label>{error && <p className="home-dialog-error" role="alert">{error}</p>}<div className="home-dialog-actions"><button className="home-btn" type="button" onClick={onClose} disabled={busy}>取消</button><button className="home-btn home-btn-primary" type="submit" disabled={busy}>{busy ? "保存中…" : "保存设置"}</button></div></form></HomeDialog>;
}

export function HomeLibraryDialog({ item, fetchJson, onLibraryChanged, onClose, onSaved }: { item: HomeReadableItem; fetchJson: FetchJson; onLibraryChanged: () => Promise<void>; onClose: () => void; onSaved: (message: string) => void }) {
  const [title, setTitle] = useState(item.title);
  const [summary, setSummary] = useState(item.summary);
  const [url, setUrl] = useState(item.url);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <HomeDialog title="存入文件库" labelledBy="home-library-title" onClose={onClose} closeDisabled={busy}><form onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!title.trim() || !validWebUrl(url.trim())) { setError("请填写标题和有效的 http / https 原文链接。"); return; }
    setError(null); setBusy(true);
    try {
      await fetchJson("/library/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), content: [summary.trim(), `原文链接：${url.trim()}`, `来源：${item.source}`, ...(item.published_at ? [`发布时间：${item.published_at}`] : [])].filter(Boolean).join("\n\n"), privacy_mode: "redacted" }) });
      try { await onLibraryChanged(); onSaved("已存入文件库"); } catch { onSaved("已存入文件库，列表刷新失败，请在文件库重新刷新"); }
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }}><p className="home-dialog-description">确认要保存的标题、摘要和原文链接。内容会按文件库默认规则脱敏。</p><label className="home-field">标题<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} maxLength={200} required /></label><label className="home-field">摘要<textarea value={summary} onChange={(event) => setSummary(event.target.value)} disabled={busy} rows={5} /></label><label className="home-field">原文链接<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} required /></label>{error && <p className="home-dialog-error" role="alert">{error}</p>}<div className="home-dialog-actions"><button className="home-btn" type="button" onClick={onClose} disabled={busy}>取消</button><button className="home-btn home-btn-primary" type="submit" disabled={busy}><Plus size={16} />{busy ? "保存中…" : "确认存入"}</button></div></form></HomeDialog>;
}

export function HomeBookmarksDialog({ items, busyItems, onBookmark, onMore, openItemId, onClose }: { items: HomeReadableItem[]; busyItems: Set<string>; onBookmark: (id: string) => void; onMore: (item: HomeReadableItem, anchor: HTMLButtonElement) => void; openItemId: string | null; onClose: () => void }) {
  return <HomeDialog title="我的收藏" labelledBy="home-bookmarks-title" onClose={onClose}><p className="home-dialog-description">收藏保留标题、摘要与原文链接，资讯移出首页后仍可访问。</p>{items.length ? <div className="home-bookmark-list">{items.map((item) => <article className="home-bookmark-row" key={item.id}><h3><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></h3><p>{item.summary}</p><div className="home-bookmark-foot"><span>{item.source}</span><FeedActions item={item} bookmarked busy={busyItems.has(item.id)} onBookmark={() => onBookmark(item.id)} onMore={onMore} openItemId={openItemId} /></div></article>)}</div> : <div className="home-empty"><Bookmark size={32} /><h3>还没有收藏</h3><p>阅读时点击书签，即可把值得回看的内容保存在这里。</p></div>}</HomeDialog>;
}
