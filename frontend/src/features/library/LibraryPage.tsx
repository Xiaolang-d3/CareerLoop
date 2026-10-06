import {
  ArrowDownUp,
  ArrowLeft,
  ChevronDown,
  Download,
  Expand,
  FileImage,
  FileText,
  Folder,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  LibraryEditor,
  LibraryFolder,
  LibraryOrganization,
  LibrarySource,
  LibrarySourceDetail
} from "../../types";
import { homeInboxItems, type HomePendingFact } from "../home/home-metrics";
import { FilePreview } from "./FilePreview";
import { LibraryDialog } from "./LibraryDialog";
import "./file-library.css";

type Props = {
  editor: LibraryEditor;
  sources: LibrarySource[];
  folders?: LibraryFolder[];
  busy: boolean;
  sourceBusy: boolean;
  enhancedParse: boolean;
  pendingFacts?: HomePendingFact[];
  onChange: (editor: LibraryEditor) => void;
  onEnhancedParseChange: (enabled: boolean) => void;
  onImportFiles: (files: File[], folderId?: number | null) => void | Promise<void>;
  onCreateText: (
    title: string,
    content: string,
    privacy: "redacted" | "original",
    folderId?: number | null
  ) => void | Promise<void>;
  onLoadSource: (id: number) => Promise<LibrarySourceDetail>;
  onLoadOriginal?: (source: LibrarySourceDetail, signal?: AbortSignal) => Promise<Blob>;
  onUpdateSource: (
    id: number,
    changes: Partial<Pick<LibrarySource, "title" | "privacy_mode" | "enabled">> & { content?: string }
  ) => void | Promise<void>;
  onOrganizeSource?: (id: number, changes: LibraryOrganization) => Promise<void>;
  onCreateFolder?: (name: string) => Promise<void>;
  onSearchSources?: (query: string) => Promise<LibrarySource[]>;
  onUseForChat?: (ids: number[]) => Promise<void>;
  onDownloadSource: (source: LibrarySourceDetail) => void | Promise<void>;
  onDeleteSource: (id: number) => void | Promise<void>;
  onReviewFact?: (id: number, action: "confirm" | "reject") => void | Promise<void>;
  onSave: () => void | boolean | Promise<void | boolean>;
};
type Category = "all" | "recent" | "favorites" | "trash";
type DialogKind = "folder" | "note" | "rename" | "move" | "trash" | "permanent" | "preferences";
const categories: Array<[Category, string]> = [
  ["all", "全部文件"],
  ["recent", "最近使用"],
  ["favorites", "收藏"],
  ["trash", "回收站"]
];
const titles = {
  folder: "新建文件夹",
  note: "新建笔记",
  rename: "重命名文件",
  move: "移动文件",
  trash: "移入回收站",
  permanent: "永久删除",
  preferences: "知识与个性化"
};
function FileTypeIcon({ source }: { source: LibrarySource }) {
  const kind = source.mime_type.includes("pdf")
    ? "pdf"
    : source.mime_type.includes("word")
      ? "word"
      : source.mime_type.startsWith("image/")
        ? "image"
        : "text";
  const Icon = kind === "image" ? FileImage : FileText;
  return (
    <span className={`fl-file-icon ${kind}`}>
      <Icon size={23} strokeWidth={1.6} />
    </span>
  );
}
function sizeLabel(source: LibrarySource) {
  const bytes = source.size_bytes || 0;
  return bytes
    ? bytes >= 1048576
      ? `${(bytes / 1048576).toFixed(1)} MB`
      : `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${source.character_count.toLocaleString()} 字`;
}
function dateLabel(value: string) {
  const date = new Date(/Z|\+\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
function Button({
  label,
  icon,
  primary,
  disabled,
  action
}: {
  label: string;
  icon?: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  action: () => void;
}) {
  return (
    <button
      type="button"
      className={`fl-button ${primary ? "primary" : ""}`}
      aria-label={label}
      disabled={disabled}
      onClick={action}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function LibraryPage(props: Props) {
  const { sources, folders = [], editor } = props;
  const [category, setCategory] = useState<Category>("all"),
    [folderId, setFolderId] = useState<number | null>(null);
  const [query, setQuery] = useState(""),
    [searchIds, setSearchIds] = useState<number[] | null>(null),
    [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<number[]>([]),
    [grid, setGrid] = useState(false),
    [ascending, setAscending] = useState(false);
  const [preview, setPreview] = useState<LibrarySourceDetail | null>(null),
    [full, setFull] = useState(false),
    [loading, setLoading] = useState(false),
    [mode, setMode] = useState<"original" | "text">("original");
  const [menu, setMenu] = useState<number | "new" | null>(null),
    [dialog, setDialog] = useState<{ kind: DialogKind; ids: number[] } | null>(null);
  const [name, setName] = useState(""),
    [content, setContent] = useState(""),
    [target, setTarget] = useState("");
  const [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [dragging, setDragging] = useState(false),
    [draft, setDraft] = useState<string | null>(null),
    [reviewed, setReviewed] = useState<number[]>([]);
  const lock = useRef(false),
    request = useRef(0),
    input = useRef<HTMLInputElement>(null),
    search = useRef(props.onSearchSources);
  search.current = props.onSearchSources;
  const pending = homeInboxItems(props.pendingFacts || []).filter((item) => !reviewed.includes(item.id));
  const folder = folders.find((item) => item.id === folderId);
  useEffect(() => {
    let active = true;
    setSearchIds(null);
    if (!query.trim() || !search.current) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void search.current!(query)
        .then((results) => {
          if (active) setSearchIds(results.map((item) => item.id));
        })
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : "搜索失败");
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, sources]);
  useEffect(() => {
    setSelected((current) => current.filter((id) => sources.some((source) => source.id === id)));
  }, [sources]);
  const visible = sources
    .filter(
      (source) =>
        (category === "trash" ? Boolean(source.trashed_at) : !source.trashed_at) &&
        (category !== "favorites" || source.favorite) &&
        (category !== "recent" || source.last_opened_at) &&
        (!folderId || source.folder_id === folderId) &&
        (!query.trim() ||
          (searchIds
            ? searchIds.includes(source.id)
            : `${source.title} ${source.original_filename}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    )
    .sort(
      (a, b) =>
        (ascending ? 1 : -1) *
        ((category === "recent"
          ? (a.last_opened_at || "").localeCompare(b.last_opened_at || "")
          : a.updated_at.localeCompare(b.updated_at)) || a.id - b.id)
    );
  async function run(action: () => void | Promise<unknown>) {
    if (lock.current) return false;
    lock.current = true;
    setWorking(true);
    setError("");
    try {
      await action();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请重试");
      return false;
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }
  function closePreview() {
    request.current += 1;
    setPreview(null);
    setLoading(false);
    setFull(false);
    setDraft(null);
  }
  function choose(next: Category, id: number | null = null) {
    setCategory(next);
    setFolderId(id);
    setSelected([]);
    setQuery("");
    setMenu(null);
    closePreview();
  }
  async function open(id: number, complete = false) {
    const sequence = ++request.current;
    setLoading(true);
    setPreview(null);
    setFull(complete);
    setMode("original");
    setMenu(null);
    setError("");
    setDraft(null);
    try {
      const detail = await props.onLoadSource(id);
      if (sequence !== request.current) return;
      if (detail.trashed_at) throw new Error("请先恢复文件，再打开。");
      setPreview(detail);
      await props.onOrganizeSource?.(id, { opened: true });
    } catch (reason) {
      if (sequence === request.current) setError(reason instanceof Error ? reason.message : "读取文件失败");
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }
  async function reloadPreview(id: number) {
    const sequence = request.current;
    const detail = await props.onLoadSource(id);
    if (sequence === request.current) setPreview((current) => (current?.id === id ? detail : current));
  }
  function select(id: number, add = false) {
    setSelected((current) =>
      add ? (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) : [id]
    );
  }
  function show(kind: DialogKind, ids = selected) {
    setDialog({ kind, ids });
    setName(kind === "rename" ? sources.find((source) => source.id === ids[0])?.title || "" : "");
    setContent("");
    setTarget(folderId ? String(folderId) : "");
    setMenu(null);
  }
  async function organize(ids: number[], changes: LibraryOrganization) {
    if (!props.onOrganizeSource) throw new Error("文件管理接口不可用");
    for (const id of ids) await props.onOrganizeSource(id, changes);
  }
  async function download(ids: number[]) {
    for (const id of ids) await props.onDownloadSource(await props.onLoadSource(id));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dialog) return;
    const success = await run(async () => {
      if (dialog.kind === "folder") await props.onCreateFolder?.(name.trim());
      if (dialog.kind === "note") await props.onCreateText(name.trim() || "新建笔记", content, "redacted", folderId);
      if (dialog.kind === "rename") await props.onUpdateSource(dialog.ids[0], { title: name.trim() });
      if (dialog.kind === "move") await organize(dialog.ids, { folder_id: target ? Number(target) : null });
      if (dialog.kind === "trash") await organize(dialog.ids, { trashed: true });
      if (dialog.kind === "permanent")
        for (const id of dialog.ids) {
          await props.onDeleteSource(id);
          setDialog((current) => (current ? { ...current, ids: current.ids.filter((item) => item !== id) } : null));
          setSelected((current) => current.filter((item) => item !== id));
        }
    });
    if (success) {
      setDialog(null);
      setSelected([]);
      closePreview();
    }
  }
  const disabled = working || props.sourceBusy;
  const useChat = (ids: number[]) =>
    void run(async () => {
      if (!props.onUseForChat) throw new Error("对话入口不可用");
      await props.onUseForChat(ids);
    });
  const actions = (ids: number[], isTrash = false) => (
    <div className="fl-selection-actions">
      {isTrash ? (
        <>
          <Button
            label="恢复"
            icon={<RotateCcw size={17} />}
            disabled={working}
            action={() =>
              void run(async () => {
                await organize(ids, { trashed: false });
                setSelected([]);
              })
            }
          />
          <Button
            label="永久删除"
            icon={<Trash2 size={17} />}
            disabled={working}
            action={() => show("permanent", ids)}
          />
        </>
      ) : (
        <>
          <Button
            label="用于对话"
            primary
            icon={<Sparkles size={17} />}
            disabled={working}
            action={() => useChat(ids)}
          />
          <Button label="移动" icon={<Folder size={17} />} disabled={working} action={() => show("move", ids)} />
          <Button
            label="下载"
            icon={<Download size={17} />}
            disabled={working}
            action={() => void run(() => download(ids))}
          />
          <Button label="删除" icon={<Trash2 size={17} />} disabled={working} action={() => show("trash", ids)} />
        </>
      )}
      <button type="button" className="fl-icon-button" aria-label="取消选择" onClick={() => setSelected([])}>
        <X size={17} />
      </button>
    </div>
  );
  const viewer = preview && (
    <>
      <header className="fl-viewer-header">
        {full && <Button label="返回文件库" icon={<ArrowLeft size={19} />} action={closePreview} />}
        <FileTypeIcon source={preview} />
        <div>
          <h2 title={preview.title}>{preview.title}</h2>
          {!full && <small>{sizeLabel(preview)}</small>}
        </div>
        {full ? (
          <div className="fl-reader-actions">
            <Button
              label={sources.find((source) => source.id === preview.id)?.favorite ? "已收藏" : "收藏"}
              icon={<Star size={17} />}
              disabled={working}
              action={() =>
                void run(() =>
                  organize([preview.id], { favorite: !sources.find((source) => source.id === preview.id)?.favorite })
                )
              }
            />
            <Button
              label="下载"
              icon={<Download size={17} />}
              disabled={working}
              action={() => void run(() => download([preview.id]))}
            />
            <Button
              label="用于对话"
              primary
              icon={<Sparkles size={17} />}
              disabled={working || preview.parse_status !== "ready"}
              action={() => useChat([preview.id])}
            />
          </div>
        ) : (
          <button type="button" className="fl-icon-button" aria-label="关闭快速预览" onClick={closePreview}>
            <X size={20} />
          </button>
        )}
      </header>
      <nav className="fl-viewer-tabs" aria-label="文件内容">
        {(["original", "text"] as const).map((key) => (
          <button
            type="button"
            key={key}
            className={mode === key ? "active" : ""}
            onClick={() => {
              setMode(key);
              if (key === "original") setDraft(null);
            }}
          >
            {key === "original" ? "原文件" : "AI 读取内容"}
          </button>
        ))}
        <span>
          <Info size={15} />
          {preview.privacy_mode === "original" ? "模型使用原文" : "模型使用脱敏文本"}
        </span>
      </nav>
      {!full && (
        <small className="fl-privacy-hint">
          <Info size={14} />
          {preview.privacy_mode === "original" ? "模型使用原文" : "模型使用脱敏文本"}
        </small>
      )}
      <div className="fl-preview-scroll">
        {draft !== null ? (
          <label className="fl-text-page">
            编辑用于问答的文字
            <textarea aria-label="编辑资料正文" value={draft} onChange={(event) => setDraft(event.target.value)} />
          </label>
        ) : (
          <FilePreview source={preview} mode={mode} loadOriginal={props.onLoadOriginal} />
        )}
      </div>
      <footer className="fl-viewer-footer">
        <details>
          <summary>文件设置</summary>
          {(["privacy_mode", "enabled"] as const).map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={key === "privacy_mode" ? preview.privacy_mode === "original" : preview.enabled}
                disabled={working}
                onChange={(event) => {
                  const checked = event.target.checked;
                  void run(async () => {
                    await props.onUpdateSource(
                      preview.id,
                      key === "privacy_mode"
                        ? { privacy_mode: checked ? "original" : "redacted" }
                        : { enabled: checked }
                    );
                    await reloadPreview(preview.id);
                  });
                }}
              />
              {key === "privacy_mode" ? "允许模型使用原文" : "启用为资料依据"}
            </label>
          ))}
        </details>
        <div>
          {mode === "text" &&
            (draft === null ? (
              <Button label="编辑正文" action={() => setDraft(preview.content)} />
            ) : (
              <>
                <Button
                  label="保存正文"
                  primary
                  disabled={working || !draft.trim()}
                  action={() =>
                    void run(async () => {
                      await props.onUpdateSource(preview.id, { content: draft });
                      await reloadPreview(preview.id);
                      setDraft(null);
                    })
                  }
                />
                <Button label="取消" action={() => setDraft(null)} />
              </>
            ))}
          {!full && (
            <>
              <Button
                label="用于对话"
                primary
                icon={<Sparkles size={16} />}
                disabled={working || preview.parse_status !== "ready"}
                action={() => useChat([preview.id])}
              />
              <Button label="完整打开" icon={<Expand size={17} />} action={() => setFull(true)} />
            </>
          )}
        </div>
      </footer>
      {preview.metadata.content_edited ? (
        <small className="fl-original-note">正文已校正，原文件保持导入时版本。</small>
      ) : null}
    </>
  );
  return (
    <section
      className={`file-library ${full ? "fl-full" : ""}`}
      onClick={() => setMenu(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !dialog) closePreview();
      }}
    >
      {error && !dialog && (
        <p className="fl-error" role="alert">
          {error}
          <button type="button" aria-label="关闭文件错误" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </p>
      )}
      {full && (preview || loading) ? (
        <section className="fl-reader" aria-label="文件阅读器">
          {preview ? (
            viewer
          ) : (
            <p role="status" className="fl-empty">
              正在读取文件…
              <button type="button" onClick={closePreview}>
                返回文件库
              </button>
            </p>
          )}
        </section>
      ) : (
        <>
          <header className="fl-header">
            <h1>文件库</h1>
            <label className="fl-search">
              <Search size={20} />
              <input
                aria-label="搜索文件名或内容"
                placeholder="搜索文件名或内容"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected([]);
                }}
              />
              {query && (
                <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>
                  <X size={17} />
                </button>
              )}
            </label>
            <div className="fl-header-actions">
              <div className="fl-menu-wrap">
                <button
                  type="button"
                  className="fl-button"
                  aria-expanded={menu === "new"}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenu(menu === "new" ? null : "new");
                  }}
                >
                  <Plus size={18} />
                  新建
                  <ChevronDown size={16} />
                </button>
                {menu === "new" && (
                  <div className="fl-menu">
                    <button type="button" disabled={!props.onCreateFolder} onClick={() => show("folder")}>
                      <Folder size={16} />
                      新建文件夹
                    </button>
                    <button type="button" onClick={() => show("note")}>
                      <Pencil size={16} />
                      新建笔记
                    </button>
                  </div>
                )}
              </div>
              <Button
                label="上传文件"
                primary
                icon={props.sourceBusy ? <LoaderCircle className="spinning" size={18} /> : <Upload size={18} />}
                disabled={disabled}
                action={() => input.current?.click()}
              />
            </div>
            <input
              ref={input}
              className="fl-hidden"
              type="file"
              aria-label="选择上传文件"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md"
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                void run(() => props.onImportFiles(files, folderId));
              }}
            />
          </header>
          <div className={`fl-body ${preview || loading ? "with-preview" : ""}`}>
            <section
              className="fl-browser"
              onDragOver={(event) => {
                if (!disabled && category !== "trash") {
                  event.preventDefault();
                  setDragging(true);
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!disabled && category !== "trash")
                  void run(() => props.onImportFiles(Array.from(event.dataTransfer.files), folderId));
              }}
            >
              <div className="fl-module-navigation">
                <nav aria-label="文件分类">
                  {categories.map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      className={category === key ? "active" : ""}
                      aria-current={category === key ? "page" : undefined}
                      onClick={() => choose(key)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                <div>
                  {[
                    ["列表视图", <List size={19} />, () => setGrid(false), !grid],
                    ["网格视图", <LayoutGrid size={18} />, () => setGrid(true), grid],
                    ["知识与个性化", <Settings size={18} />, () => show("preferences"), false]
                  ].map(([label, icon, action, active]) => (
                    <button
                      type="button"
                      key={String(label)}
                      className={`fl-icon-button ${active ? "active" : ""}`}
                      aria-label={String(label)}
                      onClick={action as () => void}
                    >
                      {icon as ReactNode}
                    </button>
                  ))}
                </div>
              </div>
              {folder ? (
                <div className="fl-breadcrumb">
                  <button type="button" onClick={() => choose("all")}>
                    全部文件
                  </button>
                  <span>/ {folder.name}</span>
                </div>
              ) : category === "all" && !query && folders.length > 0 ? (
                <section className="fl-folders">
                  <h2>文件夹</h2>
                  <div>
                    {folders.map((item) => (
                      <button type="button" key={item.id} onClick={() => choose("all", item.id)}>
                        <Folder size={29} />
                        <span>{item.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              <div className="fl-files-heading">
                {selected.length ? (
                  <>
                    <span>已选 {selected.length} 个文件</span>
                    {actions(selected, category === "trash")}
                  </>
                ) : (
                  <>
                    <div>
                      <h2>{query ? "搜索结果" : category === "trash" ? "已删除文件" : "文件"}</h2>
                      <span>{visible.length} 个文件</span>
                      {searching && <small role="status">搜索中…</small>}
                    </div>
                    <button
                      type="button"
                      className="fl-sort"
                      aria-label="切换修改时间排序"
                      onClick={() => setAscending(!ascending)}
                    >
                      <ArrowDownUp size={17} />
                      修改时间
                      <ChevronDown size={15} />
                    </button>
                  </>
                )}
              </div>
              {!visible.length ? (
                <div className="fl-empty">
                  <Folder size={36} />
                  <h3>
                    {query
                      ? "没有找到匹配的文件"
                      : category === "trash"
                        ? "回收站是空的"
                        : category === "favorites"
                          ? "还没有收藏的文件"
                          : category === "recent"
                            ? "还没有最近打开的文件"
                            : "这里还没有文件"}
                  </h3>
                  <p>
                    {category === "trash" ? "删除的文件会在这里保留，可以恢复。" : "上传文件或新建笔记，开始整理资料。"}
                  </p>
                </div>
              ) : (
                <table className={`fl-table ${grid ? "fl-grid" : ""}`} aria-label="文件列表">
                  <thead>
                    <tr>
                      <th className="fl-check">
                        <input
                          type="checkbox"
                          aria-label="选择当前全部文件"
                          checked={visible.every((source) => selected.includes(source.id))}
                          onChange={(event) =>
                            setSelected(event.target.checked ? visible.map((source) => source.id) : [])
                          }
                        />
                      </th>
                      <th>名称</th>
                      <th className="fl-size">大小</th>
                      <th className="fl-date">修改时间</th>
                      <th className="fl-actions">
                        <span className="fl-hidden">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((source) => (
                      <tr
                        key={source.id}
                        tabIndex={0}
                        aria-selected={selected.includes(source.id)}
                        className={selected.includes(source.id) ? "selected" : ""}
                        onClick={(event) => select(source.id, event.metaKey || event.ctrlKey)}
                        onDoubleClick={() => category !== "trash" && void open(source.id, true)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget || category === "trash") return;
                          if (event.key === "Enter" || event.code === "Space") {
                            event.preventDefault();
                            select(source.id);
                            void open(source.id, event.key === "Enter");
                          }
                        }}
                      >
                        <td className="fl-check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`选择 ${source.title}`}
                            checked={selected.includes(source.id)}
                            onChange={() => select(source.id, true)}
                          />
                        </td>
                        <td>
                          <div className="fl-filename">
                            <FileTypeIcon source={source} />
                            <div>
                              <strong title={source.original_filename || source.title}>{source.title}</strong>
                              <small>
                                {source.parse_status !== "ready"
                                  ? "暂无提取文字"
                                  : !source.enabled
                                    ? "已停用"
                                    : source.original_filename || "文本笔记"}
                              </small>
                            </div>
                            {source.favorite && <Star size={14} className="fl-favorite" fill="currentColor" />}
                          </div>
                        </td>
                        <td className="fl-size">{sizeLabel(source)}</td>
                        <td className="fl-date" title={source.updated_at}>
                          {dateLabel(source.updated_at)}
                        </td>
                        <td className="fl-actions" onClick={(event) => event.stopPropagation()}>
                          {category === "trash" ? (
                            <button
                              type="button"
                              className="fl-icon-button"
                              aria-label={`恢复 ${source.title}`}
                              disabled={working}
                              onClick={() => void run(() => organize([source.id], { trashed: false }))}
                            >
                              <RotateCcw size={17} />
                            </button>
                          ) : (
                            <div className="fl-menu-wrap">
                              <button
                                type="button"
                                className="fl-icon-button"
                                aria-label={`操作 ${source.title}`}
                                aria-expanded={menu === source.id}
                                onClick={() => setMenu(menu === source.id ? null : source.id)}
                              >
                                <MoreHorizontal size={20} />
                              </button>
                              {menu === source.id && (
                                <div className="fl-menu">
                                  {[
                                    "快速预览",
                                    "完整打开",
                                    source.favorite ? "取消收藏" : "收藏",
                                    "重命名",
                                    "移动",
                                    "下载",
                                    "移入回收站"
                                  ].map((label) => (
                                    <button
                                      type="button"
                                      key={label}
                                      disabled={working}
                                      onClick={() => {
                                        setMenu(null);
                                        if (label === "快速预览" || label === "完整打开")
                                          void open(source.id, label === "完整打开");
                                        else if (label.includes("收藏"))
                                          void run(() => organize([source.id], { favorite: !source.favorite }));
                                        else if (label === "下载") void run(() => download([source.id]));
                                        else
                                          show(label === "重命名" ? "rename" : label === "移动" ? "move" : "trash", [
                                            source.id
                                          ]);
                                      }}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <footer className="fl-browser-footer">
                <span>{visible.length} 个文件</span>
                <span>
                  <Info size={16} />
                  选中文件，按空格快速预览
                </span>
              </footer>
              {dragging && (
                <div className="fl-drop">
                  <Upload size={38} />
                  松开即可添加文件
                </div>
              )}
            </section>
            {preview || loading ? (
              <aside className="fl-preview" aria-label="文件快速预览">
                {preview ? (
                  viewer
                ) : (
                  <div className="fl-empty" role="status">
                    正在读取文件…
                    <button type="button" onClick={closePreview}>
                      取消
                    </button>
                  </div>
                )}
              </aside>
            ) : null}
          </div>
        </>
      )}
      {dialog && (
        <LibraryDialog title={titles[dialog.kind]} close={() => !working && setDialog(null)}>
          {error && (
            <p className="fl-dialog-error" role="alert">
              {error}
            </p>
          )}
          {dialog.kind === "preferences" ? (
            <div className="fl-preferences">
              <label>
                称呼（可选）
                <input
                  aria-label="称呼"
                  value={editor.name}
                  onChange={(event) => props.onChange({ ...editor, name: event.target.value })}
                />
              </label>
              <Button
                label="保存个性化信息"
                disabled={working || props.busy}
                action={() =>
                  void run(async () => {
                    if ((await props.onSave()) === false) throw new Error("保存失败，请重试");
                  })
                }
              />
              <label>
                <input
                  type="checkbox"
                  checked={props.enhancedParse}
                  onChange={(event) => props.onEnhancedParseChange(event.target.checked)}
                />
                复杂排版解析
              </label>
              <h3>待确认内容</h3>
              {pending.length ? (
                <ul aria-label="待确认内容">
                  {pending.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <p>{item.consequence}</p>
                      {item.source && <blockquote>{item.source}</blockquote>}
                      {(["confirm", "reject"] as const).map((action) => (
                        <Button
                          key={action}
                          label={action === "confirm" ? "确认" : "不是"}
                          disabled={working || !props.onReviewFact}
                          action={() =>
                            void run(async () => {
                              await props.onReviewFact?.(item.id, action);
                              setReviewed((current) => [...current, item.id]);
                            })
                          }
                        />
                      ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>暂无待确认内容。</p>
              )}
            </div>
          ) : (
            <form onSubmit={(event) => void save(event)}>
              {["folder", "note", "rename"].includes(dialog.kind) && (
                <label className="fl-field">
                  {dialog.kind === "folder" ? "文件夹名称" : "文件名称"}
                  <input
                    aria-label={dialog.kind === "folder" ? "文件夹名称" : "文件名称"}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={180}
                  />
                </label>
              )}
              {dialog.kind === "note" && (
                <label className="fl-field">
                  笔记内容
                  <textarea
                    aria-label="笔记内容"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    required
                    rows={7}
                  />
                </label>
              )}
              {dialog.kind === "move" && (
                <label className="fl-field">
                  移动到
                  <select aria-label="目标文件夹" value={target} onChange={(event) => setTarget(event.target.value)}>
                    <option value="">全部文件（根目录）</option>
                    {folders.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {dialog.kind === "trash" && (
                <p>将 {dialog.ids.length} 个文件移入回收站，可以恢复。回收站文件不再作为资料依据。</p>
              )}
              {dialog.kind === "permanent" && <p>永久删除 {dialog.ids.length} 个文件及原件？此操作无法恢复。</p>}
              <footer>
                <Button label="取消" disabled={working} action={() => setDialog(null)} />
                <button
                  type="submit"
                  className={`fl-button ${dialog.kind === "permanent" ? "danger" : "primary"}`}
                  disabled={working}
                >
                  {working
                    ? "处理中…"
                    : dialog.kind === "folder"
                      ? "创建"
                      : dialog.kind === "note"
                        ? "创建笔记"
                        : dialog.kind === "rename"
                          ? "保存"
                          : titles[dialog.kind]}
                </button>
              </footer>
            </form>
          )}
        </LibraryDialog>
      )}
    </section>
  );
}
