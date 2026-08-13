import {
  ArrowLeft,
  FileText,
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
import { parseResumePreview, skillTags, type ResumePreviewSection } from "./resume-preview";

type PrivacyFinding = { entity_type: string; preview: string };

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
  returnToWorkbench: boolean;
  onChange: (editor: CandidateEditor) => void;
  onEnhancedParseChange: (enabled: boolean) => void;
  onParseFiles: (files: File[]) => void;
  onScanPrivacy: () => void;
  onFillSuggestion: () => void;
  onCareerChange: () => void | Promise<void>;
  onClearResume: () => void;
  onSave: () => void | Promise<void>;
  onReturnToWorkbench: () => void;
};

function ResumePreview({ editor, sections }: { editor: CandidateEditor; sections: ResumePreviewSection[] }) {
  return <div className="profile-resume-preview" aria-label="简历预览">
    <header className="resume-preview-profile"><div><strong>{editor.name || "我的简历"}</strong><span>{[editor.targetRole, editor.targetCity].filter(Boolean).join(" · ") || "补充准备方向和意向城市"}</span></div><span>{editor.resumeText.length.toLocaleString()} 字</span></header>
    <div className="resume-preview-sections">{sections.map((section) => <section key={section.kind} className={`resume-preview-section ${section.kind}`}><h4>{section.label}</h4>{section.kind === "skills" ? <div className="resume-skill-tags">{skillTags(section.entries).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div> : <div className="resume-preview-entry-list">{section.entries.map((entry, index) => <article key={`${section.kind}-${index}`}><strong>{entry[0]}</strong>{entry.slice(1).map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}</article>)}</div>}</section>)}</div>
  </div>;
}

export function ProfileSettingsPage({
  editor,
  busy,
  resumeBusy,
  enhancedParse,
  privacyFindings,
  suggestion,
  returnToWorkbench,
  onChange,
  onEnhancedParseChange,
  onParseFiles,
  onScanPrivacy,
  onFillSuggestion,
  onClearResume,
  onSave,
  onReturnToWorkbench
}: Props) {
  const ready = Boolean(editor.name.trim());
  const hasResume = Boolean(editor.resumeText.trim());
  const [showResumeImport, setShowResumeImport] = useState(!hasResume);
  const [resumeView, setResumeView] = useState<"preview" | "edit">("preview");
  const [isEdited, setIsEdited] = useState(false);
  const savedEditor = useRef(editorSnapshot(editor));
  const resumeSections = useMemo(() => parseResumePreview(editor.resumeText), [editor.resumeText]);
  const hasUnsavedChanges = isEdited || savedEditor.current !== editorSnapshot(editor);

  useEffect(() => {
    setShowResumeImport(!hasResume);
  }, [hasResume]);

  async function saveChanges() {
    await onSave();
    savedEditor.current = editorSnapshot(editor);
    setIsEdited(false);
  }

  function updateEditor(nextEditor: CandidateEditor) {
    setIsEdited(true);
    onChange(nextEditor);
  }

  const informationCard = <article className="profile-foundation-card">
    <header className="profile-foundation-heading"><span><UserRound size={18} /></span><div><h3>基本信息</h3><p>只填必要内容，其余从简历中补充。</p></div></header>
    <div className="candidate-form profile-foundation-form">
      <label><span>称呼 <em className="required-mark">必填</em></span><input required value={editor.name} placeholder="例如：小林" onChange={(event) => updateEditor({ ...editor, name: event.target.value })} /></label>
      <label><span>准备方向</span><input value={editor.targetRole} placeholder="例如：AI 应用开发工程师" onChange={(event) => updateEditor({ ...editor, targetRole: event.target.value })} /></label>
      <label className="wide-field"><span>意向城市 <small>可选</small></span><input value={editor.targetCity} placeholder="例如：上海、杭州" onChange={(event) => updateEditor({ ...editor, targetCity: event.target.value })} /></label>
    </div>
  </article>;

  const resumeWorkspace = <section id="resume-upload" className={`profile-resume-workspace ${hasResume ? "has-resume" : "is-empty"}`}>
    <header className="profile-resume-workspace-heading">
      <div className="profile-foundation-heading"><span><FileText size={18} /></span><div><h3>简历</h3><p>{hasResume ? editor.resumeFilename || "已导入" : "导入后自动整理项目与经历。"}</p></div></div>
      {hasResume ? <div className="profile-resume-heading-actions">
        {!showResumeImport ? <button type="button" className="profile-resume-trigger" onClick={() => setShowResumeImport(true)}><Upload size={14} />重新导入</button> : null}
        <button type="button" className="profile-privacy-check" onClick={onScanPrivacy} disabled={resumeBusy}><ShieldCheck size={14} />检查隐私</button>
      </div> : null}
    </header>

    {showResumeImport ? <div className="profile-resume-import">
      <label className={`profile-resume-action ${resumeBusy ? "busy" : ""}`}>
        {resumeBusy ? <LoaderCircle className="spinning" size={18} /> : <Upload size={18} />}
        <span>{resumeBusy ? "正在整理…" : hasResume ? "上传新简历" : "导入简历"}</span>
        <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md" disabled={resumeBusy} onChange={(event) => { onParseFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
      </label>
      <label className="profile-parse-option"><input type="checkbox" checked={enhancedParse} onChange={(event) => onEnhancedParseChange(event.target.checked)} /><span>复杂排版</span></label>
    </div> : null}

    {hasResume ? <section className="profile-resume-editor">
      <header><h3>{resumeView === "preview" ? "简历预览" : "编辑简历"}</h3><div className="profile-resume-view-switch" role="tablist" aria-label="简历视图"><button type="button" role="tab" aria-selected={resumeView === "preview"} className={resumeView === "preview" ? "active" : ""} onClick={() => setResumeView("preview")}>预览</button><button type="button" role="tab" aria-selected={resumeView === "edit"} className={resumeView === "edit" ? "active" : ""} onClick={() => setResumeView("edit")}>编辑原文</button></div></header>
      {resumeView === "preview" ? <ResumePreview editor={editor} sections={resumeSections} /> : <><textarea value={editor.resumeText} aria-label="简历内容" placeholder="上传简历或直接粘贴简历文本。" onChange={(event) => updateEditor({ ...editor, resumeText: event.target.value, resumeRedactedText: "" })} />
        {suggestion && (suggestion.name || suggestion.target_roles.length || suggestion.target_cities.length) ? <div className="profile-fill-suggestion"><WandSparkles size={17} /><div><strong>可补充的信息</strong><span>{[suggestion.name ? `称呼：${suggestion.name}` : "", suggestion.target_roles.length ? `准备方向：${suggestion.target_roles.join("、")}` : "", suggestion.target_cities.length ? `意向城市：${suggestion.target_cities.join("、")}` : ""].filter(Boolean).join("；")}</span></div><button type="button" onClick={onFillSuggestion}>填充</button></div> : null}</>}
      <footer><label className="agent-privacy-choice"><input type="checkbox" checked={editor.privacyMode === "original"} onChange={(event) => updateEditor({ ...editor, privacyMode: event.target.checked ? "original" : "redacted" })} /><span>允许使用简历原文优化内容</span><small>关闭时会隐藏常见隐私信息</small></label><button type="button" className="clear-resume-button" onClick={() => { setIsEdited(true); onClearResume(); }}><Trash2 size={13} />清除</button></footer>
    </section> : <div className="profile-resume-empty"><p>支持 PDF、Word、文本或图片格式。</p><details className="profile-paste-details"><summary>直接粘贴简历文本</summary><textarea aria-label="简历内容" placeholder="粘贴简历文本…" onChange={(event) => updateEditor({ ...editor, resumeText: event.target.value, resumeRedactedText: "" })} /></details></div>}

    <footer className="profile-resume-workspace-footer"><small className="profile-data-note">资料仅用于你的准备内容，不会自行对外发送。</small>{privacyFindings.length ? <div className="privacy-result"><ShieldCheck size={16} /><div><strong>检测到 {privacyFindings.length} 处敏感信息</strong><span>{privacyFindings.slice(0, 3).map((item) => item.preview).join("、")}；默认不会用于生成内容。</span></div></div> : null}</footer>
  </section>;

  return (
    <section className="profile-settings-page profile-simplified-page">
      <header className="profile-page-heading">
        <div>
          <h2>个人信息</h2>
          <p>作为岗位匹配、项目解析和面试准备的基础。</p>
        </div>
        <div className="profile-heading-actions">
          <span className={`profile-status ${hasResume ? "ready" : "pending"}`}><i />{hasResume ? "简历已导入" : "待导入简历"}</span>
          {returnToWorkbench ? <button className="secondary-button" type="button" onClick={onReturnToWorkbench}><ArrowLeft size={15} />返回求职工坊</button> : null}
        </div>
      </header>

      <section className="profile-linear-layout">{informationCard}{resumeWorkspace}</section>

      {hasUnsavedChanges ? <footer className="profile-save-bar profile-simplified-save"><span>{ready ? <ShieldCheck size={15} /> : <UserRound size={15} />}{ready ? "保存后用于后续准备" : "填写称呼后即可保存"}</span><button className="primary-button" type="button" onClick={() => void saveChanges()} disabled={busy || resumeBusy || !ready}>{busy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}{busy ? "保存中…" : "保存"}</button></footer> : null}
    </section>
  );
}
