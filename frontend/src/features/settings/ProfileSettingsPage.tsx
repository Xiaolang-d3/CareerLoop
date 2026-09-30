import {
  Eye, FileText, Layers3, LoaderCircle, Pencil, Save,
  ShieldCheck, Trash2, Upload, UserRound
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CandidateEditor, LibrarySource, LibrarySourceDetail } from "../../types";
import { ActionButton } from "../../components/ui/ActionButton";
import { HOME_INBOX_LIMIT, homeInboxItems, type HomePendingFact } from "../home/home-metrics";

const EMPTY_PENDING_FACTS: HomePendingFact[] = [];

type Props = {
  editor: CandidateEditor;
  sources: LibrarySource[];
  busy: boolean;
  sourceBusy: boolean;
  enhancedParse: boolean;
  pendingFacts?: HomePendingFact[];
  onChange: (editor: CandidateEditor) => void;
  onEnhancedParseChange: (enabled: boolean) => void;
  onImportFiles: (files: File[]) => void | Promise<void>;
  onCreateText: (title: string, content: string, privacyMode: "redacted" | "original") => void | Promise<void>;
  onLoadSource: (sourceId: number) => Promise<LibrarySourceDetail>;
  onUpdateSource: (sourceId: number, changes: Partial<Pick<LibrarySource, "title" | "privacy_mode" | "enabled">> & { content?: string }) => void | Promise<void>;
  onDownloadSource: (source: LibrarySourceDetail) => void | Promise<void>;
  onDeleteSource: (sourceId: number) => void | Promise<void>;
  onReviewFact?: (factId: number, action: "confirm" | "reject") => void | Promise<void>;
  onSave: () => void | boolean | Promise<void | boolean>;
};

