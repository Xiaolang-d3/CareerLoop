import type { LibraryFolder } from "../../types";
import { emptyFileFilters, type FileFilters, type KnowledgeUse, type SourceOrigin } from "./library-state";

export function LibraryFilters({ folders, folderId, unfiled, filters, onFolderChange, onChange, onReset }: {
  folders: LibraryFolder[];
  folderId: number | null;
  unfiled: boolean;
  filters: FileFilters;
  onFolderChange: (value: string) => void;
  onChange: (filters: FileFilters) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = folderId !== null || unfiled || filters.origin !== emptyFileFilters.origin || filters.knowledge !== emptyFileFilters.knowledge;
  const labels = [
    unfiled ? "未分类" : folders.find((folder) => folder.id === folderId)?.name,
    { all: "", upload: "导入文件", note: "文本笔记", chat: "对话成果" }[filters.origin],
    { all: "", ready: "长期使用", archive: "仅存档", needs_text: "无可检索正文" }[filters.knowledge]
  ].filter(Boolean);
  return <div className="fl-filter-disclosure">
    <div className="fl-filter-summary">
      <button type="button" aria-expanded={open} aria-controls="library-file-filters" onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={15} />筛选<ChevronDown size={14} />
      </button>
      {active && <><span>{labels.join(" · ")}</span><button type="button" className="fl-filter-reset" onClick={onReset}>清除筛选</button></>}
    </div>
    {open && <div id="library-file-filters" className="fl-filters" aria-label="文件筛选">
    <label>目录
      <select aria-label="筛选目录" value={unfiled ? "unfiled" : folderId ?? "all"}
        onChange={(event) => onFolderChange(event.target.value)}>
        <option value="all">全部目录</option>
        <option value="unfiled">未分类</option>
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
    </label>
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
    </div>}
  </div>;
}
import { useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
