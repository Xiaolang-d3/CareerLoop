import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, ChevronRight, CircleAlert, FileText, Layers3, Lightbulb, LoaderCircle, MessageSquareText, RefreshCw, Save, ShieldCheck, Sparkles, UserRound, X } from "lucide-react";
import type { InterviewPreparation, InterviewPreparationExperience, InterviewPreparationNode } from "../../types";
import { fetchWithTimeout } from "../../api/client";
import { useAsyncPolling } from "../../hooks/useAsyncPolling";
import "./interview-preparation.css";

export type PreparationArea = "projects" | "knowledge" | "records";

type Props = {
  apiBase: string;
  accessToken: string;
  initialData?: InterviewPreparation | null;
  initialDataLoading?: boolean;
  dataManagedByShell?: boolean;
  area?: PreparationArea;
  experienceId?: string;
  focus?: FocusGroup;
  nodeId?: string;
  onNavigate?: (target: { area: PreparationArea; experienceId?: string; focus?: FocusGroup; nodeId?: string }) => void;
  onOpenProfile: () => void;
  onDataChange?: (data: InterviewPreparation) => void;
  autoAnalysisAttemptedRevision?: number | null;
  onAutoAnalysisStarted?: (revision: number) => void;
};

async function requestJson<T>(apiBase: string, accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetchWithTimeout(`${apiBase}${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(payload.detail || "请求失败，请稍后重试");
  }
  return response.json() as Promise<T>;
}

function Checklist({ title, nodes, tone, highlightedNodeId, onOpenNode, onToggle }: { title: string; nodes: InterviewPreparationNode[]; tone: "knowledge" | "gap"; highlightedNodeId?: string; onOpenNode?: (nodeId: string) => void; onToggle: (node: InterviewPreparationNode, completed: boolean) => void }) {
  if (!nodes.length) return null;
  return <section className={`prep-node-list ${tone}`}><header><span>{tone === "knowledge" ? <BookOpenCheck size={15} /> : <Lightbulb size={15} />}</span><h3>{title}</h3></header>{nodes.map((node) => <label key={node.id} className={`${node.completed ? "completed" : ""} ${node.id === highlightedNodeId ? "route-target" : ""}`}><input type="checkbox" checked={node.completed} onFocus={() => onOpenNode?.(node.id)} onChange={(event) => onToggle(node, event.target.checked)} /><span>{node.title}</span></label>)}</section>;
}

function QuestionPractice({ node, busy, isRouteTarget, onOpen, onSave }: { node: InterviewPreparationNode; busy: boolean; isRouteTarget?: boolean; onOpen?: () => void; onSave: (node: InterviewPreparationNode, patch: { note?: string; completed?: boolean }) => void }) {
  const [answer, setAnswer] = useState(node.note);
  const hasUnsavedAnswer = answer.trim() !== node.note.trim();

  useEffect(() => { setAnswer(node.note); }, [node.id, node.note]);

  return <article className={`prep-question-card ${node.completed ? "completed" : ""} ${isRouteTarget ? "route-target" : ""}`}>
    <header><UserRound size={16} /><h3>{node.title}</h3></header>
    <label className="prep-answer-field">我的回答<textarea aria-label={`${node.title} 的回答`} value={answer} onFocus={onOpen} onChange={(event) => setAnswer(event.target.value)} placeholder="写下你的回答，必要时再补充项目细节…" rows={5} /></label>
    <footer>{hasUnsavedAnswer ? <button type="button" disabled={busy} onClick={() => onSave(node, { note: answer })}><Save size={14} />保存回答</button> : null}<label><input type="checkbox" checked={node.completed} disabled={busy} onChange={(event) => onSave(node, { completed: event.target.checked })} />已完成这题练习</label></footer>
  </article>;
}

type FocusGroup = "questions" | "knowledge" | "gaps";
type JdAnalysisStage = "idle" | "checking" | "matching" | "writing" | "complete";
type ResumeAnalysisPhase = "preparing_resume" | "calling_model" | "validating_result" | "completed";

const jdAnalysisSteps: Array<{ key: Exclude<JdAnalysisStage, "idle" | "complete">; label: string }> = [
  { key: "checking", label: "核对项目证据" },
  { key: "matching", label: "匹配 JD 要求" },
  { key: "writing", label: "生成改写与问题" },
];

function JdAnalysisProgress({ stage }: { stage: JdAnalysisStage }) {
  if (stage === "idle") return null;
  const activeIndex = stage === "complete" ? jdAnalysisSteps.length : jdAnalysisSteps.findIndex((item) => item.key === stage);
  return <div className={`jd-analysis-progress ${stage === "complete" ? "complete" : ""}`} aria-live="polite">
    <div>{jdAnalysisSteps.map((item, index) => <span className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""} key={item.key}>{index + 1}</span>)}</div>
    <p>{stage === "complete" ? "分析完成，可查看缺口、改写和问题。" : jdAnalysisSteps[activeIndex]?.label || "正在分析…"}</p>
  </div>;
}

const resumeAnalysisSteps = [
  { key: "preparing_resume", label: "读取简历" },
  { key: "calling_model", label: "模型识别项目" },
  { key: "validating_result", label: "校验并保存" },
] as const;

function ResumeAnalysisProgress({ phase }: { phase?: ResumeAnalysisPhase }) {
  const activeIndex = Math.max(0, resumeAnalysisSteps.findIndex((item) => item.key === phase));
  const currentLabel = resumeAnalysisSteps[activeIndex].label;
  return <div className="resume-analysis-progress" aria-label={`简历整理进度：${currentLabel}`}>
    {resumeAnalysisSteps.map((item, index) => <span className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""} key={item.key}>{item.label}</span>)}
  </div>;
}

function ProjectAnalysisWorkspace({ data, selected, focus, busy, structureAnalysis, analysisError, jdAnalysisStage, onSelect, onRefresh, onOpenNode, onSave, onReviewFragment, onSelectProjects, onAnalyzeJd, onFeedback, onEditResume }: { data: InterviewPreparation; selected: InterviewPreparationExperience | null; focus?: FocusGroup; busy: boolean; structureAnalysis: "idle" | "loading" | "failed"; analysisError: string; jdAnalysisStage: JdAnalysisStage; onSelect: (experience: InterviewPreparationExperience) => void; onRefresh: () => void; onOpenNode: (nodeId: string) => void; onSave: (node: InterviewPreparationNode, patch: { note?: string; completed?: boolean }) => void; onReviewFragment: (fragmentId: string, action: "confirm_project" | "work_responsibility" | "skill_evidence" | "ignore") => void; onSelectProjects: (projectIds: string[]) => void; onAnalyzeJd: (jobDescription: string) => void; onFeedback: (questionId: string, answer: string) => Promise<{ feedback: { strengths: string[]; gaps: string[]; next_attempt: string } }> ; onEditResume: () => void }) {
  const pendingCount = data.unclassified_fragments.length;
  const selectedProjectIds = data.selected_project_ids || [];
  const [jd, setJd] = useState(data.job_analysis?.job_description || "");
  const selectedProjects = data.experiences.filter((item) => selectedProjectIds.includes(item.id));
  const projectAnalysis = selected ? data.job_analysis?.projects.find((item) => item.id === selected.id) : null;

  useEffect(() => { setJd(data.job_analysis?.job_description || ""); }, [data.job_analysis?.job_description]);

  function toggleProject(projectId: string) {
    const next = selectedProjectIds.includes(projectId)
      ? selectedProjectIds.filter((item) => item !== projectId)
      : [...selectedProjectIds, projectId];
    onSelectProjects(next);
  }

  return <section className="project-analysis-layout">
      <aside className="project-analysis-index" aria-label="项目与归类状态">
        <header><div><span>投递材料</span><h3>经历候选</h3></div><button type="button" onClick={onRefresh} disabled={busy} title="重新整理当前简历"><RefreshCw size={14} />重新整理</button></header>
        <p className="project-selection-hint">勾选用于本次投递的项目或工作经历</p><div className="project-analysis-index-list">{data.experiences.length ? data.experiences.map((experience) => <div className={`project-candidate ${experience.id === selected?.id ? "selected" : ""}`} key={experience.id}><button type="button" onClick={() => onSelect(experience)}><span className="project-index-copy"><strong>{experience.title}</strong><small>{experience.gaps.length ? `${experience.gaps.length} 项待补充` : "已有可用证据"}</small></span><ChevronRight size={15} /></button><label><input type="checkbox" checked={selectedProjectIds.includes(experience.id)} disabled={busy} onChange={() => toggleProject(experience.id)} />用于本次投递</label></div>) : <p className="project-analysis-index-empty">还没有识别到可用经历。</p>}</div>
      </aside>

      <main className="project-analysis-detail">{structureAnalysis === "loading" ? <section className="project-analysis-structure-state" aria-live="polite"><LoaderCircle className="spinning" size={21} /><div><h3>正在后台整理简历</h3><p>这次分析依次读取简历、调用模型识别项目、校验结果；完成后会自动更新。</p><ResumeAnalysisProgress phase={data.resume_analysis?.phase} /></div></section> : null}{structureAnalysis === "failed" ? <section className="project-analysis-structure-state failed"><CircleAlert size={21} /><div><h3>简历 AI 整理未完成</h3><p>{analysisError || "模型暂时无法返回结构化结果，请稍后重试。"}</p></div><button type="button" onClick={onRefresh} disabled={busy}><RefreshCw size={14} />重试整理</button></section> : null}{selectedProjects.length ? <section className="project-job-workflow" aria-label="经历与目标岗位匹配"><header><span>JD</span><div><h3>粘贴目标 JD</h3><p>将围绕已选择的 {selectedProjects.length} 段经历生成改写和高概率问题。</p></div></header><textarea aria-label="目标 JD" value={jd} onChange={(event) => setJd(event.target.value)} placeholder="粘贴岗位职责、任职要求和技术要求…" rows={5} disabled={busy} /><footer><small>{jd.trim().length ? `${jd.trim().length} 字` : "JD 不会自动保存"}</small><button type="button" onClick={() => onAnalyzeJd(jd)} disabled={busy || jd.trim().length < 20}><Sparkles size={14} />生成改写与问题</button></footer><JdAnalysisProgress stage={jdAnalysisStage} />{data.job_analysis ? <div className="jd-gap-summary"><strong>匹配判断：{data.job_analysis.summary.fit}</strong><p><b>已有证据：</b>{data.job_analysis.summary.matched.join("；") || "待模型补充"}</p><p><b>优先补足：</b>{data.job_analysis.summary.gaps.join("；") || "当前未发现明确缺口"}</p></div> : null}</section> : <section className="project-analysis-no-selection"><Layers3 size={24} /><h3>{structureAnalysis === "loading" ? "项目正在识别中" : "选择投递经历"}</h3><p>{structureAnalysis === "loading" ? "你可以暂时离开此页，分析完成后会自动显示结果。" : "从左侧勾选真实项目或工作经历，再粘贴目标 JD。"}</p></section>}{selected ? <ProjectDetail selected={selected} targetRoles={data.overview.target_roles} focus={focus} busy={busy} onOpenNode={onOpenNode} onSave={onSave} jdProjectAnalysis={projectAnalysis} onFeedback={onFeedback} onEditResume={onEditResume} /> : null}
        {pendingCount ? <details className="project-triage-panel"><summary><CircleAlert size={16} />还有 {pendingCount} 条待归类内容</summary><div className="project-triage-list">{data.unclassified_fragments.map((fragment) => <article key={fragment.id}><p>{fragment.text}</p><div><button type="button" disabled={busy} onClick={() => onReviewFragment(fragment.id, "confirm_project")}>确认为项目</button><button type="button" disabled={busy} onClick={() => onReviewFragment(fragment.id, "work_responsibility")}>标记为工作职责</button><button type="button" disabled={busy} onClick={() => onReviewFragment(fragment.id, "skill_evidence")}>标记为技能证据</button><button type="button" className="fragment-ignore" disabled={busy} onClick={() => onReviewFragment(fragment.id, "ignore")}><X size={13} />忽略</button></div></article>)}</div></details> : null}
      </main>
    </section>;
}

function JdQuestionPractice({ question, busy, onFeedback }: { question: { id: string; question: string; focus: string }; busy: boolean; onFeedback: (questionId: string, answer: string) => Promise<{ feedback: { strengths: string[]; gaps: string[]; next_attempt: string } }> }) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<{ strengths: string[]; gaps: string[]; next_attempt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function requestFeedback() {
    setLoading(true); setError("");
    try { setFeedback((await onFeedback(question.id, answer)).feedback); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "获取反馈失败，请稍后重试"); }
    finally { setLoading(false); }
  }
  return <article className="jd-question-card"><strong>{question.question}</strong>{question.focus ? <small>考察：{question.focus}</small> : null}<textarea aria-label={`${question.question} 的回答`} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="写下你的回答…" rows={4} /><button type="button" onClick={() => void requestFeedback()} disabled={busy || loading || answer.trim().length < 10}>{loading ? "正在反馈…" : "获取反馈"}</button>{error ? <p className="inline-error" role="alert">{error}</p> : null}{feedback ? <div className="jd-feedback"><p><b>做得好：</b>{feedback.strengths.join("；") || "—"}</p><p><b>待补充：</b>{feedback.gaps.join("；") || "—"}</p><p><b>下一次尝试：</b>{feedback.next_attempt || "补充更具体的项目证据。"}</p></div> : null}</article>;
}

function ProjectDetail({ selected, targetRoles, focus, busy, onOpenNode, onSave, jdProjectAnalysis, onFeedback, onEditResume }: { selected: InterviewPreparationExperience; targetRoles: string[]; focus?: FocusGroup; busy: boolean; onOpenNode: (nodeId: string) => void; onSave: (node: InterviewPreparationNode, patch: { note?: string; completed?: boolean }) => void; jdProjectAnalysis?: { rewrite: string; questions: Array<{ id: string; question: string; focus: string }> } | null; onFeedback: (questionId: string, answer: string) => Promise<{ feedback: { strengths: string[]; gaps: string[]; next_attempt: string } }> ; onEditResume: () => void }) {
  const [tab, setTab] = useState<"overview" | "evidence" | "analysis" | "practice">("overview");
  const tabs = [{ key: "overview", label: "项目概览" }, { key: "evidence", label: "证据核验" }, { key: "analysis", label: "投递改写" }, { key: "practice", label: "面试练习" }] as const;
  useEffect(() => {
    if (focus) setTab("practice");
  }, [focus, selected.id]);
  return <><header className="project-analysis-detail-header"><div><span className="project-analysis-kicker">已确认项目 · 可追溯证据</span><h3>{selected.title}</h3><p>{targetRoles.length ? `围绕 ${targetRoles.join("、")} 整理面试表达。` : "从原始证据开始补全项目表达。"}</p></div><span className={`project-analysis-status ${selected.gaps.length ? "needs-input" : "ready"}`}>{selected.gaps.length ? <><CircleAlert size={14} />待补充</> : <><ShieldCheck size={14} />证据可用</>}</span></header><nav className="project-analysis-tabs" aria-label="项目详情"><div>{tabs.map((item) => <button type="button" key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>{item.label}</button>)}</div></nav>{tab === "overview" ? <section className="project-analysis-section project-analysis-overview"><header><span><Layers3 size={16} /></span><div><h3>项目概览</h3><p>来自简历原文的结构化字段。</p></div></header><div className="project-field-list">{selected.fields?.map((field) => <p key={`${field.label}-${field.value}`}><strong>{field.label}</strong><span>{field.value}</span></p>) || null}</div>{!selected.fields?.length ? <p>暂未提取到项目字段，请在证据核验中补充原文。</p> : null}</section> : null}{tab === "evidence" ? <section className="project-analysis-section project-analysis-evidence"><header><span><FileText size={16} /></span><div><h3>证据核验</h3><p>所有改写均应能回指到这里的简历原文。</p></div></header><blockquote><span>简历原文</span><p>{selected.evidence}</p></blockquote></section> : null}{tab === "analysis" ? <section className="project-analysis-section project-jd-result"><header><span><Sparkles size={16} /></span><div><h3>针对 JD 的简历改写</h3><p>仅重组原有事实，不新增无法证明的经历。</p></div></header>{jdProjectAnalysis?.rewrite ? <><textarea aria-label="项目改写" value={jdProjectAnalysis.rewrite} readOnly rows={6} /><button type="button" onClick={onEditResume}>去修改简历</button></> : <p>确认项目并粘贴 JD 后，这里会生成可用于投递的项目改写。</p>}</section> : null}{tab === "practice" ? <div className="project-analysis-practice-grid"><section className="project-analysis-section project-analysis-practice"><header><span><MessageSquareText size={16} /></span><div><h3>高概率问题</h3><p>先练与目标 JD 最相关的追问。</p></div></header><div className="project-analysis-question-list">{jdProjectAnalysis?.questions.length ? jdProjectAnalysis.questions.map((question) => <JdQuestionPractice key={question.id} question={question} busy={busy} onFeedback={onFeedback} />) : selected.questions.map((node) => <QuestionPractice key={node.id} node={node} busy={busy} onOpen={() => onOpenNode(node.id)} onSave={onSave} />)}</div></section><section className="project-analysis-section project-analysis-knowledge"><header><span><BookOpenCheck size={16} /></span><div><h3>技术与知识点</h3><p>从真实项目出发，不做脱离经历的题库训练。</p></div></header><Checklist title="关联知识点" nodes={selected.knowledge} tone="knowledge" onOpenNode={onOpenNode} onToggle={(node, completed) => onSave(node, { completed })} />{selected.gaps.length ? <Checklist title="待补充信息" nodes={selected.gaps} tone="gap" onOpenNode={onOpenNode} onToggle={(node, completed) => onSave(node, { completed })} /> : <div className="project-analysis-empty-gap"><ShieldCheck size={16} /><span>当前规则未发现明确的结果缺口；可在回答中补充具体结果与技术取舍。</span></div>}</section></div> : null}</>;
}

function KnowledgeReview({ experiences, generalKnowledge, experienceId, nodeId, busy, onOpenNode, onSave }: { experiences: InterviewPreparationExperience[]; generalKnowledge: InterviewPreparationNode[]; experienceId?: string; nodeId?: string; busy: boolean; onOpenNode: (experienceId: string, nodeId: string) => void; onSave: (node: InterviewPreparationNode, patch: { note?: string; completed?: boolean }) => void }) {
  const visibleExperiences = experienceId ? experiences.filter((experience) => experience.id === experienceId) : experiences;
  return <section className="prep-area-content" aria-label="知识点回顾">{visibleExperiences.map((experience) => <section className="prep-knowledge-experience" key={experience.id}><header><h3>{experience.title}</h3><p>{experience.evidence}</p></header><Checklist title="关联知识点" nodes={experience.knowledge} tone="knowledge" highlightedNodeId={nodeId} onOpenNode={(id) => onOpenNode(experience.id, id)} onToggle={(node, completed) => onSave(node, { completed })} /><Checklist title="待补充证据" nodes={experience.gaps} tone="gap" highlightedNodeId={nodeId} onOpenNode={(id) => onOpenNode(experience.id, id)} onToggle={(node, completed) => onSave(node, { completed })} /></section>)}{!visibleExperiences.length && generalKnowledge.length ? <section className="prep-knowledge-experience"><header><h3>简历中的技能</h3><p>暂未识别到独立项目，先根据简历中的技能整理回顾要点。</p></header><Checklist title="建议回顾" nodes={generalKnowledge} tone="knowledge" onToggle={(node, completed) => onSave(node, { completed })} /></section> : null}{!visibleExperiences.length && !generalKnowledge.length ? <section className="interview-prep-empty prep-knowledge-empty"><BookOpenCheck size={24} /><h2>暂未识别到可回顾的知识点</h2><p>补充项目经历或技术技能后，系统会在这里生成对应的复习清单。</p></section> : null}</section>;
}

function InterviewRecords({ data, busy, onCreate }: { data: InterviewPreparation; busy: boolean; onCreate: (title: string, summary: string, occurredOn: string) => Promise<boolean> }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !summary.trim()) return;
    if (await onCreate(title, summary, occurredOn)) {
      setTitle(""); setSummary("");
    }
  }

  return <section className="prep-area-content" aria-label="面试记录"><form className="prep-record-form" onSubmit={(event) => void submit(event)}><header><h3>记录一次复盘</h3><p>写下关键问题、当时的回答和下一次改进。</p></header><label>主题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Agent 系统设计一面" maxLength={200} /></label><label>日期<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label><label className="prep-record-summary">问题、原回答与复盘<textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="记录问题、你的回答，以及下次要改进的地方…" rows={6} maxLength={10000} /></label><button type="submit" disabled={busy || !title.trim() || !summary.trim()}><Save size={14} />保存记录</button></form><section className="prep-record-list"><h3>已保存</h3>{data.interview_records.length ? data.interview_records.map((record) => <article key={record.id}><header><strong>{record.title}</strong><time>{record.occurred_on}</time></header><p>{record.summary}</p></article>) : <p className="prep-empty-group">暂无记录。</p>}</section></section>;
}

const areaCopy: Record<PreparationArea, { title: string; description: string }> = {
  projects: { title: "项目深度解析", description: "先核对可追溯证据，再逐步补全项目价值、技术决策和面试表达。" },
  knowledge: { title: "知识点回顾", description: "回到真实项目，确认概念、用法与取舍。" },
  records: { title: "面试记录", description: "保留关键问题、你的回答与下一次改进。" },
};

export function InterviewPreparationPage({ apiBase, accessToken, initialData = null, initialDataLoading = false, dataManagedByShell = false, area = "projects", experienceId, focus, nodeId, onNavigate, onOpenProfile, onDataChange, autoAnalysisAttemptedRevision, onAutoAnalysisStarted }: Props) {
  const [data, setData] = useState<InterviewPreparation | null>(initialData);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [structureAnalysis, setStructureAnalysis] = useState<"idle" | "loading" | "failed">("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [jdAnalysisStage, setJdAnalysisStage] = useState<JdAnalysisStage>("idle");
  const analyzedRevision = useRef<number | null>(null);
  const loadRequest = useRef<Promise<InterviewPreparation> | null>(null);
  const jdAnalysisTimers = useRef<number[]>([]);

  function applyData(result: InterviewPreparation) {
    setData(result);
    onDataChange?.(result);
    setStructureAnalysis(result.resume_analysis?.status === "running" ? "loading" : result.resume_analysis?.status === "failed" ? "failed" : "idle");
    setAnalysisError(result.resume_analysis?.message || "");
  }

  async function load() {
    setBusy(true); setError("");
    try {
      const request = loadRequest.current ?? requestJson<InterviewPreparation>(apiBase, accessToken, "/interview-preparation");
      loadRequest.current = request;
      const result = await request;
      applyData(result);
      setSelectedId((current) => result.experiences.some((item) => item.id === experienceId) ? experienceId! : result.experiences.some((item) => item.id === current) ? current : result.experiences[0]?.id || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "加载失败"); }
    finally {
      loadRequest.current = null;
      setBusy(false);
    }
  }

  async function analyzeResume(silent = false) {
    setStructureAnalysis("loading"); setAnalysisError("");
    setBusy(true); if (!silent) setError("");
    try {
      const result = await requestJson<InterviewPreparation>(apiBase, accessToken, "/interview-preparation/analyze", { method: "POST" });
      applyData(result);
      setSelectedId((current) => result.experiences.some((item) => item.id === current) ? current : result.experiences[0]?.id || "");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "AI 整理失败";
      setStructureAnalysis("failed"); setAnalysisError(message);
      if (!silent) setError(message);
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (initialData) applyData(initialData);
  }, [initialData]);
  useEffect(() => {
    if (!initialData && !initialDataLoading && !dataManagedByShell) void load();
  }, [apiBase, accessToken, initialData, initialDataLoading, dataManagedByShell]);
  useEffect(() => () => jdAnalysisTimers.current.forEach((timer) => window.clearTimeout(timer)), []);
  useEffect(() => {
    // A small number of items can legitimately require a manual decision.
    // Bulk fragments are the legacy local-parser result and must be sent to
    // AI structure analysis rather than presented as dozens of review tasks.
    if (!data?.has_resume || data.resume_structure || data.unclassified_fragments.length < 10 || data.resume_analysis?.status !== "idle" || analyzedRevision.current === data.source_revision || autoAnalysisAttemptedRevision === data.source_revision) return;
    analyzedRevision.current = data.source_revision;
    onAutoAnalysisStarted?.(data.source_revision);
    // The page stays usable with the local, evidence-only fallback if a model is unavailable.
    void analyzeResume(true);
  }, [apiBase, accessToken, data]);
  useAsyncPolling({
    enabled: structureAnalysis === "loading",
    intervalMs: 1_500,
    poll: async () => applyData(await requestJson<InterviewPreparation>(apiBase, accessToken, "/interview-preparation")),
    onError: (_reason, failures) => {
      if (failures < 3) return;
      setStructureAnalysis("failed");
      setAnalysisError("暂时无法获取整理进度，请检查网络后重试。");
    }
  });
  useEffect(() => {
    if (!data || !experienceId || !data.experiences.some((item) => item.id === experienceId)) return;
    setSelectedId(experienceId);
  }, [data, experienceId]);
  const selected = useMemo(() => data?.experiences.find((item) => item.id === selectedId) || null, [data, selectedId]);

  function openProject(experience: InterviewPreparationExperience, nextFocus: FocusGroup = "questions", nextNodeId?: string) {
    setSelectedId(experience.id);
    onNavigate?.({ area: "projects", experienceId: experience.id, focus: nextFocus, nodeId: nextNodeId });
  }

  async function saveNode(node: InterviewPreparationNode, patch: { note?: string; completed?: boolean }) {
    setBusy(true); setError("");
    try {
      const result = await requestJson<InterviewPreparation>(apiBase, accessToken, `/interview-preparation/nodes/${node.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      setData(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function reviewFragment(fragmentId: string, action: "confirm_project" | "work_responsibility" | "skill_evidence" | "ignore") {
    setBusy(true); setError("");
    try {
      const result = await requestJson<InterviewPreparation>(apiBase, accessToken, `/interview-preparation/fragments/${fragmentId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      setData(result);
      setSelectedId((current) => result.experiences.some((item) => item.id === current) ? current : result.experiences[0]?.id || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "归类失败"); }
    finally { setBusy(false); }
  }

  async function selectProjects(projectIds: string[]) {
    setBusy(true); setError("");
    try {
      const result = await requestJson<InterviewPreparation>(apiBase, accessToken, "/interview-preparation/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_ids: projectIds }) });
      setData(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "确认项目失败"); }
    finally { setBusy(false); }
  }

  async function analyzeJd(jobDescription: string) {
    jdAnalysisTimers.current.forEach((timer) => window.clearTimeout(timer));
    setJdAnalysisStage("checking"); setBusy(true); setError("");
    jdAnalysisTimers.current = [
      window.setTimeout(() => setJdAnalysisStage("matching"), 450),
      window.setTimeout(() => setJdAnalysisStage("writing"), 1_200),
    ];
    try {
      const result = await requestJson<InterviewPreparation>(apiBase, accessToken, "/interview-preparation/jd-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_description: jobDescription }) });
      setData(result);
      setJdAnalysisStage("complete");
    } catch (reason) { setJdAnalysisStage("idle"); setError(reason instanceof Error ? reason.message : "JD 分析失败"); }
    finally { jdAnalysisTimers.current.forEach((timer) => window.clearTimeout(timer)); setBusy(false); }
  }

  async function requestFeedback(questionId: string, answer: string) {
    return requestJson<{ feedback: { strengths: string[]; gaps: string[]; next_attempt: string } }>(apiBase, accessToken, `/interview-preparation/questions/${questionId}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer }) });
  }

  async function createRecord(title: string, summary: string, occurredOn: string): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const result = await requestJson<InterviewPreparation>(apiBase, accessToken, "/interview-preparation/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, summary, occurred_on: occurredOn }) });
      setData(result);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); return false; }
    finally { setBusy(false); }
  }

  if ((busy || initialDataLoading) && !data) return <div className="interview-prep-loading"><LoaderCircle className="spinning" size={18} />正在整理你的面试准备内容…</div>;
  if (!data) return <section className="interview-prep-empty"><h2>暂时无法加载面试准备</h2><p>{error || "请稍后重试。"}</p><button className="ui-button ui-button-secondary ui-button-md" type="button" onClick={() => void load()}><RefreshCw size={15} />重新加载</button></section>;
  if (data.has_profile === false) return <section className="interview-prep-empty"><UserRound size={27} /><h2>先建立候选人画像</h2><p>项目解析、知识回顾和面试练习都需要基于你的真实经历。先填写称呼，再上传或粘贴简历即可开始。</p><button className="ui-button ui-button-primary ui-button-md" type="button" onClick={onOpenProfile}>创建个人资料<ChevronRight size={15} /></button></section>;
  if (!data.has_resume) return <section className="interview-prep-empty"><FileText size={27} /><h2>从个人经历开始</h2><p>上传或粘贴简历后，系统会从真实经历中整理项目证据、文字追问和知识点。</p><button className="ui-button ui-button-primary ui-button-md" type="button" onClick={onOpenProfile}>完善个人信息<ChevronRight size={15} /></button></section>;

  return <section className="interview-prep-page">
    <header className="interview-prep-intro"><div><h2>{areaCopy[area].title}</h2><p>{areaCopy[area].description}</p>{data.overview.target_roles.length ? <span className="prep-target">准备方向：{data.overview.target_roles.join("、")}</span> : null}</div>{area === "projects" ? <div className="project-analysis-actions"><button type="button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} />刷新内容</button></div> : null}</header>
    {area === "knowledge" ? <KnowledgeReview experiences={data.experiences} generalKnowledge={data.general_knowledge} experienceId={experienceId} nodeId={nodeId} busy={busy} onOpenNode={(nextExperienceId, nextNodeId) => onNavigate?.({ area: "knowledge", experienceId: nextExperienceId, nodeId: nextNodeId })} onSave={saveNode} /> : null}
    {area === "records" ? <InterviewRecords data={data} busy={busy} onCreate={createRecord} /> : null}
    {area === "projects" ? <ProjectAnalysisWorkspace data={data} selected={selected} focus={focus} busy={busy} structureAnalysis={structureAnalysis} analysisError={analysisError} jdAnalysisStage={jdAnalysisStage} onSelect={(experience) => openProject(experience)} onRefresh={() => void analyzeResume()} onOpenNode={(nextNodeId) => selected && openProject(selected, "questions", nextNodeId)} onSave={saveNode} onReviewFragment={(fragmentId, action) => void reviewFragment(fragmentId, action)} onSelectProjects={(projectIds) => void selectProjects(projectIds)} onAnalyzeJd={(jobDescription) => void analyzeJd(jobDescription)} onFeedback={requestFeedback} onEditResume={onOpenProfile} /> : null}
    {error ? <p className="inline-error">{error}</p> : null}
  </section>;
}
