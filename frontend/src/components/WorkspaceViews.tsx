import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSearch,
  FileCheck2,
  FileText,
  ImagePlus,
  Link2,
  ListChecks,
  LoaderCircle,
  MapPin,
  MessageCircle,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Target,
  Search,
  Trash2,
  X,
  UsersRound
} from "lucide-react";
import type {
  Conversation,
  InterviewKit,
  InterviewKitSummary,
  InterviewRound,
  InterviewType,
  JobEvaluation,
  JobEvent,
  JobImportActivityEvent,
  JobImportPreview,
  JobProject,
  JobProjectDraft,
  ResumeChange,
  ResumeChangeDecision,
  ResumeVersion,
  ResumeVersionSummary,
  WorkflowNode,
  WorkflowStatus
} from "../types";
import {
  JobOverview,
  JobStageNav,
  jobStatusLabels,
  priorityLabels,
  type WorkbenchStage
} from "../features/jobs/JobWorkspaceChrome";

type WorkbenchViewProps = {
  viewMode: "index" | "new" | "detail";
  hasProfile: boolean;
  chatBusy: boolean;
  jobBusy: boolean;
  jobImportBusy: boolean;
  jobImportActivity: JobImportActivityEvent[];
  browserJobImportAvailable: boolean;
  browserJobOpened: boolean;
  browserJobTabId: number | null;
  analysis: JobEvaluation | null;
  analysisBusy: boolean;
  resumeVersions: ResumeVersionSummary[];
  resumeVersion: ResumeVersion | null;
  resumeBusy: boolean;
  interviewKits: InterviewKitSummary[];
  interviewKit: InterviewKit | null;
  interviewRounds: InterviewRound[];
  jobTimeline: JobEvent[];
  interviewBusy: boolean;
  jobs: JobProject[];
  selectedJobId: number | null;
  onSelectJob: (jobId: number | null) => void;
  onNavigateIndex: () => void;
  onNavigateNew: () => void;
  onNavigateDetail: (jobId: number) => void;
  onNavigateEvaluation: (jobId: number) => void;
  onCreateComparison: (evaluationIds: number[]) => Promise<number>;
  onSaveJob: (draft: JobProjectDraft, jobId: number | null) => Promise<JobProject>;
  onPreviewJobUrl: (url: string) => Promise<JobImportPreview>;
  onOpenJobInBrowser: (url: string) => Promise<{ tabId: number; opened: boolean; reused: boolean }>;
  onPreviewJobFromBrowser: (url: string, tabId?: number) => Promise<JobImportPreview>;
  onPreviewJobText: (text: string, sourceUrl?: string) => Promise<JobImportPreview>;
  onPreviewJobScreenshot: (file: File, sourceUrl?: string) => Promise<JobImportPreview>;
  onDeleteJob: (job: JobProject) => Promise<void>;
  onCreateResumeVersion: (job: JobProject) => Promise<ResumeVersion>;
  onSelectResumeVersion: (versionId: number) => Promise<void>;
  onUpdateResumeChange: (
    versionId: number,
    changeId: number,
    patch: { decision?: ResumeChangeDecision; after_text?: string }
  ) => Promise<void>;
  onUpdateResumeVersion: (
    versionId: number,
    status: "draft" | "final"
  ) => Promise<void>;
  onExportResume: (versionId: number, format: "docx" | "pdf") => Promise<void>;
  onCreateInterviewKit: (job: JobProject, interviewType?: InterviewType) => Promise<InterviewKit>;
  onSelectInterviewKit: (kitId: number) => Promise<void>;
  onUpdateInterviewKit: (
    kitId: number,
    patch: { status?: "draft" | "ready"; self_intro?: string; notes?: string }
  ) => Promise<void>;
  onToggleInterviewTask: (kitId: number, taskId: number, completed: boolean) => Promise<void>;
  onCreateInterviewRound: (
    jobId: number,
    payload: {
      kit_id?: number;
      round_type: InterviewType;
      scheduled_at?: string;
      interviewer?: string;
      location?: string;
      notes?: string;
    }
  ) => Promise<void>;
  onUpdateInterviewRound: (
    roundId: number,
    patch: {
      status?: "scheduled" | "completed" | "cancelled";
      outcome?: "pending" | "passed" | "failed";
      notes?: string;
    }
  ) => Promise<void>;
  onAddTimelineNote: (jobId: number, title: string, detail: string) => Promise<void>;
};

const emptyJobDraft: JobProjectDraft = {
  job_title: "",
  company_name: "",
  location: "",
  salary_text: "",
  source_url: "",
  description: "",
  notes: "",
  status: "saved",
  priority: "medium"
};

function jobToDraft(job: JobProject): JobProjectDraft {
  return {
    job_title: job.job_title,
    company_name: job.company_name,
    location: job.location,
    salary_text: job.salary_text,
    source_url: job.source_url,
    description: job.description,
    notes: job.notes,
    status: job.status,
    priority: job.priority
  };
}

const stoppedImportStatuses = new Set<JobImportPreview["status"]>([
  "unsupported",
  "blocked",
  "invalid"
]);

function stoppedImportTitle(pageType: JobImportPreview["page_type"]) {
  const titles: Partial<Record<JobImportPreview["page_type"], string>> = {
    login_required: "页面需要登录",
    captcha: "页面需要验证",
    access_denied: "页面限制访问",
    job_expired: "岗位已失效",
    empty_page: "未获取到岗位内容"
  };
  return titles[pageType] || "未获取到岗位内容";
}

function importPlatformLabel(platform: string) {
  return {
    boss: "BOSS 直聘",
    linkedin: "LinkedIn",
    lagou: "拉勾",
    liepin: "猎聘",
    zhaopin: "智联招聘",
    "51job": "前程无忧"
  }[platform] || platform;
}

