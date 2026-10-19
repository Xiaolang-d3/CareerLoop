import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { emptyFileFilters, type FileFilters, type KnowledgeUse, type SourceOrigin } from "./library-state";

export function LibraryFilters({ filters, onChange }: {
  filters: FileFilters;
  onChange: (filters: FileFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const active = filters.origin !== emptyFileFilters.origin || filters.knowledge !== emptyFileFilters.knowledge;
  const labels = [
    { all: "", upload: "导入文件", note: "文本笔记", chat: "对话成果" }[filters.origin],
    { all: "", ready: "长期使用", archive: "仅存档", needs_text: "无可检索正文" }[filters.knowledge]
  ].filter(Boolean);
  return <div className="fl-filter-disclosure" ref={panel} onKeyDown={(event) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  }}>
    <div className="fl-filter-summary">
      <button ref={trigger} type="button" aria-label="筛选" aria-expanded={open} aria-controls={panelId} className={active ? "is-filtered" : ""} onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={15} />筛选
        {active && <span className="fl-filter-count" aria-label={`${labels.length} 个筛选条件`}>{labels.length}</span>}
        <ChevronDown className="fl-filter-chevron" size={14} aria-hidden="true" />
      </button>
      {active && <span>{labels.join(" · ")}</span>}
    </div>
    {open && <div id={panelId} className="fl-filters" aria-label="文件筛选">
    <header><strong>筛选文件</strong><button type="button" className="fl-icon-button" aria-label="关闭筛选" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></header>
    <label>来源
      <select aria-label="筛选来源" value={filters.origin}
        onChange={(event) => onChange({ ...filters, origin: event.target.value as SourceOrigin })}>
        <option value="all">全部来源</option>
        <option value="upload">导入文件</option>
        <option value="note">文本笔记</option>
        <option value="chat">对话成果</option>
      </select>
    </label>
    <label>AI 使用
      <select aria-label="筛选 AI 使用" value={filters.knowledge}
        onChange={(event) => onChange({ ...filters, knowledge: event.target.value as KnowledgeUse })}>
        <option value="all">全部状态</option>
        <option value="ready">长期使用</option>
        <option value="archive">仅存档</option>
        <option value="needs_text">无可检索正文</option>
      </select>
    </label>
    {active && <button type="button" className="fl-filter-reset" onClick={() => onChange(emptyFileFilters)}>重置条件</button>}
    </div>}
  </div>;
}
