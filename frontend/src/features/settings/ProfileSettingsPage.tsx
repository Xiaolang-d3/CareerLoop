import {
  ArrowLeft,
  FileText,
  Layers3,
  LoaderCircle,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CandidateEditor, ResumeProfileSuggestion } from "../../types";
import { ActionButton } from "../../components/ui/ActionButton";
import { HOME_INBOX_LIMIT, homeInboxItems, homeSkillTags, type HomePendingFact } from "../home/home-metrics";
import { parseResumePreview, projectOrdinalLabel, skillTags, type ResumePreviewSection } from "./resume-preview";

type PrivacyFinding = { entity_type: string; preview: string };
const EMPTY_PENDING_FACTS: HomePendingFact[] = [];

function editorSnapshot(editor: CandidateEditor) {
  return JSON.stringify({
    name: editor.name,
    targetRole: editor.targetRole,
    targetCity: editor.targetCity,
    salaryMin: editor.salaryMin,
    salaryMax: editor.salaryMax,
    skills: editor.skills,
    industries: editor.industries,
    blockedKeywords: editor.blockedKeywords,
    blockedCompanies: editor.blockedCompanies,
    resumeText: editor.resumeText,
    resumeFilename: editor.resumeFilename,
    privacyMode: editor.privacyMode,
  });
}

type Props = {
  apiBase: string;
  editor: CandidateEditor;
  busy: boolean;
  resumeBusy: boolean;
  enhancedParse: boolean;
  privacyFindings: PrivacyFinding[];
  suggestion: ResumeProfileSuggestion | null;
  pendingFacts?: HomePendingFact[];
  returnToWorkbench: boolean;
  onChange: (editor: CandidateEditor) => void;
  onEnhancedParseChange: (enabled: boolean) => void;
  onParseFiles: (files: File[]) => void;
  onScanPrivacy: () => void;
  onFillSuggestion: () => void;
  onReviewFact?: (factId: number, action: "confirm" | "reject") => void | Promise<void>;
  onCareerChange: () => void | Promise<void>;
  onClearResume: () => void;
  onSave: () => void | Promise<void>;
  onReturnToWorkbench: () => void;
};

