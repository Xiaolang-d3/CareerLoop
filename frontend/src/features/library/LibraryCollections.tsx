import { Layers3, MoreHorizontal } from "lucide-react";
import type { LibraryCollection } from "../../types";

export function LibraryCollections({ collections, selectedId, busy, onSelect, onRename, onDelete }: {
  collections: LibraryCollection[];
  selectedId: number | null;
  busy: boolean;
  onSelect: (id: number | null) => void;
  onRename: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const selected = collections.find((item) => item.id === selectedId);
  return <div className="fl-collection-scope">
    <label className={`fl-scope-select${selected ? " is-active" : ""}`} title="主题集合可跨目录整理，同一文件可加入多个主题">
      <Layers3 size={15} />
      <select aria-label="选择主题集合" value={selectedId ?? "all"} onChange={(event) => onSelect(event.target.value === "all" ? null : Number(event.target.value))}>
        <option value="all">主题集合</option>
        {collections.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.file_count}</option>)}
      </select>
    </label>
    {selected ? <details className="fl-menu-wrap">
      <summary className="fl-icon-button" aria-label="主题集合操作" title="主题集合操作"><MoreHorizontal size={18} /></summary>
      <div className="fl-menu">
        <button type="button" disabled={busy} onClick={() => onRename(selected.id)}>重命名集合</button>
        <button type="button" disabled={busy} onClick={() => onDelete(selected.id)}>删除集合</button>
      </div>
    </details> : null}
  </div>;
}