export function WorkbenchView({
  viewMode,
  hasProfile,
  chatBusy,
  jobBusy,
  jobImportBusy,
  jobImportActivity,
  browserJobImportAvailable,
  browserJobOpened,
  browserJobTabId,
  analysis,
  analysisBusy,
  resumeVersions,
  resumeVersion,
  resumeBusy,
  interviewKits,
  interviewKit,
  interviewRounds,
  jobTimeline,
  interviewBusy,
  jobs,
  selectedJobId,
  onSelectJob,
  onNavigateIndex,
  onNavigateNew,
  onNavigateDetail,
  onNavigateEvaluation,
  onCreateComparison,
  onSaveJob,
  onPreviewJobUrl,
  onOpenJobInBrowser,
  onPreviewJobFromBrowser,
  onPreviewJobText,
  onPreviewJobScreenshot,
  onDeleteJob,
  onCreateResumeVersion,
  onSelectResumeVersion,
  onUpdateResumeChange,
  onUpdateResumeVersion,
  onExportResume,
  onCreateInterviewKit,
  onSelectInterviewKit,
  onUpdateInterviewKit,
  onToggleInterviewTask,
  onCreateInterviewRound,
  onUpdateInterviewRound,
  onAddTimelineNote
}: WorkbenchViewProps) {
  const [draft, setDraft] = useState<JobProjectDraft>(emptyJobDraft);
  const [dirty, setDirty] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [pastedJobText, setPastedJobText] = useState("");
  const [pasteJobTextOpen, setPasteJobTextOpen] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<JobImportPreview | null>(null);
  const [importDescriptionExpanded, setImportDescriptionExpanded] = useState(false);
  const [editingJob, setEditingJob] = useState(true);
  const [jobDetailsExpanded, setJobDetailsExpanded] = useState(false);
  const [activeStage, setActiveStage] = useState<WorkbenchStage>("overview");
  const [jobSearch, setJobSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | JobProject["status"]>("all");
  const [comparisonJobs, setComparisonJobs] = useState<number[]>([]);
  const selectedJob = viewMode === "detail"
    ? jobs.find((job) => job.id === selectedJobId) ?? null
    : null;
  const currentAnalysis = selectedJob && analysis?.job_id === selectedJob.id ? analysis : null;
  const analysisReady = Boolean(
    currentAnalysis
    && ["completed", "partial_failed"].includes(currentAnalysis.status)
    && !currentAnalysis.is_stale
  );
  const importStopped = Boolean(
    importPreview && stoppedImportStatuses.has(importPreview.status)
  );
  const importBrowserRequired = importPreview?.status === "browser_required";

  useEffect(() => {
    setActiveStage("overview");
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJob) {
      setDraft(emptyJobDraft);
      setDirty(false);
      setEditingJob(true);
      setImportUrl("");
      setPastedJobText("");
      setPasteJobTextOpen(false);
      setImportWarnings([]);
      setImportPreview(null);
      setImportDescriptionExpanded(false);
      setJobDetailsExpanded(false);
      return;
    }
    setDraft(jobToDraft(selectedJob));
    setDirty(false);
    setEditingJob(false);
    setImportPreview(null);
    setImportDescriptionExpanded(false);
    setJobDetailsExpanded(false);
  }, [selectedJobId, selectedJob?.updated_at]);

  function updateDraft(patch: Partial<JobProjectDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  async function persistJob() {
    const existingJobId = viewMode === "detail" ? selectedJobId : null;
    const saved = await onSaveJob(draft, existingJobId);
    setDirty(false);
    setEditingJob(false);
    if (!existingJobId) onNavigateDetail(saved.id);
    return saved;
  }

  async function saveQuickPatch(patch: Partial<JobProjectDraft>) {
    if (!selectedJob) return;
    const nextDraft = { ...draft, ...patch };
    setDraft(nextDraft);
    setDirty(true);
    try {
      await onSaveJob(nextDraft, selectedJob.id);
      setDirty(false);
    } catch {
      return;
    }
  }

  function cancelJobEditing() {
    if (!selectedJob) return;
    setDraft(jobToDraft(selectedJob));
    setDirty(false);
    setEditingJob(false);
  }

  function startNewJob() {
    setDraft(emptyJobDraft);
    setDirty(false);
    setEditingJob(true);
    setActiveStage("overview");
    setImportUrl("");
    setImportWarnings([]);
    setImportPreview(null);
    setImportDescriptionExpanded(false);
    setJobDetailsExpanded(false);
    onSelectJob(null);
    onNavigateNew();
  }

  function openJob(jobId: number) {
    onSelectJob(jobId);
    onNavigateDetail(jobId);
  }

  async function deleteCurrentJob(job: JobProject) {
    await onDeleteJob(job);
    onNavigateIndex();
  }

  async function importJobLink() {
    const url = importUrl.trim();
    if (!url || jobImportBusy) return;
    try {
      const preview = await onPreviewJobUrl(url);
      const stopped = ["unsupported", "blocked", "invalid"].includes(preview.status);
      if (stopped || preview.status === "browser_required") {
        setImportUrl(preview.final_url || preview.source_url);
        setImportWarnings(preview.warnings);
        setImportPreview(preview);
        setImportDescriptionExpanded(false);
        setJobDetailsExpanded(false);
        return;
      }
      setDraft((current) => ({
        ...current,
        job_title: preview.job_title || current.job_title,
        company_name: preview.company_name || current.company_name,
        location: preview.location || current.location,
        salary_text: preview.salary_text || current.salary_text,
        source_url: preview.final_url || preview.source_url,
        description: preview.description || current.description
      }));
      setImportUrl(preview.final_url || preview.source_url);
      setImportWarnings(preview.warnings);
      setImportPreview(preview);
      setImportDescriptionExpanded(false);
      setJobDetailsExpanded(false);
      setDirty(true);
    } catch {
      return;
    }
  }

  async function openJobForImport() {
    if (!importPreview || jobImportBusy) return;
    try {
      await onOpenJobInBrowser(importPreview.final_url || importPreview.source_url);
    } catch {
      return;
    }
  }

  async function importJobFromText() {
    if (!pastedJobText.trim() || jobImportBusy) return;
    try {
      const preview = await onPreviewJobText(
        pastedJobText,
        importPreview?.source_url || importUrl
      );
      setDraft((current) => ({
        ...current,
        job_title: preview.job_title || current.job_title,
        company_name: preview.company_name || current.company_name,
        location: preview.location || current.location,
        salary_text: preview.salary_text || current.salary_text,
        source_url: preview.final_url || preview.source_url || current.source_url,
        description: preview.description || current.description
      }));
      setImportUrl(preview.final_url || preview.source_url || importUrl);
      setImportWarnings(preview.warnings);
      setImportPreview(preview);
      setPasteJobTextOpen(false);
      setImportDescriptionExpanded(false);
      setJobDetailsExpanded(false);
      setDirty(true);
    } catch {
      return;
    }
  }

  async function importJobFromBrowser() {
    if (!importPreview || jobImportBusy) return;
    try {
      const previousTrace = importPreview.agent_trace || [];
      const preview = await onPreviewJobFromBrowser(
        importPreview.final_url || importPreview.source_url,
        browserJobOpened ? browserJobTabId ?? undefined : undefined
      );
      const traceOffset = previousTrace.length;
      const mergedPreview: JobImportPreview = {
        ...preview,
        agent_rounds: importPreview.agent_rounds + preview.agent_rounds,
        agent_trace: [
          ...previousTrace,
          ...preview.agent_trace.map((event) => ({
            ...event,
            step: event.step + traceOffset
          }))
        ]
      };
      if (stoppedImportStatuses.has(preview.status)) {
        setImportWarnings(preview.warnings);
        setImportPreview(mergedPreview);
        setImportDescriptionExpanded(false);
        return;
      }
      setDraft((current) => ({
        ...current,
        job_title: preview.job_title || current.job_title,
        company_name: preview.company_name || current.company_name,
        location: preview.location || current.location,
        salary_text: preview.salary_text || current.salary_text,
        source_url: preview.final_url || preview.source_url,
        description: preview.description || current.description
      }));
      setImportUrl(preview.final_url || preview.source_url);
      setImportWarnings(preview.warnings);
      setImportPreview(mergedPreview);
      setImportDescriptionExpanded(false);
      setDirty(true);
    } catch {
      return;
    }
  }

  async function importJobFromScreenshot(file: File) {
    if (jobImportBusy) return;
    try {
      const preview = await onPreviewJobScreenshot(
        file,
        importPreview?.final_url || importPreview?.source_url || importUrl
      );
      setDraft((current) => ({
        ...current,
        job_title: preview.job_title || current.job_title,
        company_name: preview.company_name || current.company_name,
        location: preview.location || current.location,
        salary_text: preview.salary_text || current.salary_text,
        source_url: preview.final_url || preview.source_url || current.source_url,
        description: preview.description || current.description
      }));
      setImportUrl(preview.final_url || preview.source_url || importUrl);
      setImportWarnings(preview.warnings);
      setImportPreview(preview);
      setImportDescriptionExpanded(false);
      setJobDetailsExpanded(false);
      setDirty(true);
    } catch {
      return;
    }
  }

  async function runTask(task: "match" | "resume" | "interview") {
    let job: JobProject;
    try {
      job = selectedJob && !dirty && selectedJob.conversation_id
        ? selectedJob
        : await persistJob();
    } catch {
      return;
    }
    if (!job.conversation_id) return;
    if (task === "match") {
      onNavigateEvaluation(job.id);
      return;
    }
    if (task === "resume") {
      setActiveStage("resume");
      try {
        if (!analysis || analysis.job_id !== job.id || analysis.is_stale) {
          onNavigateEvaluation(job.id);
          return;
        }
        await onCreateResumeVersion(job);
      } catch {
        return;
      }
      return;
    }
    setActiveStage("interview");
    try {
      if (!analysis || analysis.job_id !== job.id || analysis.is_stale) {
        onNavigateEvaluation(job.id);
        return;
      }
      await onCreateInterviewKit(job, "general");
    } catch {
      return;
    }
  }

  const hasProjectContent = Boolean(
    draft.job_title.trim() || draft.company_name.trim() || draft.description.trim()
  );
  const ready = hasProfile && Boolean(draft.description.trim()) && !chatBusy && !jobBusy && !analysisBusy;
  const nextAction: WorkbenchStage = !analysisReady
    ? "analysis"
    : !resumeVersions.length
      ? "resume"
      : !interviewKits.length
        ? "interview"
        : "progress";
  const nextActionCopy = {
    analysis: currentAnalysis?.is_stale
      ? {
          title: "岗位资料有更新，建议重新分析",
          description: "岗位 JD、个人资料或求职策略发生变化，更新分析后再继续生成材料。",
          action: "更新匹配分析"
        }
      : {
          title: "先理解你与岗位的匹配情况",
          description: "Agent 会对照岗位要求与已确认的个人经历，给出有证据支持的下一步建议。",
          action: "开始匹配分析"
        },
    resume: {
      title: "把分析结果变成投递材料",
      description: "创建一份与当前岗位对应的简历版本，逐项确认修改后再导出。",
      action: "创建定制简历"
    },
    interview: {
      title: "围绕真实经历准备重点问答",
      description: "根据岗位要求和真实简历证据，生成重点问题、回答框架和追问提示。",
      action: "生成面试重点问答"
    },
    progress: {
      title: "记录面试并完成复盘",
      description: "保存面试安排、真实问题与反馈，让 Agent 帮你整理下一轮改进重点。",
      action: "打开面试记录"
    }
  }[nextAction];

  function runNextAction() {
    if (nextAction === "analysis") {
      void runTask("match");
      return;
    }
    if (nextAction === "resume") {
      void runTask("resume");
      return;
    }
    if (nextAction === "interview") {
      void runTask("interview");
      return;
    }
    setActiveStage("progress");
  }

  const visibleJobs = jobs.filter((job) => {
    const matchesStatus = statusFilter === "all" || job.status === statusFilter;
    const query = jobSearch.trim().toLowerCase();
    const matchesSearch = !query || [job.job_title, job.company_name, job.location]
      .some((value) => value.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });
  const comparisonStrategyId = jobs.find((job) => comparisonJobs.includes(job.id))?.latest_evaluation_strategy_id;
  const activeJobCount = jobs.filter((job) => !["rejected", "archived"].includes(job.status)).length;
  const interviewJobCount = jobs.filter((job) => job.status === "interviewing").length;
  const offerJobCount = jobs.filter((job) => job.status === "offer").length;

  async function compareSelectedJobs() {
    const selected = jobs.filter((job) => comparisonJobs.includes(job.id));
    const evaluationIds = selected.map((job) => job.latest_evaluation_id).filter((id): id is number => Boolean(id));
    if (evaluationIds.length < 2) return;
    await onCreateComparison(evaluationIds);
  }

  if (viewMode === "index") {
    return (
      <section className="job-project-index">
        <header className="job-index-hero">
          <div>
            <span className="analysis-kicker">JOB AGENT WORKSPACE</span>
            <h2>围绕每个岗位完成一次求职准备</h2>
            <p>先看岗位要求与匹配分析，再完成定制简历、重点问答和面试复盘。每一步都保留依据和版本。</p>
          </div>
        </header>

        {!hasProfile ? (
          <div className="job-index-profile-warning">
            <AlertTriangle size={16} />
            <div><strong>匹配分析尚未启用</strong><span>请先在岗位工作台保存要推进的岗位；开始分析前需要至少一条已确认的个人经历或技能。</span></div>
          </div>
        ) : null}

        <div className="job-index-stats">
          <div><strong>{jobs.length}</strong><span>全部岗位</span></div>
          <div><strong>{activeJobCount}</strong><span>进行中</span></div>
          <div><strong>{interviewJobCount}</strong><span>面试中</span></div>
          <div><strong>{offerJobCount}</strong><span>Offer</span></div>
        </div>

        <section className="job-index-list-section">
          <header>
            <div><h3>我的岗位</h3><span>{visibleJobs.length} 个岗位</span></div>
            <div className="job-index-controls">
              {comparisonJobs.length >= 2 ? <button className="secondary-button" onClick={() => void compareSelectedJobs()}>比较 {comparisonJobs.length} 个岗位</button> : null}
              <label className="job-index-search"><Search size={15} /><input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="搜索岗位、公司或城市" /></label>
              <select aria-label="筛选岗位状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | JobProject["status"])}>
                <option value="all">全部状态</option>
                {Object.entries(jobStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </header>

          {visibleJobs.length ? (
            <div className="job-index-grid">
              {visibleJobs.map((job) => (
                <article className="job-index-card-wrap" key={job.id}>
                <button type="button" className="job-index-card" onClick={() => openJob(job.id)}>
                  <div className="job-index-card-top"><span className={`job-priority ${job.priority}`} /><span>{jobStatusLabels[job.status]}</span><small>{priorityLabels[job.priority]}</small></div>
                  <div><h3>{job.job_title || "未命名岗位"}</h3><p>{job.company_name || "公司待补充"}</p></div>
                  <div className="job-index-card-meta">{job.location ? <span><MapPin size={13} />{job.location}</span> : null}{job.salary_text ? <span>{job.salary_text}</span> : null}</div>
                  <footer><span>{job.latest_evaluation_id ? "匹配分析已完成" : "等待匹配分析"}</span><em>继续准备<ArrowRight size={14} /></em></footer>
                </button>
                {job.latest_evaluation_id ? <label className="job-compare-check" title={comparisonStrategyId != null && job.latest_evaluation_strategy_id !== comparisonStrategyId ? "不同职业策略会单独分组，不能产生统一排名" : undefined}><input type="checkbox" checked={comparisonJobs.includes(job.id)} disabled={!comparisonJobs.includes(job.id) && (comparisonJobs.length >= 10 || (comparisonStrategyId != null && job.latest_evaluation_strategy_id !== comparisonStrategyId))} onChange={(event) => setComparisonJobs((current) => event.target.checked ? [...current, job.id] : current.filter((id) => id !== job.id))} />加入比较</label> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="job-index-empty">
              <span><Building2 size={24} /></span>
              <strong>{jobs.length ? "没有符合筛选条件的岗位" : "还没有需要推进的岗位"}</strong>
              <p>{jobs.length ? "调整搜索词或状态筛选。" : "请从岗位工作台保存值得推进的岗位，再开始匹配分析和求职准备。"}</p>
            </div>
          )}
        </section>
      </section>
    );
  }

  if (viewMode === "detail" && !selectedJob) {
    return (
      <section className="workbench-page job-project-subpage">
        <header className="job-subpage-nav">
          <button type="button" onClick={onNavigateIndex}><ArrowLeft size={15} />返回求职准备</button>
          <span>/</span><strong>岗位详情</strong>
        </header>
        <div className="job-detail-unavailable">
          <LoaderCircle className={jobBusy ? "spinning" : ""} size={22} />
          <strong>{jobBusy ? "正在读取岗位项目" : "没有找到这个岗位项目"}</strong>
          <p>项目可能已删除，或当前链接已经失效。</p>
          <button type="button" onClick={onNavigateIndex}>返回岗位列表</button>
        </div>
      </section>
    );
  }

  if (viewMode === "new") {
    return (
      <section className="workbench-page job-project-subpage">
        <header className="job-subpage-nav">
          <button type="button" onClick={onNavigateIndex}><ArrowLeft size={15} />返回求职准备</button>
          <span>/</span><strong>浏览器读取</strong>
        </header>
        <div className="job-detail-unavailable">
          <FileSearch size={22} />
          <strong>岗位项目只能从岗位收件箱保存</strong>
          <p>请在招聘详情页使用浏览器助手读取当前岗位，完成初筛后再入围并保存为岗位项目。</p>
          <button type="button" onClick={onNavigateIndex}>查看已有岗位</button>
        </div>
      </section>
    );
  }

  return (
    <section className="workbench-page job-project-subpage">
      <header className="job-subpage-nav">
        <button type="button" onClick={onNavigateIndex}><ArrowLeft size={15} />返回求职准备</button>
        <span>/</span>
        <strong>{selectedJob?.job_title || "岗位详情"}</strong>
      </header>
      <section className={`job-project-workspace subpage ${jobs.length ? "" : "focus-new-job"}`}>

        <div className="job-workspace-main">
          {selectedJob ? (
            <header className="job-workspace-header">
              <div className="job-workspace-title">
                <span className={`job-priority ${selectedJob.priority}`} />
                <div>
                  <span className="analysis-kicker">当前岗位</span>
                  <h1>{selectedJob.job_title || "未命名岗位"}</h1>
                  <p>
                    {[
                      selectedJob.company_name || "公司待补充",
                      selectedJob.location,
                      selectedJob.salary_text
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <div className="job-workspace-meta">
                <label>
                  <span>状态</span>
                  <select
                    value={draft.status}
                    disabled={jobBusy || dirty}
                    onChange={(event) => void saveQuickPatch({
                      status: event.target.value as JobProject["status"]
                    })}
                  >
                    {Object.entries(jobStatusLabels).map(([value, label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>优先级</span>
                  <select
                    value={draft.priority}
                    disabled={jobBusy || dirty}
                    onChange={(event) => void saveQuickPatch({
                      priority: event.target.value as JobProject["priority"]
                    })}
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                </label>
                {selectedJob.source_url ? (
                  <a href={selectedJob.source_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />岗位原文
                  </a>
                ) : null}
                <button
                  className={editingJob ? "active" : ""}
                  onClick={() => editingJob ? cancelJobEditing() : setEditingJob(true)}
                >
                  <PencilLine size={14} />{editingJob ? "取消编辑" : "编辑资料"}
                </button>
              </div>
            </header>
          ) : null}

          {!selectedJob || editingJob ? (
            <section className={`flow-step jd-entry-card ${draft.description.trim() ? "complete" : ""}`}>
              <header className="flow-step-heading">
                <span className="flow-step-number">{selectedJob ? <PencilLine size={15} /> : <Link2 size={15} />}</span>
                <div>
                  <h2>
                    {selectedJob
                      ? "编辑岗位项目"
                      : importBrowserRequired && !jobDetailsExpanded
                        ? "导入岗位"
                      : importStopped && !jobDetailsExpanded
                        ? "导入岗位"
                      : jobDetailsExpanded
                        ? importPreview
                          ? "补充岗位资料"
                          : "手动填写岗位"
                        : importPreview
                          ? "确认识别结果"
                          : "导入一个岗位"}
                  </h2>
                  <p>
                    {selectedJob
                      ? "修改后保存，后续分析会使用最新岗位资料。"
                      : importBrowserRequired && !jobDetailsExpanded
                        ? browserJobOpened
                          ? "岗位页面已在 Chrome 中打开。请完成登录或安全验证，回到此页面确认后再读取。"
                          : "公开读取受限，点击下方按钮打开 Chrome 岗位页，完成登录后再继续。"
                      : importStopped && !jobDetailsExpanded
                        ? "未获取到可用岗位内容，可重新输入或手动填写。"
                      : jobDetailsExpanded
                        ? importPreview
                          ? "补全未识别的内容；岗位 JD 是开始分析的必要内容。"
                          : "只需要补充已有的信息，岗位 JD 是开始分析的必要内容。"
                        : importPreview
                          ? "先确认关键内容，需要时再展开编辑。"
                          : "先粘贴岗位链接，确认识别结果后再进入分析。"}
                  </p>
                </div>
                {selectedJob || dirty || importPreview || jobDetailsExpanded ? (
                  <span className={`flow-step-status ${selectedJob && !dirty ? "complete" : ""}`}>
                    {importBrowserRequired
                      ? <Bot size={14} />
                      : importStopped
                      ? <AlertTriangle size={14} />
                      : selectedJob && !dirty
                        ? <CheckCircle2 size={14} />
                        : <PencilLine size={14} />}
                    {importBrowserRequired
                      ? "等待浏览器"
                      : importStopped
                      ? "已停止"
                      : selectedJob && !dirty
                        ? "已保存"
                        : dirty
                          ? "有修改"
                          : "填写中"}
                  </span>
                ) : null}
              </header>
              {!selectedJob && !importPreview && !jobDetailsExpanded ? (
                <section className="job-link-import">
                  <label className="job-link-label" htmlFor="job-import-url">
                    <strong>岗位页面链接</strong>
                    <span>支持公开可访问的岗位详情页</span>
                  </label>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void importJobLink();
                    }}
                  >
                    <input
                      id="job-import-url"
                      type="url"
                      inputMode="url"
                      autoComplete="url"
                      spellCheck={false}
                      value={importUrl}
                      disabled={jobImportBusy}
                      placeholder="https://www.zhipin.com/job_detail/..."
                      onChange={(event) => {
                        setImportUrl(event.target.value);
                        setImportWarnings([]);
                      }}
                    />
                    <button disabled={!importUrl.trim() || jobImportBusy} type="submit">
                      {jobImportBusy
                        ? <LoaderCircle className="spinning" size={15} />
                        : <Link2 size={15} />}
                      {jobImportBusy ? "读取中…" : "读取岗位"}
                    </button>
                  </form>
                  <div className="job-import-fallback-actions" aria-label="其他岗位输入方式">
                    <span>公开页面受限时，也可以：</span>
                    <button
                      type="button"
                      onClick={() => setPasteJobTextOpen(true)}
                      disabled={jobImportBusy}
                    >
                      <FileText size={14} />粘贴文字自动识别
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobDetailsExpanded(true)}
                      disabled={jobImportBusy}
                    >
                      <PencilLine size={14} />逐项填写
                    </button>
                    <label className="job-import-upload-button">
                      <ImagePlus size={14} />上传岗位截图
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={jobImportBusy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) void importJobFromScreenshot(file);
                        }}
                      />
                    </label>
                  </div>
                  {pasteJobTextOpen ? (
                    <section className="job-import-text-fallback">
                      <header>
                        <div>
                          <strong>粘贴岗位文字</strong>
                          <small>可从 Chrome 复制岗位描述、职位要求和公司信息，系统只在本机提取字段。</small>
                        </div>
                        <button
                          type="button"
                          className="tertiary-button"
                          onClick={() => setPasteJobTextOpen(false)}
                          disabled={jobImportBusy}
                        >
                          关闭
                        </button>
                      </header>
                      <textarea
                        value={pastedJobText}
                        maxLength={50_000}
                        placeholder={'例如：\nAI 产品经理\n公司名称：示例科技\n职位描述\n负责……'}
                        onChange={(event) => setPastedJobText(event.target.value)}
                      />
                      <footer>
                        <small>{pastedJobText.trim().length} 字 · 不会读取 Cookie 或登录信息</small>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={!pastedJobText.trim() || jobImportBusy}
                          onClick={() => void importJobFromText()}
                        >
                          {jobImportBusy ? <LoaderCircle className="spinning" size={15} /> : <FileText size={15} />}
                          {jobImportBusy ? "识别中…" : "自动识别岗位"}
                        </button>
                      </footer>
                    </section>
                  ) : null}
                  {jobImportBusy ? (
                    <section className="job-import-agent-live" role="status" aria-live="polite">
                      <header>
                        <span className="job-import-agent-avatar"><Bot size={16} /></span>
                        <div>
                          <strong>Job Import Agent</strong>
                          <small>
                            {jobImportActivity[jobImportActivity.length - 1]?.message || "正在建立任务上下文"}
                          </small>
                        </div>
                        <span className="job-import-agent-running">
                          <i />运行中
                        </span>
                      </header>
                      <div className="job-import-agent-activity">
                        {jobImportActivity.length ? (
                          jobImportActivity.slice(-8).map((event) => {
                            const active = event.status === "thinking" || event.status === "running";
                            const complete = event.status === "done" || event.status === "ready";
                            return (
                              <div className={event.status} key={event.id}>
                                <span>
                                  {active
                                    ? <LoaderCircle className="spinning" size={12} />
                                    : complete
                                      ? <Check size={12} />
                                      : <AlertTriangle size={12} />}
                                </span>
                                <p>{event.message}</p>
                                {event.round ? <small>R{event.round}</small> : null}
                              </div>
                            );
                          })
                        ) : (
                          <div className="thinking">
                            <span><LoaderCircle className="spinning" size={12} /></span>
                            <p>正在启动岗位导入智能体</p>
                          </div>
                        )}
                      </div>
                    </section>
                  ) : null}
                  {importWarnings.length ? (
                    <div className="job-import-warnings" role="status">
                      {importWarnings.map((warning) => (
                        <span key={warning}><AlertTriangle size={13} />{warning}</span>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {!selectedJob && importPreview && !jobDetailsExpanded ? (
                <section
                  className={[
                    "job-import-preview",
                    importPreview.status,
                    !importStopped && !importBrowserRequired ? "review" : ""
                  ].filter(Boolean).join(" ")}
                >
                  <div className="job-import-preview-heading">
                    <div>
                      <span className="eyebrow">
                        {importPreview.status === "ready"
                          ? "识别完成"
                          : importPreview.status === "partial"
                            ? "需要补充"
                            : importBrowserRequired
                              ? "需要浏览器"
                              : "读取失败"}
                      </span>
                      <h2>
                        {importBrowserRequired
                          ? "从 Chrome 读取岗位"
                          : importStopped
                          ? stoppedImportTitle(importPreview.page_type)
                          : draft.job_title || "岗位名称待补充"}
                      </h2>
                      {importBrowserRequired ? (
                        <p>
                          {browserJobOpened
                            ? "岗位页面已打开。请在 Chrome 中完成登录或安全验证，回到这里点击确认后继续读取。"
                            : browserJobImportAvailable
                              ? "浏览器助手已连接，点击下方按钮打开岗位页面。"
                              : "浏览器助手尚未连接；加载扩展后可打开岗位页面。"}
                        </p>
                      ) : !importStopped ? (
                        <p>
                          {[draft.company_name, draft.location, draft.salary_text]
                            .filter(Boolean)
                          .join(" · ") || "公司与岗位信息待补充"}
                        </p>
                      ) : null}
                    </div>
                    {importPreview.final_url || importPreview.source_url ? (
                      <a
                        className="job-import-source"
                        href={importPreview.final_url || importPreview.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {importPreview.source_domain}<ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="job-import-source">{importPreview.source_domain}</span>
                    )}
                  </div>
                  {jobImportBusy && importBrowserRequired ? (
                    <section className="job-import-agent-live" role="status" aria-live="polite">
                      <header>
                        <span className="job-import-agent-avatar"><Bot size={16} /></span>
                        <div>
                          <strong>Browser Agent</strong>
                          <small>
                            {jobImportActivity[jobImportActivity.length - 1]?.message
                              || "正在连接 Chrome 页面"}
                          </small>
                        </div>
                        <span className="job-import-agent-running">
                          <i />运行中
                        </span>
                      </header>
                      <div className="job-import-agent-activity">
                        {jobImportActivity.slice(-6).map((event) => {
                          const active = event.status === "thinking" || event.status === "running";
                          const complete = event.status === "done" || event.status === "ready";
                          return (
                            <div className={event.status} key={`browser-${event.id}`}>
                              <span>
                                {active
                                  ? <LoaderCircle className="spinning" size={12} />
                                  : complete
                                    ? <Check size={12} />
                                    : <AlertTriangle size={12} />}
                              </span>
                              <p>{event.message}</p>
                              {event.round ? <small>R{event.round}</small> : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}
                  {!importStopped && !importBrowserRequired ? (
                    <div className="job-import-review-layout">
                      <article className="job-import-review-document">
                        <div className="job-import-review-fields">
                          <div>
                            <span><Building2 size={15} /></span>
                            <div>
                              <small>公司</small>
                              <strong>{draft.company_name || "待补充"}</strong>
                            </div>
                          </div>
                          <div>
                            <span><MapPin size={15} /></span>
                            <div>
                              <small>工作地点</small>
                              <strong>{draft.location || "待补充"}</strong>
                            </div>
                          </div>
                          <div>
                            <span><Target size={15} /></span>
                            <div>
                              <small>薪资</small>
                              <strong>{draft.salary_text || "待补充"}</strong>
                            </div>
                          </div>
                        </div>
                        <section className="job-import-jd-preview">
                          <header>
                            <div>
                              <span><FileText size={15} /></span>
                              <div>
                                <strong>岗位描述</strong>
                                <small>已识别 {importPreview.character_count} 字</small>
                              </div>
                            </div>
                            <span className="job-import-quality-badge">
                              <CheckCircle2 size={13} />可用于岗位分析
                            </span>
                          </header>
                          <div className={importDescriptionExpanded ? "expanded" : ""}>
                            {draft.description || "岗位描述待补充"}
                          </div>
                          {draft.description.length > 360 ? (
                            <button
                              type="button"
                              aria-expanded={importDescriptionExpanded}
                              onClick={() => setImportDescriptionExpanded((current) => !current)}
                            >
                              {importDescriptionExpanded ? "收起岗位描述" : "展开完整岗位描述"}
                            </button>
                          ) : null}
                        </section>
                      </article>
                      <aside className="job-import-review-checks">
                        <header>
                          <span><ListChecks size={15} /></span>
                          <div>
                            <strong>导入检查</strong>
                            <small>保存前确认关键字段</small>
                          </div>
                        </header>
                        <div>
                          {[
                            ["岗位名称", Boolean(draft.job_title)],
                            ["公司名称", Boolean(draft.company_name)],
                            ["工作地点", Boolean(draft.location)],
                            ["完整 JD", draft.description.trim().length >= 40]
                          ].map(([label, complete]) => (
                            <span className={complete ? "complete" : "missing"} key={String(label)}>
                              {complete
                                ? <Check size={12} />
                                : <AlertTriangle size={12} />}
                              <strong>{String(label)}</strong>
                              <small>{complete ? "已识别" : "待补充"}</small>
                            </span>
                          ))}
                        </div>
                        {importWarnings.length ? (
                          <div className="job-import-warnings" role="status">
                            {importWarnings.map((warning) => (
                              <span key={warning}><AlertTriangle size={13} />{warning}</span>
                            ))}
                          </div>
                        ) : (
                          <p className="job-import-review-ready">
                            <CheckCircle2 size={14} />关键内容已齐全，可以创建岗位项目。
                          </p>
                        )}
                      </aside>
                    </div>
                  ) : null}
                  {importPreview.agent_trace?.length ? (
                    !importStopped && !importBrowserRequired ? (
                      <details className="job-import-agent-trace compact">
                        <summary>
                          <span><Bot size={14} /></span>
                          <div>
                            <strong>查看智能体执行记录</strong>
                            <small>
                              {importPreview.agent_trace.length} 项任务 · {importPlatformLabel(importPreview.platform)}
                            </small>
                          </div>
                        </summary>
                        <div>
                          {importPreview.agent_trace.map((event) => (
                            <div className={event.status} key={`${event.step}-${event.tool}`}>
                              <span>
                                {event.status === "done"
                                  ? <Check size={12} />
                                  : <AlertTriangle size={12} />}
                              </span>
                              <p>{event.message}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <section className="job-import-agent-trace" aria-label="智能体执行过程">
                        <header>
                          <span><Bot size={14} /></span>
                          <div>
                            <strong>智能体执行记录</strong>
                            <small>
                              {importPreview.agent_trace.filter(
                                (event) => !(importStopped && event.tool === "stop_job_import")
                              ).length} 项任务 · {importPlatformLabel(importPreview.platform)}
                            </small>
                          </div>
                        </header>
                        <div>
                          {importPreview.agent_trace
                            .filter((event) => !(importStopped && event.tool === "stop_job_import"))
                            .map((event) => (
                              <div className={event.status} key={`${event.step}-${event.tool}`}>
                                <span>
                                  {event.status === "done"
                                    ? <Check size={12} />
                                    : <AlertTriangle size={12} />}
                                </span>
                                <p>{event.message}</p>
                              </div>
                            ))}
                        </div>
                      </section>
                    )
                  ) : null}
                  <div className="job-import-preview-actions">
                    <button
                      type="button"
                      className="tertiary-button"
                      onClick={() => {
                        setImportPreview(null);
                        setImportUrl("");
                        setImportWarnings([]);
                        setDraft(emptyJobDraft);
                        setImportDescriptionExpanded(false);
                        setDirty(false);
                      }}
                    >
                      {importStopped || importBrowserRequired ? "重新输入" : "重新识别"}
                    </button>
                    {importBrowserRequired ? (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setPasteJobTextOpen(true);
                            setJobDetailsExpanded(false);
                          }}
                        >
                          <FileText size={15} />粘贴文字
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setJobDetailsExpanded(true)}
                        >
                          <PencilLine size={15} />手动填写
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={jobImportBusy}
                          onClick={() => void (browserJobOpened ? importJobFromBrowser() : openJobForImport())}
                        >
                          {jobImportBusy
                            ? <LoaderCircle className="spinning" size={15} />
                            : <ExternalLink size={15} />}
                          {jobImportBusy
                            ? browserJobOpened ? "读取中…" : "打开中…"
                            : browserJobOpened
                              ? "确认已登录，继续读取"
                              : browserJobImportAvailable
                                ? "打开 Chrome 岗位页"
                                : "打开 Chrome 并登录"}
                        </button>
                        <label className="secondary-button job-import-upload-button">
                          <ImagePlus size={15} />上传岗位截图
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={jobImportBusy}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.currentTarget.value = "";
                              if (file) void importJobFromScreenshot(file);
                            }}
                          />
                        </label>
                      </>
                    ) : importStopped ? (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setPasteJobTextOpen(true);
                            setJobDetailsExpanded(false);
                          }}
                        >
                          <FileText size={15} />粘贴文字
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => setJobDetailsExpanded(true)}
                        >
                          <PencilLine size={15} />手动填写岗位
                        </button>
                        <label className="secondary-button job-import-upload-button">
                          <ImagePlus size={15} />上传岗位截图
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={jobImportBusy}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.currentTarget.value = "";
                              if (file) void importJobFromScreenshot(file);
                            }}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setJobDetailsExpanded(true)}
                        >
                          <PencilLine size={15} />编辑识别结果
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={jobBusy}
                          onClick={() => {
                            if (importPreview.status === "partial" || !draft.description.trim()) {
                              setJobDetailsExpanded(true);
                              return;
                            }
                            void persistJob();
                          }}
                        >
                          {importPreview.status === "partial" || !draft.description.trim() ? (
                            <>补充缺失信息<ArrowRight size={15} /></>
                          ) : jobBusy ? (
                            "保存中…"
                          ) : (
                            <>确认并创建岗位<ArrowRight size={15} /></>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </section>
              ) : null}

              {!selectedJob && importPreview && pasteJobTextOpen ? (
                <section className="job-import-text-fallback job-import-text-fallback-preview">
                  <header>
                    <div>
                      <strong>粘贴岗位文字</strong>
                      <small>可从 Chrome 复制岗位描述、职位要求和公司信息，系统只在本机提取字段。</small>
                    </div>
                    <button
                      type="button"
                      className="tertiary-button"
                      onClick={() => setPasteJobTextOpen(false)}
                      disabled={jobImportBusy}
                    >
                      关闭
                    </button>
                  </header>
                  <textarea
                    value={pastedJobText}
                    maxLength={50_000}
                    placeholder={'例如：\nAI 产品经理\n公司名称：示例科技\n职位描述\n负责……'}
                    onChange={(event) => setPastedJobText(event.target.value)}
                  />
                  <footer>
                    <small>{pastedJobText.trim().length} 字 · 不会读取 Cookie 或登录信息</small>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!pastedJobText.trim() || jobImportBusy}
                      onClick={() => void importJobFromText()}
                    >
                      {jobImportBusy ? <LoaderCircle className="spinning" size={15} /> : <FileText size={15} />}
                      {jobImportBusy ? "识别中…" : "自动识别岗位"}
                    </button>
                  </footer>
                </section>
              ) : null}

              {!selectedJob && !importPreview && !jobDetailsExpanded ? (
                <button
                  type="button"
                  className="manual-job-entry-toggle"
                  onClick={() => setJobDetailsExpanded(true)}
                >
                  <PencilLine size={15} />
                  无法读取链接？改为手动粘贴 JD
                </button>
              ) : null}

              {selectedJob || jobDetailsExpanded ? (
                <>
          <div className="job-project-fields">
            <label>
              <span>岗位名称</span>
              <input value={draft.job_title} maxLength={200} placeholder="例如：AI 产品经理" onChange={(event) => updateDraft({ job_title: event.target.value })} />
            </label>
            <label>
              <span>公司名称</span>
              <input value={draft.company_name} maxLength={200} placeholder="例如：示例科技" onChange={(event) => updateDraft({ company_name: event.target.value })} />
            </label>
            <label>
              <span>工作地点</span>
              <input value={draft.location} maxLength={200} placeholder="上海 · 浦东" onChange={(event) => updateDraft({ location: event.target.value })} />
            </label>
            <label>
              <span>薪资信息</span>
              <input value={draft.salary_text} maxLength={100} placeholder="30-45K · 15薪" onChange={(event) => updateDraft({ salary_text: event.target.value })} />
            </label>
            <label>
              <span>当前状态</span>
              <select value={draft.status} onChange={(event) => updateDraft({ status: event.target.value as JobProject["status"] })}>
                {Object.entries(jobStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>优先级</span>
              <select value={draft.priority} onChange={(event) => updateDraft({ priority: event.target.value as JobProject["priority"] })}>
                {Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label className="wide">
              <span>岗位来源</span>
              <div className="job-source-input">
                <input value={draft.source_url} maxLength={1_000} placeholder="https://…" onChange={(event) => updateDraft({ source_url: event.target.value })} />
                {draft.source_url.trim() ? <a href={draft.source_url} target="_blank" rel="noreferrer" title="打开岗位来源"><ExternalLink size={15} /></a> : null}
              </div>
            </label>
          </div>
          <label className="job-description-field">
            <span>岗位 JD <em>分析任务必填</em></span>
            <textarea
          value={draft.description}
          maxLength={50_000}
          placeholder="例如：岗位职责、任职要求、技能要求、工作地点等…"
              onChange={(event) => updateDraft({ description: event.target.value })}
        />
        </label>
          <label className="job-notes-field">
            <span>个人备注</span>
            <textarea value={draft.notes} maxLength={5_000} placeholder="例如：朋友内推、关注团队稳定性、需要确认远程政策…" onChange={(event) => updateDraft({ notes: event.target.value })} />
          </label>
          <footer className="job-project-actions">
            <span>{selectedJob ? `已关联独立对话 · ${selectedJob.message_count ?? 0} 条消息` : "保存后会自动创建独立对话"}</span>
            {selectedJob ? (
              <>
                <button className="danger-text-button" onClick={() => void deleteCurrentJob(selectedJob)} disabled={jobBusy || chatBusy}>
                  <Trash2 size={14} />删除项目
                </button>
                <button className="secondary-button" onClick={cancelJobEditing} disabled={jobBusy}>
                  取消
                </button>
              </>
            ) : null}
            {!selectedJob && importPreview ? (
              <button
                className="secondary-button"
                onClick={() => setJobDetailsExpanded(false)}
                disabled={jobBusy}
              >
                返回识别结果
              </button>
            ) : null}
            <button className="secondary-button" onClick={() => void persistJob()} disabled={!hasProjectContent || jobBusy || (!dirty && Boolean(selectedJob))}>
              <Save size={14} />{jobBusy ? "保存中…" : selectedJob ? "保存修改" : "保存岗位"}
            </button>
          </footer>
                </>
              ) : null}
            </section>
          ) : null}

          {selectedJob ? (
            <>
              <JobStageNav
                activeStage={activeStage}
                analysis={analysisReady ? currentAnalysis : null}
                resumeVersions={resumeVersions}
                interviewKits={interviewKits}
                interviewRounds={interviewRounds}
                timeline={jobTimeline}
                onSelect={(stage) => stage === "analysis" ? onNavigateEvaluation(selectedJob.id) : setActiveStage(stage)}
              />

              {activeStage === "overview" ? (
                <JobOverview
                  draft={draft}
                  analysis={analysisReady ? currentAnalysis : null}
                  resumeVersions={resumeVersions}
                  interviewKits={interviewKits}
                  interviewRounds={interviewRounds}
                  timeline={jobTimeline}
                  nextActionCopy={nextActionCopy}
                  nextActionDisabled={nextAction !== "progress" && (!ready || resumeBusy || interviewBusy)}
                  nextActionTitle={!hasProfile ? "请先完成人物资料并保存简历" : !draft.description.trim() ? "请先补充岗位 JD" : undefined}
                  onNextAction={runNextAction}
                  onSelectStage={(stage) => stage === "analysis" ? onNavigateEvaluation(selectedJob.id) : setActiveStage(stage)}
                  onEdit={() => setEditingJob(true)}
                />
              ) : null}
            </>
          ) : null}

          {selectedJob && activeStage === "analysis" && !analysisReady ? (
            <section className="job-stage-empty">
              <span><Target size={24} /></span>
              <div>
                <h2>{currentAnalysis ? "岗位资料有更新，需要重新分析" : "先开始匹配分析"}</h2>
                <p>{currentAnalysis
                  ? currentAnalysis.stale_reasons.join("；") || "岗位或候选人证据已变化，请先更新匹配分析。"
                  : "分析会逐项拆解岗位要求，并只引用已确认的候选人事实和来源。"}</p>
              </div>
              <button
                disabled={!ready}
                title={!hasProfile ? "请先完成人物资料并保存简历" : !draft.description.trim() ? "请先补充岗位 JD" : undefined}
                onClick={() => void runTask("match")}
              >
                {analysisBusy ? "分析中…" : currentAnalysis ? "更新匹配分析" : "开始匹配分析"}<ArrowRight size={14} />
              </button>
            </section>
          ) : null}

      {selectedJob && activeStage === "analysis" && analysisReady ? (
        <section className="job-stage-empty">
          <span><Target size={24} /></span>
          <div><h2>匹配分析已就绪</h2><p>可查看岗位要求、匹配依据、风险和下一步建议。</p></div>
          <button onClick={() => onNavigateEvaluation(selectedJob.id)}>查看匹配分析<ArrowRight size={14} /></button>
        </section>
      ) : null}

      {selectedJob && (activeStage === "resume" || activeStage === "interview") && !analysisReady ? (
        <section className="job-stage-empty">
          <span>{activeStage === "resume" ? <FileText size={24} /> : <UsersRound size={24} />}</span>
          <div>
            <h2>需要先完成匹配分析</h2>
            <p>简历和面试内容必须建立在岗位要求与真实经历证据之上。</p>
          </div>
          <button onClick={() => onNavigateEvaluation(selectedJob.id)}>
            前往匹配分析<ArrowRight size={14} />
          </button>
        </section>
      ) : null}

      {selectedJob && activeStage === "resume" && analysisReady ? (
        <ResumeVersionPanel
          job={selectedJob}
          versions={resumeVersions}
          version={resumeVersion}
          busy={resumeBusy}
          onCreate={onCreateResumeVersion}
          onSelect={onSelectResumeVersion}
          onUpdateChange={onUpdateResumeChange}
          onUpdateVersion={onUpdateResumeVersion}
          onExport={onExportResume}
        />
      ) : null}

      {selectedJob && (
        activeStage === "progress" || (activeStage === "interview" && analysisReady)
      ) ? (
        <InterviewWorkflowPanel
          section={activeStage === "interview" ? "preparation" : "progress"}
          job={selectedJob}
          kits={interviewKits}
          kit={interviewKit}
          rounds={interviewRounds}
          timeline={jobTimeline}
          busy={interviewBusy}
          onCreateKit={onCreateInterviewKit}
          onSelectKit={onSelectInterviewKit}
          onUpdateKit={onUpdateInterviewKit}
          onToggleTask={onToggleInterviewTask}
          onCreateRound={onCreateInterviewRound}
          onUpdateRound={onUpdateInterviewRound}
          onAddNote={onAddTimelineNote}
        />
      ) : null}
        </div>
      </section>
    </section>
  );
}

type ResumeVersionPanelProps = {
  job: JobProject;
  versions: ResumeVersionSummary[];
  version: ResumeVersion | null;
  busy: boolean;
  onCreate: (job: JobProject) => Promise<ResumeVersion>;
  onSelect: (versionId: number) => Promise<void>;
  onUpdateChange: (
    versionId: number,
    changeId: number,
    patch: { decision?: ResumeChangeDecision; after_text?: string }
  ) => Promise<void>;
  onUpdateVersion: (versionId: number, status: "draft" | "final") => Promise<void>;
  onExport: (versionId: number, format: "docx" | "pdf") => Promise<void>;
};

function ResumeVersionPanel({
  job,
  versions,
  version,
  busy,
  onCreate,
  onSelect,
  onUpdateChange,
  onUpdateVersion,
  onExport
}: ResumeVersionPanelProps) {
  return (
    <section className="resume-version-panel">
      <header className="resume-version-heading">
        <div>
          <span className="analysis-kicker">定制简历版本</span>
          <h2>把岗位分析变成可投递材料</h2>
          <p>系统修改均保留证据；你的手工编辑会单独标记，原始简历不会被覆盖。</p>
        </div>
        <div className="resume-version-picker">
          {versions.length ? (
            <select
              value={version?.id ?? ""}
              disabled={busy}
              onChange={(event) => void onSelect(Number(event.target.value))}
            >
              {versions.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title} · {item.status === "final" ? "最终版" : "草稿"}
                </option>
              ))}
            </select>
          ) : null}
          <button disabled={busy} onClick={() => void onCreate(job)}>
            <Plus size={14} />新建版本
          </button>
        </div>
      </header>

      {version ? (
        <>
          <div className="resume-version-toolbar">
            <div className="resume-decision-metrics">
              <span><strong>{version.change_counts.accepted}</strong>已接受</span>
              <span><strong>{version.change_counts.rejected}</strong>已拒绝</span>
              <span><strong>{version.change_counts.pending}</strong>待确认</span>
            </div>
            <div className="resume-export-actions">
              <button
                className={version.status === "final" ? "final" : ""}
                disabled={busy}
                onClick={() => void onUpdateVersion(
                  version.id,
                  version.status === "final" ? "draft" : "final"
                )}
              >
                <FileCheck2 size={14} />
                {version.status === "final" ? "已是最终版" : "标记最终版"}
              </button>
              <button disabled={busy} onClick={() => void onExport(version.id, "docx")}>
                <Download size={14} />DOCX
              </button>
              <button disabled={busy} onClick={() => void onExport(version.id, "pdf")}>
                <Download size={14} />PDF
              </button>
            </div>
          </div>

          <div className="resume-version-layout">
            <section className="resume-change-workspace">
              <header>
                <div><h3>修改清单</h3><p>逐项核对系统建议，必要时直接编辑。</p></div>
                <small>{version.change_count} 项</small>
              </header>
              <div className="resume-change-list">
                {version.changes.map((change) => (
                  <ResumeChangeCard
                    change={change}
                    busy={busy}
                    key={change.id}
                    onUpdate={(patch) => onUpdateChange(version.id, change.id, patch)}
                  />
                ))}
              </div>
            </section>

            <section className="resume-preview-card">
              <header>
                <div><h3>当前版本预览</h3><p>待确认和已接受的内容会进入导出文件。</p></div>
                <span className={version.status}>{version.status === "final" ? "最终版" : "草稿"}</span>
              </header>
              <ResumePreview content={version.rendered_content} />
            </section>
          </div>
        </>
      ) : (
        <div className="resume-version-empty">
          <FileText size={24} />
          <strong>还没有定制简历版本</strong>
          <span>创建后可以逐项确认修改，并导出 DOCX 或 PDF。</span>
          <button disabled={busy} onClick={() => void onCreate(job)}>
            <Plus size={14} />创建第一个版本
          </button>
        </div>
      )}
    </section>
  );
}

function ResumeChangeCard({
  change,
  busy,
  onUpdate
}: {
  change: ResumeChange;
  busy: boolean;
  onUpdate: (patch: { decision?: ResumeChangeDecision; after_text?: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState(change.after_text);

  useEffect(() => {
    setDraft(change.after_text);
  }, [change.id, change.updated_at]);

  const changed = draft !== change.after_text;
  const sectionLabels: Record<ResumeChange["section_key"], string> = {
    target: "求职目标",
    summary: "职业概述",
    skills: "核心能力",
    body: "经历重排"
  };

  return (
    <article className={`resume-change-card decision-${change.decision}`}>
      <header>
        <div>
          <span>{sectionLabels[change.section_key]}</span>
          {change.user_edited ? <em><PencilLine size={11} />用户已编辑</em> : null}
        </div>
        <strong>
          {change.decision === "accepted" ? "已接受" : change.decision === "rejected" ? "已拒绝" : "待确认"}
        </strong>
      </header>
      <p>{change.rationale}</p>
      {change.before_text ? (
        <details className="resume-before-text">
          <summary>查看修改前内容</summary>
          <pre>{change.before_text}</pre>
        </details>
      ) : null}
      <label>
        <span>建议内容</span>
        <textarea
          value={draft}
          maxLength={100_000}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <details className="resume-evidence-details">
        <summary>{change.evidence.length} 条依据</summary>
        {change.evidence.map((item, index) => (
          <blockquote key={`${change.id}-evidence-${index}`}>
            <small>{item.source === "job" ? "岗位信息" : "脱敏简历证据"}</small>
            {item.excerpt}
          </blockquote>
        ))}
      </details>
      <footer>
        <button
          className="reject"
          disabled={busy}
          onClick={() => void onUpdate({ decision: "rejected" })}
        >
          <X size={13} />拒绝
        </button>
        <button
          disabled={busy}
          onClick={() => void onUpdate({ decision: "pending" })}
          title="恢复为待确认"
        >
          <RotateCcw size={13} />待确认
        </button>
        {changed ? (
          <button
            className="save-edit"
            disabled={busy}
            onClick={() => void onUpdate({ after_text: draft })}
          >
            <Save size={13} />保存编辑
          </button>
        ) : null}
        <button
          className="accept"
          disabled={busy || changed}
          title={changed ? "请先保存编辑内容" : undefined}
          onClick={() => void onUpdate({ decision: "accepted" })}
        >
          <Check size={13} />接受
        </button>
      </footer>
    </article>
  );
}

function ResumePreview({ content }: { content: string }) {
  return (
    <div className="resume-paper">
      {content.split("\n").map((line, index) => {
        const text = line.trim();
        if (!text) return <div className="resume-preview-spacer" key={`space-${index}`} />;
        if (text.startsWith("# ")) return <h2 key={index}>{text.slice(2)}</h2>;
        if (text.startsWith("## ")) return <h3 key={index}>{text.slice(3)}</h3>;
        if (text.startsWith("- ")) return <p className="resume-preview-bullet" key={index}>{text.slice(2)}</p>;
        return <p key={index}>{text}</p>;
      })}
    </div>
  );
}

const interviewTypeLabels: Record<InterviewType, string> = {
  general: "综合面试",
  hr: "HR 面试",
  business: "业务面试",
  technical: "技术面试",
  final: "终面"
};

type InterviewWorkflowPanelProps = {
  section: "preparation" | "progress";
  job: JobProject;
  kits: InterviewKitSummary[];
  kit: InterviewKit | null;
  rounds: InterviewRound[];
  timeline: JobEvent[];
  busy: boolean;
  onCreateKit: (job: JobProject, interviewType?: InterviewType) => Promise<InterviewKit>;
  onSelectKit: (kitId: number) => Promise<void>;
  onUpdateKit: (
    kitId: number,
    patch: { status?: "draft" | "ready"; self_intro?: string; notes?: string }
  ) => Promise<void>;
  onToggleTask: (kitId: number, taskId: number, completed: boolean) => Promise<void>;
  onCreateRound: (
    jobId: number,
    payload: {
      kit_id?: number;
      round_type: InterviewType;
      scheduled_at?: string;
      interviewer?: string;
      location?: string;
      notes?: string;
    }
  ) => Promise<void>;
  onUpdateRound: (
    roundId: number,
    patch: {
      status?: "scheduled" | "completed" | "cancelled";
      outcome?: "pending" | "passed" | "failed";
      notes?: string;
    }
  ) => Promise<void>;
  onAddNote: (jobId: number, title: string, detail: string) => Promise<void>;
};

function InterviewWorkflowPanel({
  section,
  job,
  kits,
  kit,
  rounds,
  timeline,
  busy,
  onCreateKit,
  onSelectKit,
  onUpdateKit,
  onToggleTask,
  onCreateRound,
  onUpdateRound,
  onAddNote
}: InterviewWorkflowPanelProps) {
  const [newKitType, setNewKitType] = useState<InterviewType>("general");

  return (
    <section className="interview-workflow-panel">
      <header className="interview-workflow-heading">
        <div>
          <span className="analysis-kicker">{section === "preparation" ? "面试重点问答" : "面试记录与复盘"}</span>
          <h2>{section === "preparation" ? "用真实经历准备重点问答" : "记录真实问题、反馈和下一步动作"}</h2>
          <p>{section === "preparation"
            ? "准备包只引用脱敏简历证据，问题预测、STAR 素材和准备清单可持续更新。"
            : "面试安排、结果和手工备注会进入当前岗位的面试时间线。"}</p>
        </div>
        {section === "preparation" ? <div className="interview-kit-picker">
          {kits.length ? (
            <select
              value={kit?.id ?? ""}
              disabled={busy}
              onChange={(event) => void onSelectKit(Number(event.target.value))}
            >
              {kits.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title} · {item.status === "ready" ? "已就绪" : "草稿"}
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={newKitType}
            disabled={busy}
            onChange={(event) => setNewKitType(event.target.value as InterviewType)}
          >
            {Object.entries(interviewTypeLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
          <button disabled={busy} onClick={() => void onCreateKit(job, newKitType)}>
            <Plus size={14} />新建准备包
          </button>
        </div> : null}
      </header>

      {section === "preparation" && kit ? (
        <div className="interview-kit-content">
          <div className="interview-kit-overview">
            <article>
              <strong>{kit.content.positioning.verified_strengths.length}</strong>
              <span>可验证优势</span>
            </article>
            <article>
              <strong>{kit.content.positioning.evidence_gaps.length}</strong>
              <span>证据缺口</span>
            </article>
            <article>
              <strong>{kit.content.questions.length}</strong>
              <span>预测问题</span>
            </article>
            <article>
              <strong>{kit.completed_task_count}/{kit.task_count}</strong>
              <span>准备进度</span>
            </article>
            <button
              className={kit.status === "ready" ? "ready" : ""}
              disabled={busy}
              onClick={() => void onUpdateKit(
                kit.id,
                { status: kit.status === "ready" ? "draft" : "ready" }
              )}
            >
              <CheckCircle2 size={14} />
              {kit.status === "ready" ? "准备包已就绪" : "标记准备就绪"}
            </button>
          </div>

          <div className="interview-preparation-grid">
            <section className="interview-primary-column">
              <InterviewIntroEditor kit={kit} busy={busy} onUpdate={onUpdateKit} />

              <section className="interview-question-section">
                <header><h3>预测问题与回答方向</h3><small>{kit.content.questions.length} 题</small></header>
                <div>
                  {kit.content.questions.map((question) => (
                    <details className={`interview-question status-${question.status}`} key={question.id}>
                      <summary>
                        <span>{question.question}</span>
                        <em>{question.status === "matched" ? "有直接证据" : question.status === "partial" ? "部分证据" : "缺少证据"}</em>
                      </summary>
                      <p><strong>为什么会问：</strong>{question.reason}</p>
                      <p><strong>回答方向：</strong>{question.answer_direction}</p>
                      {question.evidence.length ? (
                        <blockquote>{question.evidence.join("\n")}</blockquote>
                      ) : <p className="interview-gap-warning">不要虚构经历，使用相邻经验并明确能力边界。</p>}
                    </details>
                  ))}
                </div>
              </section>

              <section className="star-story-section">
                <header><h3>STAR 素材草稿</h3><small>事实由你补全</small></header>
                <div className="star-story-grid">
                  {kit.content.star_stories.map((story) => (
                    <article key={story.id}>
                      <h4>{story.title}</h4>
                      <blockquote>{story.source_excerpt}</blockquote>
                      <p><strong>S</strong>{story.situation}</p>
                      <p><strong>T</strong>{story.task}</p>
                      <p><strong>A</strong>{story.action}</p>
                      <p><strong>R</strong>{story.result}</p>
                    </article>
                  ))}
                </div>
              </section>
            </section>

            <aside className="interview-side-column">
              <section className="interview-checklist">
                <header><h3><ListChecks size={15} />准备清单</h3></header>
                {kit.tasks.map((task) => (
                  <label className={task.completed ? "completed" : ""} key={task.id}>
                    <input
                      type="checkbox"
                      checked={Boolean(task.completed)}
                      disabled={busy}
                      onChange={(event) => void onToggleTask(
                        kit.id,
                        task.id,
                        event.target.checked
                      )}
                    />
                    <span>{task.title}</span>
                  </label>
                ))}
              </section>

              <section className="reverse-question-section">
                <header><h3>反向提问</h3></header>
                <ol>
                  {kit.content.reverse_questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ol>
              </section>

              <section className="interview-limitations">
                <strong>使用边界</strong>
                {kit.content.limitations.map((item) => <span key={item}>{item}</span>)}
              </section>
            </aside>
          </div>
        </div>
      ) : section === "preparation" ? (
        <div className="interview-kit-empty">
          <UsersRound size={25} />
          <strong>还没有面试重点问答</strong>
          <span>选择面试类型生成重点问题、回答方向和真实经历证据。</span>
        </div>
      ) : null}

      {section === "progress" ? <div className="interview-progress-grid">
        <section className="interview-rounds-card">
          <header>
            <div><h3><CalendarDays size={16} />面试轮次</h3><p>记录安排、完成状态和结果。</p></div>
            <small>{rounds.length} 轮</small>
          </header>
          <InterviewRoundForm
            jobId={job.id}
            kitId={kit?.id}
            busy={busy}
            onCreate={onCreateRound}
          />
          <div className="interview-round-list">
            {rounds.map((round) => (
              <article key={round.id}>
                <div className="round-marker" />
                <div>
                  <strong>{interviewTypeLabels[round.round_type]}</strong>
                  <span>{round.scheduled_at ? formatLocalDate(round.scheduled_at) : "时间待定"}</span>
                  <small>{[round.interviewer, round.location].filter(Boolean).join(" · ") || "面试信息待补充"}</small>
                </div>
                <select
                  value={round.outcome}
                  disabled={busy}
                  onChange={(event) => void onUpdateRound(round.id, {
                    status: event.target.value === "pending" ? "scheduled" : "completed",
                    outcome: event.target.value as InterviewRound["outcome"]
                  })}
                >
                  <option value="pending">待进行</option>
                  <option value="passed">已通过</option>
                  <option value="failed">未通过</option>
                </select>
              </article>
            ))}
            {!rounds.length ? <span className="empty-list-note">尚未记录面试轮次。</span> : null}
          </div>
        </section>

        <section className="job-timeline-card">
          <header>
            <div><h3>面试时间线</h3><p>每轮面试、状态和后续动作统一记录。</p></div>
            <small>{timeline.length} 条</small>
          </header>
          <TimelineNoteForm jobId={job.id} busy={busy} onAdd={onAddNote} />
          <div className="job-timeline-list">
            {timeline.map((event) => (
              <article key={event.id}>
                <span />
                <div>
                  <strong>{event.title}</strong>
                  {event.detail ? <p>{event.detail}</p> : null}
                  <small>{formatLocalDate(event.occurred_at)}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div> : null}
    </section>
  );
}

function InterviewIntroEditor({
  kit,
  busy,
  onUpdate
}: {
  kit: InterviewKit;
  busy: boolean;
  onUpdate: InterviewWorkflowPanelProps["onUpdateKit"];
}) {
  const [intro, setIntro] = useState(kit.content.self_intro);
  const [notes, setNotes] = useState(kit.notes);

  useEffect(() => {
    setIntro(kit.content.self_intro);
    setNotes(kit.notes);
  }, [kit.id, kit.updated_at]);

  const changed = intro !== kit.content.self_intro || notes !== kit.notes;
  return (
    <section className="interview-intro-editor">
      <header>
        <div><h3>自我介绍</h3><p>系统只组织可验证信息，你可以改成自己的表达。</p></div>
        {kit.content.self_intro_user_edited ? <span><PencilLine size={11} />用户已编辑</span> : null}
      </header>
      <textarea value={intro} disabled={busy} onChange={(event) => setIntro(event.target.value)} />
      <label>
        <span>准备备注</span>
        <textarea value={notes} disabled={busy} placeholder="例如：重点练习商业化案例、准备英文版本…" onChange={(event) => setNotes(event.target.value)} />
      </label>
      <button disabled={busy || !changed} onClick={() => void onUpdate(kit.id, { self_intro: intro, notes })}>
        <Save size={13} />保存准备内容
      </button>
    </section>
  );
}

function InterviewRoundForm({
  jobId,
  kitId,
  busy,
  onCreate
}: {
  jobId: number;
  kitId?: number;
  busy: boolean;
  onCreate: InterviewWorkflowPanelProps["onCreateRound"];
}) {
  const [roundType, setRoundType] = useState<InterviewType>("hr");
  const [scheduledAt, setScheduledAt] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [location, setLocation] = useState("");

  async function submit() {
    await onCreate(jobId, {
      kit_id: kitId,
      round_type: roundType,
      scheduled_at: scheduledAt || undefined,
      interviewer,
      location
    });
    setScheduledAt("");
    setInterviewer("");
    setLocation("");
  }

  return (
    <div className="interview-round-form">
      <select value={roundType} disabled={busy} onChange={(event) => setRoundType(event.target.value as InterviewType)}>
        {Object.entries(interviewTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
      <input type="datetime-local" value={scheduledAt} disabled={busy} onChange={(event) => setScheduledAt(event.target.value)} />
      <input value={interviewer} maxLength={200} disabled={busy} placeholder="面试官/联系人" onChange={(event) => setInterviewer(event.target.value)} />
      <input value={location} maxLength={300} disabled={busy} placeholder="地点或会议方式" onChange={(event) => setLocation(event.target.value)} />
      <button disabled={busy} onClick={() => void submit()}><Plus size={13} />添加轮次</button>
    </div>
  );
}

function TimelineNoteForm({
  jobId,
  busy,
  onAdd
}: {
  jobId: number;
  busy: boolean;
  onAdd: InterviewWorkflowPanelProps["onAddNote"];
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");

  async function submit() {
    if (!title.trim()) return;
    await onAdd(jobId, title, detail);
    setTitle("");
    setDetail("");
  }

  return (
    <div className="timeline-note-form">
      <input value={title} maxLength={200} disabled={busy} placeholder="记录进展，例如：已发送感谢邮件" onChange={(event) => setTitle(event.target.value)} />
      <input value={detail} maxLength={5_000} disabled={busy} placeholder="补充说明（可选）" onChange={(event) => setDetail(event.target.value)} />
      <button disabled={busy || !title.trim()} onClick={() => void submit()}><Send size={13} />记录</button>
    </div>
  );
}

function formatLocalDate(value: string) {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

type DashboardViewProps = {
  workflow: WorkflowStatus | null;
  conversations: Conversation[];
  jobs: JobProject[];
  onOpenConversation: (conversationId: number) => void;
};

const stageStatusLabels: Record<WorkflowNode["status"], string> = {
  done: "已完成",
  running: "进行中",
  pending: "未开始",
  blocked: "已阻止"
};

function WorkflowStagePanel({ nodes }: { nodes: WorkflowNode[] }) {
  if (!nodes.length) return null;
  const done = nodes.filter((node) => node.status === "done").length;
  return (
    <section className="workflow-stage-panel" aria-label="求职流程阶段">
      <div className="section-heading">
        <div><div><h3>求职流程阶段</h3></div></div>
        <small>{done}/{nodes.length} 个阶段完成</small>
      </div>
      <ol className="workflow-stage-list">
        {nodes.map((node) => (
          <li key={node.id}>
            <i className={node.status} />
            <div>
              <strong>{node.title}</strong>
              <small>{node.detail || node.hint}</small>
            </div>
            <em>{stageStatusLabels[node.status] ?? node.status}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DashboardView({
  workflow,
  conversations,
  jobs,
  onOpenConversation
}: DashboardViewProps) {
  const stageCounts = workflow?.stage_counts;
  const counts = workflow?.counts;
  const stageCount = (stageId: string, legacy?: number) => stageCounts?.[stageId] ?? legacy ?? 0;
  const cards = [
    { label: "岗位项目", value: jobs.length, icon: <Building2 size={18} />, note: `${jobs.filter((job) => job.priority === "high").length} 个高优先级` },
    { label: "岗位评估", value: stageCount("job_evaluation", counts?.jd_analyses), icon: <Target size={18} />, note: "当前对话累计" },
    { label: "定制简历", value: stageCount("material_preparation", counts?.tailored_resume_generations), icon: <FileText size={18} />, note: "高匹配文本" },
    { label: "面试准备", value: stageCount("interview_preparation", counts?.interview_advice_generations), icon: <UsersRound size={18} />, note: "个人化建议" },
    { label: "面试进程", value: jobs.filter((job) => job.status === "interviewing").length, icon: <CalendarDays size={18} />, note: "当前岗位项目" },
    { label: "活跃对话", value: conversations.filter((item) => item.status === "active").length, icon: <MessageCircle size={18} />, note: "可继续追问" }
  ];

  return (
    <section className="dashboard-page">
      <div className="dashboard-hero">
        <div><h2>综合控制台</h2></div>
        <span className="dashboard-badge"><BarChart3 size={17} />本地求职数据</span>
      </div>

      <div className="metric-grid">
        {cards.map((card) => (
          <article className="metric-card" key={card.label}>
            <span>{card.icon}</span>
            <div><small>{card.label}</small><strong>{card.value}</strong><p>{card.note}</p></div>
          </article>
        ))}
      </div>

      <WorkflowStagePanel nodes={workflow?.nodes ?? []} />

      <section className="dashboard-history">
        <div className="section-heading">
          <div><div><h3>最近任务</h3></div></div>
          <small>{conversations.length} 条记录</small>
        </div>
        {conversations.length ? (
          <div className="dashboard-history-list">
            {conversations.slice(0, 8).map((conversation) => (
              <button key={conversation.id} onClick={() => onOpenConversation(conversation.id)}>
                <span className={conversation.status} />
                <div><strong>{conversation.title}</strong><small>{conversation.message_count ?? 0} 条消息 · {conversation.task_status === "active" ? "任务进行中" : conversation.status === "archived" ? "已归档" : "可继续"}</small></div>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty"><BarChart3 size={24} /><span>完成第一次岗位分析后，任务记录会显示在这里。</span></div>
        )}
      </section>
    </section>
  );
}