export function ProfileSettingsPage({
  editor, sources, busy, sourceBusy, enhancedParse, pendingFacts = EMPTY_PENDING_FACTS,
  onChange, onEnhancedParseChange, onImportFiles, onCreateText,
  onLoadSource, onUpdateSource, onDownloadSource, onDeleteSource, onReviewFact, onSave
}: Props) {
  const [nameDirty, setNameDirty] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [pastePrivacy, setPastePrivacy] = useState<"redacted" | "original">("redacted");
  const [selectedSource, setSelectedSource] = useState<LibrarySourceDetail | null>(null);
  const [contentDraft, setContentDraft] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [reviewFacts, setReviewFacts] = useState(pendingFacts);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const operationLock = useRef(false);

  useEffect(() => {
    setReviewFacts(pendingFacts);
    setReviewExpanded(false);
  }, [pendingFacts]);

  const reviewableFacts = homeInboxItems(reviewFacts, { resumeText: "", knownSkills: [] });
  const visibleReviewFacts = reviewExpanded ? reviewableFacts : reviewableFacts.slice(0, HOME_INBOX_LIMIT);

  async function runOperation(action: () => void | Promise<void>, fallback: string) {
    if (operationLock.current) return false;
    operationLock.current = true;
    setOperationBusy(true);
    setOperationError("");
    try {
      await action();
      return true;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : fallback);
      return false;
    } finally {
      operationLock.current = false;
      setOperationBusy(false);
    }
  }

  async function saveName() {
    const saved = await runOperation(async () => {
      const result = await onSave();
      if (result === false) throw new Error("保存失败，修改已保留，请重试。");
    }, "保存失败，修改已保留，请重试。");
    if (saved) setNameDirty(false);
  }

  async function createTextSource() {
    if (!pasteContent.trim()) {
      setOperationError("请先输入要保存的文本内容");
      return;
    }
    const created = await runOperation(
      () => onCreateText(pasteTitle.trim() || "粘贴文本", pasteContent, pastePrivacy),
      "创建文本来源失败"
    );
    if (created) {
      setPasteTitle("");
      setPasteContent("");
      setPasteOpen(false);
    }
  }

  async function previewSource(sourceId: number) {
    await runOperation(async () => {
      setSelectedSource(await onLoadSource(sourceId));
      setContentDraft(null);
    }, "读取来源失败");
  }

  async function saveSourceContent() {
    if (!selectedSource || contentDraft === null) return;
    if (!contentDraft.trim()) {
      setOperationError("资料内容不能为空");
      return;
    }
    const saved = await runOperation(async () => {
      await onUpdateSource(selectedSource.id, { content: contentDraft });
      setSelectedSource(await onLoadSource(selectedSource.id));
    }, "更新资料内容失败");
    if (saved) setContentDraft(null);
  }

  async function reviewFact(factId: number, action: "confirm" | "reject") {
    if (!onReviewFact) return;
    const done = await runOperation(() => onReviewFact(factId, action), "确认操作失败，内容已保留，请重试。");
    if (done) setReviewFacts((current) => current.filter((item) => item.id !== factId));
  }

  return <section className="profile-settings-page profile-simplified-page">
    <header className="profile-page-heading">
      <div><span className="ui-eyebrow">知识与来源</span><h2>我的知识库</h2><p>每个文件都是独立来源，可单独预览、停用、脱敏或删除。</p></div>
      <div className="profile-heading-actions">
        <span className={`profile-status ${sources.length ? "ready" : "pending"}`}><i />{sources.length ? `${sources.length} 个来源` : "待导入材料"}</span>
      </div>
    </header>

    <nav className="profile-library-index" aria-label="资料库内容">
      <button type="button" onClick={() => document.getElementById("library-sources")?.scrollIntoView({ behavior: "smooth" })}><FileText size={16} /><span><strong>来源材料</strong><small>{sources.length ? `${sources.length} 个` : "待导入"}</small></span></button>
      <button type="button" onClick={() => document.getElementById("library-organized")?.scrollIntoView({ behavior: "smooth" })}><Layers3 size={16} /><span><strong>已整理内容</strong><small>{reviewableFacts.length ? `${reviewableFacts.length} 条待确认` : "暂无待确认"}</small></span></button>
      <button type="button" onClick={() => document.getElementById("library-profile")?.scrollIntoView({ behavior: "smooth" })}><UserRound size={16} /><span><strong>个性化</strong><small>{editor.name.trim() || "可选"}</small></span></button>
    </nav>

    <section className="profile-linear-layout">
      <section id="library-sources" className="profile-resume-workspace">
        <header className="profile-resume-workspace-heading">
          <div className="profile-foundation-heading"><span><FileText size={18} /></span><div><h3>来源材料</h3><p>支持一次导入多个文件；不会再拼接或覆盖已有内容。</p></div></div>
          <div className="profile-resume-heading-actions">
            <label className={`profile-resume-trigger ${sourceBusy ? "busy" : ""}`}>{sourceBusy ? <LoaderCircle className="spinning" size={14} /> : <Upload size={14} />}导入文件<input aria-label="导入文件" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md" disabled={sourceBusy || operationBusy} onChange={(event) => { void onImportFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /></label>
            <button type="button" className="profile-resume-trigger" onClick={() => setPasteOpen((value) => !value)}><Pencil size={14} />粘贴文本</button>
          </div>
        </header>

        <label className="profile-parse-option"><input type="checkbox" checked={enhancedParse} onChange={(event) => onEnhancedParseChange(event.target.checked)} /><span>复杂排版解析</span></label>

        {pasteOpen ? <div className="profile-source-paste" aria-label="新建文本来源">
          <input aria-label="来源标题" value={pasteTitle} placeholder="来源标题（可选）" onChange={(event) => setPasteTitle(event.target.value)} />
          <textarea aria-label="来源内容" value={pasteContent} placeholder="粘贴笔记、文章、会议记录等文本…" onChange={(event) => setPasteContent(event.target.value)} />
          <footer><label className="agent-privacy-choice"><input type="checkbox" checked={pastePrivacy === "original"} onChange={(event) => setPastePrivacy(event.target.checked ? "original" : "redacted")} /><span>允许模型使用原文</span><small>默认只使用脱敏文本</small></label><ActionButton variant="primary" type="button" disabled={operationBusy} onClick={() => void createTextSource()}>创建来源</ActionButton></footer>
        </div> : null}

        {sources.length ? <ul className="profile-source-list" aria-label="资料来源列表">
          {sources.map((source) => <li key={source.id} className={!source.enabled ? "is-disabled" : ""}>
            <div className="profile-source-icon"><FileText size={18} /></div>
            <div className="profile-source-main">
              {editingTitleId === source.id ? <div className="profile-source-title-editor"><input aria-label={`重命名 ${source.title}`} value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} /><button type="button" onClick={() => void runOperation(async () => { await onUpdateSource(source.id, { title: editingTitle }); setEditingTitleId(null); }, "重命名失败")}>保存</button></div> : <strong>{source.title}</strong>}
              <span>{source.original_filename || (source.source_kind === "legacy" ? "历史资料" : "粘贴文本")} · {source.character_count.toLocaleString()} 字 · {source.parse_status === "ready" ? "已就绪" : source.parse_status}</span>
            </div>
            <div className="profile-source-actions">
              <button type="button" aria-label={`预览 ${source.title}`} onClick={() => void previewSource(source.id)}><Eye size={14} />预览</button>
              <button type="button" aria-label={`重命名 ${source.title}`} onClick={() => { setEditingTitleId(source.id); setEditingTitle(source.title); }}><Pencil size={14} /></button>
              <label><input type="checkbox" checked={source.privacy_mode === "original"} onChange={(event) => void runOperation(() => onUpdateSource(source.id, { privacy_mode: event.target.checked ? "original" : "redacted" }), "隐私模式更新失败")} />原文</label>
              <label><input type="checkbox" checked={source.enabled} onChange={(event) => void runOperation(() => onUpdateSource(source.id, { enabled: event.target.checked }), "来源状态更新失败")} />启用</label>
              <button type="button" className="is-danger" aria-label={`删除 ${source.title}`} onClick={() => { if (window.confirm(`永久删除“${source.title}”及其本地原文件？`)) void runOperation(() => onDeleteSource(source.id), "删除来源失败"); }}><Trash2 size={14} /></button>
            </div>
          </li>)}
        </ul> : <div className="profile-resume-empty"><p>还没有来源。导入文件或粘贴文本后即可开始知识库问答。</p></div>}
        <footer className="profile-resume-workspace-footer"><small className="profile-data-note">原文件仅保存在当前本地账户工作区；删除来源时同步删除原文件与索引。</small></footer>
      </section>

      {selectedSource ? <section className="profile-source-preview" aria-label="来源预览">
        <header><div><strong>{selectedSource.title}</strong><span>{selectedSource.privacy_mode === "original" ? "模型可使用原文" : "模型仅使用脱敏文本"}</span></div><button type="button" onClick={() => { setSelectedSource(null); setContentDraft(null); }}>关闭</button></header>
        {contentDraft === null ? <pre>{selectedSource.content}</pre> : <label className="profile-source-content-editor"><span>编辑用于问答的文字</span><textarea aria-label="编辑资料正文" value={contentDraft} onChange={(event) => setContentDraft(event.target.value)} /></label>}
        {selectedSource.source_kind === "upload" ? <small className="profile-source-original-note">{selectedSource.metadata.content_edited ? "正文已校正；原文件仍保留导入时的版本。" : "校正正文不会修改原文件。"}</small> : null}
        <footer className="profile-source-preview-actions">
          {contentDraft === null ? <button type="button" disabled={operationBusy} onClick={() => setContentDraft(selectedSource.content)}>编辑正文</button> : <><button type="button" disabled={operationBusy || !contentDraft.trim()} onClick={() => void saveSourceContent()}>保存正文</button><button type="button" disabled={operationBusy} onClick={() => setContentDraft(null)}>取消</button></>}
          {selectedSource.file_available ? <button type="button" disabled={operationBusy} onClick={() => void runOperation(() => onDownloadSource(selectedSource), "下载原文件失败")}>下载原文件</button> : null}
        </footer>
      </section> : null}

      <section id="library-organized" className="profile-organized-card">
        <header className="profile-foundation-heading"><span><Layers3 size={18} /></span><div><h3>已整理内容</h3><p>对话中提出的新知识需要你确认后，才会加入可信资料。</p></div></header>
        {reviewableFacts.length ? <section className="profile-review-queue" aria-label="待确认内容"><ul>{visibleReviewFacts.map((item) => <li key={item.id}><div><strong>{item.title}</strong><p>{item.consequence}</p>{item.source ? <blockquote><cite>{item.sourceLabel}</cite>{item.source}</blockquote> : null}</div><div className="profile-review-actions"><button type="button" disabled={operationBusy || !onReviewFact} onClick={() => void reviewFact(item.id, "confirm")}>确认</button><button type="button" className="is-quiet" disabled={operationBusy || !onReviewFact} onClick={() => void reviewFact(item.id, "reject")}>不是</button></div></li>)}</ul>{visibleReviewFacts.length < reviewableFacts.length ? <button type="button" className="profile-review-more" onClick={() => setReviewExpanded(true)}>查看其余 {reviewableFacts.length - visibleReviewFacts.length} 条</button> : null}</section> : <p className="profile-organized-empty">暂无待确认内容。你可以在对话中要求记录知识。</p>}
      </section>

      <section id="library-profile" className="profile-foundation-card">
        <header className="profile-foundation-heading"><span><UserRound size={18} /></span><div><h3>个性化信息</h3><p>称呼是可选项，不会阻止导入或保存资料。</p></div></header>
        <div className="candidate-form profile-foundation-form"><label><span>称呼 <em>可选</em></span><input value={editor.name} placeholder="例如：小林" onChange={(event) => { setNameDirty(true); onChange({ ...editor, name: event.target.value }); }} /></label></div>
        {nameDirty ? <footer className="profile-inline-save"><ActionButton variant="primary" type="button" onClick={() => void saveName()} disabled={busy || operationBusy}>{busy || operationBusy ? <LoaderCircle className="spinning" size={15} /> : <Save size={15} />}保存个性化信息</ActionButton></footer> : null}
      </section>
    </section>

    {operationError ? <p role="alert">{operationError}</p> : null}
    <p className="profile-local-security"><ShieldCheck size={14} />资料默认脱敏进入模型上下文，原文模式需逐个来源开启。</p>
  </section>;
}