function ResumePreview({ editor, sections }: { editor: CandidateEditor; sections: ResumePreviewSection[] }) {
  return (
    <div className="profile-resume-preview" aria-label="简历预览">
      <header className="resume-preview-profile">
        <div>
          <strong>{editor.name || "我的简历"}</strong>
          <span>{[editor.targetRole, editor.targetCity].filter(Boolean).join(" · ") || "补充准备方向和意向城市"}</span>
        </div>
        <span>{editor.resumeText.length.toLocaleString()} 字</span>
      </header>
      <div className="resume-preview-sections">
        {sections.map((section) => (
          <section key={section.kind} className={`resume-preview-section ${section.kind}`}>
            <h4>{section.label}</h4>
            {section.kind === "skills" ? (
              <div className="resume-skill-tags">
                {skillTags(section.entries).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}
              </div>
            ) : (
              <div className="resume-preview-entry-list">
                {section.entries.map((entry, index) => (
                  <article key={`${section.kind}-${index}`}>
                    {section.kind === "projects" && section.entries.length > 1 ? (
                      <span className="resume-preview-kicker">{projectOrdinalLabel(index)}</span>
                    ) : null}
                    <strong>{entry[0]}</strong>
                    {entry.slice(1).map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}
                  </article>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

export function ProfileSettingsPage({
  editor,
  busy,
  resumeBusy,
  enhancedParse,
  privacyFindings,
  suggestion,
  pendingFacts = EMPTY_PENDING_FACTS,
  returnToWorkbench,
  onChange,
  onEnhancedParseChange,
  onParseFiles,
  onScanPrivacy,
  onFillSuggestion,
  onReviewFact,
  onClearResume,
  onSave,
  onReturnToWorkbench
}: Props) {
  const ready = Boolean(editor.name.trim());
  const hasResume = Boolean(editor.resumeText.trim());
  const [showResumeImport, setShowResumeImport] = useState(!hasResume);
  const [resumeView, setResumeView] = useState<"preview" | "edit">("preview");
  const [isEdited, setIsEdited] = useState(false);
  const [reviewFacts, setReviewFacts] = useState(pendingFacts);
  const [reviewingFactId, setReviewingFactId] = useState<number | null>(null);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const savedEditor = useRef(editorSnapshot(editor));
  const resumeSections = useMemo(() => parseResumePreview(editor.resumeText), [editor.resumeText]);
  const organizedItemCount = resumeSections.reduce((total, section) => total + section.entries.length, 0);
  const organizedSkills = useMemo(() => resumeSections
    .filter((section) => section.kind === "skills")
    .flatMap((section) => skillTags(section.entries))
    .slice(0, 8), [resumeSections]);
  const reviewableFacts = useMemo(() => homeInboxItems(reviewFacts, {
    resumeText: editor.resumeText,
    knownSkills: homeSkillTags(editor.skills)
  }), [editor.resumeText, editor.skills, reviewFacts]);
  const visibleReviewFacts = reviewExpanded ? reviewableFacts : reviewableFacts.slice(0, HOME_INBOX_LIMIT);
  const hiddenReviewCount = Math.max(0, reviewableFacts.length - visibleReviewFacts.length);
  const hasUnsavedChanges = isEdited || savedEditor.current !== editorSnapshot(editor);

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function reviewFact(factId: number, action: "confirm" | "reject") {
    setReviewingFactId(factId);
    try {
      await onReviewFact?.(factId, action);
      setReviewFacts((current) => current.filter((item) => item.id !== factId));
    } finally {
      setReviewingFactId(null);
    }
  }

  useEffect(() => {
    setShowResumeImport(!hasResume);
  }, [hasResume]);

  useEffect(() => {
    setReviewFacts(pendingFacts);
    setReviewExpanded(false);
  }, [pendingFacts]);

  async function saveChanges() {
    await onSave();
    savedEditor.current = editorSnapshot(editor);
    setIsEdited(false);
  }

  function updateEditor(nextEditor: CandidateEditor) {
    setIsEdited(true);
    onChange(nextEditor);
  }

  const informationCard = <article id="library-profile" className="profile-foundation-card">
    <header className="profile-foundation-heading"><span><UserRound size={18} /></span><div><h3>基本资料</h3><p>维护称呼和长期使用的基础信息。</p></div></header>
    <div className="candidate-form profile-foundation-form">
      <label><span>称呼 <em className="required-mark">必填</em></span><input required value={editor.name} placeholder="例如：小林" onChange={(event) => updateEditor({ ...editor, name: event.target.value })} /></label>
      <label><span>准备方向</span><input value={editor.targetRole} placeholder="例如：AI 应用开发工程师" onChange={(event) => updateEditor({ ...editor, targetRole: event.target.value })} /></label>
      <label className="wide-field"><span>意向城市 <small>可选</small></span><input value={editor.targetCity} placeholder="例如：上海、杭州" onChange={(event) => updateEditor({ ...editor, targetCity: event.target.value })} /></label>
    </div>
  </article>;

  const resumeWorkspace = <section id="resume-upload" className={`profile-resume-workspace ${hasResume ? "has-resume" : "is-empty"}`}>
    <header className="profile-resume-workspace-heading">
      <div className="profile-foundation-heading"><span><FileText size={18} /></span><div><h3>来源材料</h3><p>{hasResume ? editor.resumeFilename || "已导入一份文本材料" : "导入材料后自动整理可复用信息。"}</p></div></div>
      {hasResume ? <div className="profile-resume-heading-actions">
        {!showResumeImport ? <button type="button" className="profile-resume-trigger" onClick={() => setShowResumeImport(true)}><Upload size={14} />重新导入</button> : null}
        <button type="button" className="profile-privacy-check" onClick={onScanPrivacy} disabled={resumeBusy}><ShieldCheck size={14} />检查隐私</button>
      </div> : null}
    </header>

    {showResumeImport ? <div className="profile-resume-import">
      <label className={`profile-resume-action ${resumeBusy ? "busy" : ""}`}>
        {resumeBusy ? <LoaderCircle className="spinning" size={18} /> : <Upload size={18} />}
        <span>{resumeBusy ? "正在整理…" : hasResume ? "上传新材料" : "导入材料"}</span>
        <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md" disabled={resumeBusy} onChange={(event) => { onParseFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
      </label>
      <label className="profile-parse-option"><input type="checkbox" checked={enhancedParse} onChange={(event) => onEnhancedParseChange(event.target.checked)} /><span>复杂排版</span></label>
    </div> : null}

    {hasResume ? <section className="profile-resume-editor">
      <header><h3>{resumeView === "preview" ? "材料预览" : "编辑原文"}</h3><div className="profile-resume-view-switch" role="tablist" aria-label="材料视图"><button type="button" role="tab" aria-selected={resumeView === "preview"} className={resumeView === "preview" ? "active" : ""} onClick={() => setResumeView("preview")}>预览</button><button type="button" role="tab" aria-selected={resumeView === "edit"} className={resumeView === "edit" ? "active" : ""} onClick={() => setResumeView("edit")}>编辑原文</button></div></header>
      {resumeView === "preview" ? <ResumePreview editor={editor} sections={resumeSections} /> : <><textarea value={editor.resumeText} aria-label="简历内容" placeholder="上传简历或直接粘贴简历文本。" onChange={(event) => updateEditor({ ...editor, resumeText: event.target.value, resumeRedactedText: "" })} />
        {suggestion && (suggestion.name || suggestion.target_roles.length || suggestion.target_cities.length) ? <div className="profile-fill-suggestion"><WandSparkles size={17} /><div><strong>可补充的信息</strong><span>{[suggestion.name ? `称呼：${suggestion.name}` : "", suggestion.target_roles.length ? `准备方向：${suggestion.target_roles.join("、")}` : "", suggestion.target_cities.length ? `意向城市：${suggestion.target_cities.join("、")}` : ""].filter(Boolean).join("；")}</span></div><button type="button" onClick={onFillSuggestion}>填充</button></div> : null}</>}
      <footer><label className="agent-privacy-choice"><input type="checkbox" checked={editor.privacyMode === "original"} onChange={(event) => updateEditor({ ...editor, privacyMode: event.target.checked ? "original" : "redacted" })} /><span>允许使用简历原文优化内容</span><small>关闭时会隐藏常见隐私信息</small></label><button type="button" className="clear-resume-button" onClick={() => { setIsEdited(true); onClearResume(); }}><Trash2 size={13} />清除</button></footer>
    </section> : <div className="profile-resume-empty"><p>支持 PDF、Word、文本或图片格式。</p><details className="profile-paste-details"><summary>直接粘贴简历文本</summary><textarea aria-label="简历内容" placeholder="粘贴简历文本…" onChange={(event) => updateEditor({ ...editor, resumeText: event.target.value, resumeRedactedText: "" })} /></details></div>}

    <footer className="profile-resume-workspace-footer"><small className="profile-data-note">材料只用于你的搜索、分析和内容生成，不会自行对外发送。</small>{privacyFindings.length ? <div className="privacy-result"><ShieldCheck size={16} /><div><strong>检测到 {privacyFindings.length} 处敏感信息</strong><span>{privacyFindings.slice(0, 3).map((item) => item.preview).join("、")}；默认不会用于生成内容。</span></div></div> : null}</footer>
  </section>;

  const organizedContent = <section id="library-organized" className="profile-organized-card">
    <header className="profile-foundation-heading"><span><Layers3 size={18} /></span><div><h3>已整理内容</h3><p>从来源材料中提取，可直接在对话中作为上下文使用。</p></div></header>
    {reviewableFacts.length ? (
      <section className="profile-review-queue" aria-label="待确认内容">
        <header><div><strong>待确认</strong><span>{reviewableFacts.length} 条</span></div><p>确认后才会进入可复用资料。</p></header>
        <ul>
          {visibleReviewFacts.map((item) => (
            <li key={item.id}>
              <div><strong>{item.title}</strong><p>{item.consequence}</p>{item.source ? <blockquote><cite>{item.sourceLabel}</cite>{item.source}</blockquote> : null}</div>
              <div className="profile-review-actions">
                <button type="button" disabled={reviewingFactId === item.id} onClick={() => void reviewFact(item.id, "confirm")}>确认</button>
                <button type="button" className="is-quiet" disabled={reviewingFactId === item.id} onClick={() => void reviewFact(item.id, "reject")}>不是</button>
              </div>
            </li>
          ))}
        </ul>
        {hiddenReviewCount ? <button type="button" className="profile-review-more" onClick={() => setReviewExpanded(true)}>查看其余 {hiddenReviewCount} 条</button> : null}
      </section>
    ) : null}
    {hasResume && organizedItemCount ? (
      <div className="profile-organized-summary">
        <div><strong>{organizedItemCount}</strong><span>条结构化内容</span></div>
        <div><strong>{resumeSections.length}</strong><span>个内容分区</span></div>
        {organizedSkills.length ? <div className="profile-organized-tags" aria-label="已整理技能">{organizedSkills.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
      </div>
    ) : <p className="profile-organized-empty">导入来源材料后，这里会显示已整理的经历、项目和技能。</p>}
  </section>;

  return (
    <section className="profile-settings-page profile-simplified-page">
      <header className="profile-page-heading">
        <div>
          <span className="ui-eyebrow">个人资料与来源</span>
          <h2>资料库</h2>
          <p>集中维护可信资料，后续对话和内容生成都会以这里为依据。</p>
        </div>
        <div className="profile-heading-actions">
          <span className={`profile-status ${hasResume ? "ready" : "pending"}`}><i />{hasResume ? "来源已就绪" : "待导入材料"}</span>
          {returnToWorkbench ? <ActionButton variant="secondary" type="button" onClick={onReturnToWorkbench}><ArrowLeft size={15} />返回分析</ActionButton> : null}
        </div>
      </header>

      <nav className="profile-library-index" aria-label="资料库内容">
        <button type="button" onClick={() => scrollToSection("library-profile")}><UserRound size={16} /><span><strong>基本资料</strong><small>{ready ? "已填写" : "待完善"}</small></span></button>
        <button type="button" onClick={() => scrollToSection("library-sources")}><FileText size={16} /><span><strong>来源材料</strong><small>{hasResume ? editor.resumeFilename || "已导入" : "待导入"}</small></span></button>
        <button type="button" onClick={() => scrollToSection("library-organized")}><Layers3 size={16} /><span><strong>已整理内容</strong><small>{reviewableFacts.length ? `${reviewableFacts.length} 条待确认` : organizedItemCount ? `${organizedItemCount} 条` : "等待整理"}</small></span></button>
      </nav>

      <section className="profile-linear-layout">{informationCard}<div id="library-sources">{resumeWorkspace}</div>{organizedContent}</section>

      {hasUnsavedChanges ? <footer className="profile-save-bar profile-simplified-save"><span>{ready ? <ShieldCheck size={15} /> : <UserRound size={15} />}{ready ? "保存后用于后续准备" : "填写称呼后即可保存"}</span><ActionButton variant="primary" type="button" onClick={() => void saveChanges()} disabled={busy || resumeBusy || !ready}>{busy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}{busy ? "保存中…" : "保存"}</ActionButton></footer> : null}
    </section>
  );
}
