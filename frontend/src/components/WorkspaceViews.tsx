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
  ResumeTemplate,
  ResumeVersion,
  ResumeVersionSummary,
  QuickMatchResult,
  WorkflowNode,
  WorkflowStatus
} from "../types";
import {
  priorityLabels,
  type WorkbenchStage
} from "../features/jobs/JobWorkspaceChrome";
import { ActionButton } from "./ui/ActionButton";
import { composeJobDescription, splitJobDescription } from "../features/jobs/job-description";
import { RESUME_ANALYSIS_OUTLINE, ResumeAnalysisResult } from "../features/jobs/ResumeAnalysisResult";

type WorkbenchViewProps = {
  viewMode: "index" | "new" | "detail";
  hasProfile: boolean;
  resumeFilename?: string;
  resumeText?: string;
  profileName?: string;
  resumeLoading?: boolean;
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
  onQuickMatch: (payload: {
    job_description: string;
    job_title?: string;
    company_name?: string;
  }) => Promise<QuickMatchResult>;
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
    patch: { status?: "draft" | "final"; template_id?: ResumeTemplate }
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
  onOpenProfile?: () => void;
};

const emptyJobDraft: JobProjectDraft = {
  job_title: "",
  company_name: "",
  location: "",
  salary_text: "",
  source_url: "",
  description: "",
  notes: "",
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

function firstResumeLine(text?: string): string {
  const line = (text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean) || "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

function isJobMatchResult(result: QuickMatchResult | null): boolean {
  if (!result) return false;
  return result.analysis.mode === "job_match" || result.job.description_character_count >= 20;
}

function isWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function WorkbenchView({
  viewMode,
  hasProfile,
  resumeFilename,
  resumeText,
  profileName,
  resumeLoading,
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
  onQuickMatch,
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
  onAddTimelineNote,
  onOpenProfile
}: WorkbenchViewProps) {
  const [draft, setDraft] = useState<JobProjectDraft>(emptyJobDraft);
  const [dirty, setDirty] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [browserImportUrl, setBrowserImportUrl] = useState("");
  const [pastedJobText, setPastedJobText] = useState("");
  const [pasteJobTextOpen, setPasteJobTextOpen] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<JobImportPreview | null>(null);
  const [importDescriptionExpanded, setImportDescriptionExpanded] = useState(false);
  const [editingJob, setEditingJob] = useState(true);
  const [jobDetailsExpanded, setJobDetailsExpanded] = useState(false);
  const [activeStage, setActiveStage] = useState<WorkbenchStage>("analysis");
  const [jobSearch, setJobSearch] = useState("");
  const [comparisonJobs, setComparisonJobs] = useState<number[]>([]);
  const [quickMatchInput, setQuickMatchInput] = useState("");
  const [quickMatchPreview, setQuickMatchPreview] = useState<JobImportPreview | null>(null);
  const [quickMatchBrowserUrl, setQuickMatchBrowserUrl] = useState("");
  const [quickMatchBrowserTabId, setQuickMatchBrowserTabId] = useState<number | null>(null);
  const [quickMatchResult, setQuickMatchResult] = useState<QuickMatchResult | null>(null);
  const [quickMatchError, setQuickMatchError] = useState("");
  const [quickMatchBusy, setQuickMatchBusy] = useState(false);
  const [requirementsText, setRequirementsText] = useState("");
  const [jobMatchOpen, setJobMatchOpen] = useState(false);
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
    setActiveStage("analysis");
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJob) {
      setDraft(emptyJobDraft);
      setRequirementsText("");
      setDirty(false);
      setEditingJob(true);
      setImportUrl("");
      setBrowserImportUrl("");
      setPastedJobText("");
      setPasteJobTextOpen(false);
      setImportWarnings([]);
      setImportPreview(null);
      setImportDescriptionExpanded(false);
      setJobDetailsExpanded(false);
      return;
    }
    const parts = splitJobDescription(selectedJob.description);
    setDraft({ ...jobToDraft(selectedJob), description: parts.description });
    setRequirementsText(parts.requirements);
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
    const nextDraft = {
      ...draft,
      description: composeJobDescription(draft.description, requirementsText)
    };
    setDraft({ ...nextDraft, description: draft.description });
    const saved = await onSaveJob(nextDraft, existingJobId);
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
    const parts = splitJobDescription(selectedJob.description);
    setDraft({ ...jobToDraft(selectedJob), description: parts.description });
    setRequirementsText(parts.requirements);
    setDirty(false);
    setEditingJob(false);
  }

  function startNewJob() {
    setDraft(emptyJobDraft);
    setDirty(false);
    setEditingJob(true);
    setActiveStage("analysis");
    setImportUrl("");
    setBrowserImportUrl("");
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
      setBrowserImportUrl(url);
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
      await onOpenJobInBrowser(browserImportUrl || importPreview.final_url || importPreview.source_url);
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
        browserImportUrl || importPreview.final_url || importPreview.source_url,
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
    draft.job_title.trim() && draft.description.trim() && requirementsText.trim()
  );
  const analyzing = jobBusy || analysisBusy || quickMatchBusy;
  const ready = hasProfile && !chatBusy && !analyzing;

  async function runResumeAnalysis() {
    if (!ready) return;
    setQuickMatchBusy(true);
    setQuickMatchError("");
    try {
      const result = await onQuickMatch({
        job_description: composeJobDescription(draft.description, requirementsText),
        job_title: draft.job_title.trim(),
        company_name: draft.company_name.trim()
      });
      setQuickMatchResult(result);
      if (isJobMatchResult(result)) setJobMatchOpen(false);
    } catch (error) {
      setQuickMatchError(error instanceof Error ? error.message : "分析失败，请稍后重试。");
    } finally {
      setQuickMatchBusy(false);
    }
  }
  const nextAction: WorkbenchStage = !analysisReady
    ? "analysis"
    : !resumeVersions.length
      ? "resume"
      : "interview";
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
      title: "围绕真实经历准备面试",
      description: "根据岗位要求和真实简历证据，生成重点问题、回答框架和追问提示。",
      action: "生成面试准备"
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
    }
  }

  const visibleJobs = jobs.filter((job) => {
    const query = jobSearch.trim().toLowerCase();
    const matchesSearch = !query || [job.job_title, job.company_name, job.location]
      .some((value) => value.toLowerCase().includes(query));
    return matchesSearch;
  });
  const comparisonStrategyId = jobs.find((job) => comparisonJobs.includes(job.id))?.latest_evaluation_strategy_id;

  async function compareSelectedJobs() {
    const selected = jobs.filter((job) => comparisonJobs.includes(job.id));
    const evaluationIds = selected.map((job) => job.latest_evaluation_id).filter((id): id is number => Boolean(id));
    if (evaluationIds.length < 2) return;
    await onCreateComparison(evaluationIds);
  }

  async function analyzeQuickMatchPreview(preview: JobImportPreview) {
    setQuickMatchPreview(preview);
    if (preview.status === "browser_required") {
      setQuickMatchError("该岗位页需要在 Chrome 中登录或完成验证后读取。");
      return;
    }
    if (stoppedImportStatuses.has(preview.status)) {
      setQuickMatchError(preview.stop_reason || preview.warnings[0] || "未能读取到可用于分析的岗位内容。");
      return;
    }
    if (preview.description.trim().length < 20) {
      setQuickMatchError(preview.warnings[0] || "未能识别到足够的岗位描述，请粘贴职责和任职要求后重试。");
      return;
    }
    setQuickMatchResult(await onQuickMatch({
      job_description: preview.description,
      job_title: preview.job_title,
      company_name: preview.company_name
    }));
  }

  async function submitQuickMatch() {
    const input = quickMatchInput.trim();
    if (!input || quickMatchBusy || jobImportBusy) return;
    setQuickMatchBusy(true);
    setQuickMatchError("");
    setQuickMatchResult(null);
    setQuickMatchPreview(null);
    setQuickMatchBrowserTabId(null);
    setQuickMatchBrowserUrl(isWebUrl(input) ? input : "");
    try {
      const preview = isWebUrl(input)
        ? await onPreviewJobUrl(input)
        : await onPreviewJobText(input);
      await analyzeQuickMatchPreview(preview);
    } catch (error) {
      setQuickMatchError(error instanceof Error ? error.message : "快速匹配失败，请稍后重试。");
    } finally {
      setQuickMatchBusy(false);
    }
  }

  async function continueQuickMatchInBrowser() {
    if (!quickMatchPreview || quickMatchBusy || jobImportBusy) return;
    setQuickMatchBusy(true);
    setQuickMatchError("");
    try {
      if (quickMatchBrowserTabId == null) {
        const browserPage = await onOpenJobInBrowser(
          quickMatchBrowserUrl || quickMatchPreview.final_url || quickMatchPreview.source_url
        );
        setQuickMatchBrowserTabId(browserPage.tabId);
        return;
      }
      const preview = await onPreviewJobFromBrowser(
        quickMatchBrowserUrl || quickMatchPreview.final_url || quickMatchPreview.source_url,
        quickMatchBrowserTabId
      );
      await analyzeQuickMatchPreview(preview);
    } catch (error) {
      setQuickMatchError(error instanceof Error ? error.message : "无法从 Chrome 读取岗位页面。");
    } finally {
      setQuickMatchBusy(false);
    }
  }

  async function quickMatchFromScreenshot(file: File) {
    if (quickMatchBusy || jobImportBusy) return;
    setQuickMatchBusy(true);
    setQuickMatchError("");
    setQuickMatchResult(null);
    setQuickMatchBrowserTabId(null);
    setQuickMatchBrowserUrl("");
    try {
      const preview = await onPreviewJobScreenshot(file);
      await analyzeQuickMatchPreview(preview);
    } catch (error) {
      setQuickMatchError(error instanceof Error ? error.message : "岗位截图识别失败，请稍后重试。");
    } finally {
      setQuickMatchBusy(false);
    }
  }

  if (viewMode === "index") {
    const resumeTitle = resumeFilename || profileName || "已保存的简历";
    const resumeChars = (resumeText || "").trim().length;
    const resumePreview = firstResumeLine(resumeText);
    const analyzeLabel = analyzing ? "分析中…" : quickMatchResult ? "重新分析" : "开始分析";
    const hasJobInput = Boolean(
      draft.job_title.trim() || draft.description.trim() || requirementsText.trim()
    );
    const showJobPrompt = Boolean(quickMatchResult && !isJobMatchResult(quickMatchResult));
    return (
      <section className="job-project-index resume-analysis-workspace">
        {resumeLoading ? (
          <article className="resume-source-card" aria-busy="true">
            <header>
              <span className="resume-source-icon"><LoaderCircle className="spinning" size={20} /></span>
              <div>
                <p className="resume-analysis-kicker">分析对象</p>
                <h2>正在读取已保存的简历</h2>
                <p>分析会使用个人资料里的简历，不需要在这里再上传。</p>
              </div>
              <button className="primary-button" type="button" disabled>
                <Target size={15} />开始分析
              </button>
            </header>
          </article>
        ) : hasProfile ? (
          <article className="resume-source-card">
            <header>
              <span className="resume-source-icon"><FileCheck2 size={20} /></span>
              <div>
                <p className="resume-analysis-kicker">分析对象</p>
                <h2>{resumeTitle}</h2>
                <p>
                  {[
                    profileName && profileName !== resumeTitle ? profileName : null,
                    resumeChars ? `${resumeChars.toLocaleString("zh-CN")} 字` : null,
                    "已保存，可分析"
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={() => void runResumeAnalysis()}
                disabled={!ready}
              >
                {analyzing ? <LoaderCircle className="spinning" size={15} /> : <Target size={15} />}
                {analyzeLabel}
              </button>
            </header>
            {resumePreview ? (
              <blockquote className="resume-source-preview">{resumePreview}</blockquote>
            ) : (
              <p className="resume-source-empty-preview">已保存简历，开始分析后会引用其中的原句。</p>
            )}
            {onOpenProfile ? (
              <button className="resume-source-open" type="button" onClick={onOpenProfile}>
                <FileText size={14} />查看简历
              </button>
            ) : null}
          </article>
        ) : (
          <div className="job-index-profile-warning">
            <AlertTriangle size={16} />
            <div><strong>还没有可用简历</strong><span>请先在个人资料中上传并保存简历，再回来分析。</span></div>
            {onOpenProfile ? <button type="button" onClick={onOpenProfile}>去个人资料</button> : null}
          </div>
        )}

        {quickMatchError ? <p className="inline-error">{quickMatchError}</p> : null}
        {quickMatchResult ? (
          <ResumeAnalysisResult result={quickMatchResult} onEditProfile={onOpenProfile} />
        ) : (
          <section
            className={`resume-analysis-outline${analyzing ? " is-analyzing" : ""}`}
            aria-label="将分析"
          >
            <header>
              <p className="resume-analysis-kicker">{analyzing ? "正在分析" : "将分析"}</p>
              <h3>四段报告</h3>
            </header>
            <ol>
              {RESUME_ANALYSIS_OUTLINE.map((section) => (
                <li key={section.number}>
                  <span aria-hidden="true">{section.number}</span>
                  <div>
                    <strong>{section.title}</strong>
                    <small>{section.question}</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {showJobPrompt ? (
          <aside className={`resume-job-prompt${jobMatchOpen ? " open" : ""}`}>
            {jobMatchOpen ? (
              <>
                <header>
                  <div>
                    <p className="resume-analysis-kicker">需要时再填</p>
                    <h3>对照这份岗位</h3>
                  </div>
                  <button type="button" onClick={() => setJobMatchOpen(false)}>收起</button>
                </header>
                <div className="job-project-fields">
                  <label>
                    <span>岗位名称</span>
                    <input value={draft.job_title} maxLength={200} placeholder="例如：AI 产品经理" onChange={(event) => updateDraft({ job_title: event.target.value })} />
                  </label>
                  <label>
                    <span>公司名称</span>
                    <input value={draft.company_name} maxLength={200} placeholder="选填" onChange={(event) => updateDraft({ company_name: event.target.value })} />
                  </label>
                </div>
                <label className="job-description-field">
                  <span>岗位描述</span>
                  <textarea
                    value={draft.description}
                    maxLength={50_000}
                    placeholder="岗位职责、团队背景、工作内容…"
                    onChange={(event) => updateDraft({ description: event.target.value })}
                  />
                </label>
                <label className="job-description-field">
                  <span>任职要求</span>
                  <textarea
                    value={requirementsText}
                    maxLength={50_000}
                    placeholder="技能、经验、学历或其他硬性要求…"
                    onChange={(event) => {
                      setRequirementsText(event.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
                <footer>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void runResumeAnalysis()}
                    disabled={!ready || !hasJobInput}
                  >
                    {analyzing ? <LoaderCircle className="spinning" size={15} /> : <Target size={15} />}
                    {analyzing ? "分析中…" : "对照分析"}
                  </button>
                </footer>
              </>
            ) : (
              <>
                <p>要对照某份岗位吗？</p>
                <button type="button" onClick={() => setJobMatchOpen(true)}>填写岗位</button>
              </>
            )}
          </aside>
        ) : null}

        {visibleJobs.length ? (
          <section className="job-index-list-section">
            <header>
              <div><h3>最近分析</h3><span>{visibleJobs.length} 份</span></div>
              <div className="job-index-controls">
                <label className="job-index-search"><Search size={15} /><input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="搜索岗位或公司" /></label>
              </div>
            </header>
            <div className="job-index-grid">
              {visibleJobs.map((job) => (
                <article className="job-index-card-wrap" key={job.id}>
                  <button
                    type="button"
                    className="job-index-card"
                    onClick={() => job.latest_evaluation_id ? onNavigateEvaluation(job.id) : openJob(job.id)}
                  >
                    <div><h3>{job.job_title || "未命名岗位"}</h3><p>{job.company_name || "未填写公司"}</p></div>
                    <footer>
                      <span>{job.latest_evaluation_id ? "分析已完成" : "尚未分析"}</span>
                      <em>{job.latest_evaluation_id ? "查看结果" : "继续分析"}<ArrowRight size={14} /></em>
                    </footer>
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    );
  }

  if (viewMode === "detail" && !selectedJob) {
    return (
      <section className="workbench-page job-project-subpage">
        <header className="job-subpage-nav">
          <button type="button" onClick={onNavigateIndex}><ArrowLeft size={15} />返回简历分析</button>
          <span>/</span><strong>分析结果</strong>
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
          <button type="button" onClick={onNavigateIndex}><ArrowLeft size={15} />返回简历分析</button>
          <span>/</span><strong>新的分析</strong>
        </header>
        <section className="flow-step jd-entry-card">
          <div className="job-project-fields">
            <label>
              <span>岗位名称 <em>选填</em></span>
              <input value={draft.job_title} maxLength={200} placeholder="选填，有具体岗位再对照" onChange={(event) => updateDraft({ job_title: event.target.value })} />
            </label>
            <label>
              <span>公司名称 <em>选填</em></span>
              <input value={draft.company_name} maxLength={200} placeholder="选填" onChange={(event) => updateDraft({ company_name: event.target.value })} />
            </label>
          </div>
          <label className="job-description-field">
            <span>岗位描述 <em>选填</em></span>
            <textarea
              value={draft.description}
              maxLength={50_000}
              placeholder="选填，有具体岗位再对照"
              onChange={(event) => updateDraft({ description: event.target.value })}
            />
          </label>
          <label className="job-description-field">
            <span>任职要求 <em>选填</em></span>
            <textarea
              value={requirementsText}
              maxLength={50_000}
              placeholder="选填，有具体岗位再对照"
              onChange={(event) => {
                setRequirementsText(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <footer className="job-project-actions">
            <span>{!hasProfile ? "分析前请先上传简历" : "没有岗位也可以先分析已保存的简历"}</span>
            <button
              className="primary-button"
              onClick={() => void runResumeAnalysis()}
              disabled={!ready}
            >
              {analyzing ? <LoaderCircle className="spinning" size={14} /> : <Target size={14} />}
              {analyzing ? "分析中…" : "开始分析"}
            </button>
          </footer>
        </section>
        {quickMatchError ? <p className="inline-error">{quickMatchError}</p> : null}
        {quickMatchResult ? <ResumeAnalysisResult result={quickMatchResult} onEditProfile={onOpenProfile} /> : null}
      </section>
    );
  }

  return (
    <section className="workbench-page job-project-subpage">
      <header className="job-subpage-nav">
        <button type="button" onClick={onNavigateIndex}><ArrowLeft size={15} />返回简历分析</button>
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

          {editingJob && selectedJob ? (
            <section className={`flow-step jd-entry-card ${draft.description.trim() ? "complete" : ""}`}>
              <header className="flow-step-heading">
                <span className="flow-step-number"><PencilLine size={15} /></span>
                <div>
                  <h2>编辑岗位</h2>
                  <p>修改岗位描述和任职要求。后续分析会使用最新内容。</p>
                </div>
              </header>
              <div className="job-project-fields">
                <label>
                  <span>岗位名称</span>
                  <input value={draft.job_title} maxLength={200} placeholder="例如：AI 产品经理" onChange={(event) => updateDraft({ job_title: event.target.value })} />
                </label>
                <label>
                  <span>公司名称</span>
                  <input value={draft.company_name} maxLength={200} placeholder="选填" onChange={(event) => updateDraft({ company_name: event.target.value })} />
                </label>
              </div>
              <label className="job-description-field">
                <span>岗位描述 <em>必填</em></span>
                <textarea
                  value={draft.description}
                  maxLength={50_000}
                  placeholder="岗位职责、团队背景、工作内容…"
                  onChange={(event) => updateDraft({ description: event.target.value })}
                />
              </label>
              <label className="job-description-field">
                <span>任职要求 <em>必填</em></span>
                <textarea
                  value={requirementsText}
                  maxLength={50_000}
                  placeholder="技能、经验、学历或其他硬性要求…"
                  onChange={(event) => {
                    setRequirementsText(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <footer className="job-project-actions">
                <span>已关联独立对话 · {selectedJob.message_count ?? 0} 条消息</span>
                <button className="danger-text-button" onClick={() => void deleteCurrentJob(selectedJob)} disabled={jobBusy || chatBusy}>
                  <Trash2 size={14} />删除项目
                </button>
                <button className="secondary-button" onClick={cancelJobEditing} disabled={jobBusy}>
                  取消
                </button>
                <button className="secondary-button" onClick={() => void persistJob()} disabled={!hasProjectContent || jobBusy || !dirty}>
                  <Save size={14} />{jobBusy ? "保存中…" : "保存修改"}
                </button>
              </footer>
            </section>
          ) : null}

          {selectedJob && !analysisReady ? (
            <section className="job-stage-empty">
              <span><Target size={24} /></span>
              <div>
                <h2>{currentAnalysis ? "岗位或简历有更新，需要重新分析" : "还没有这份岗位的简历分析"}</h2>
                <p>{currentAnalysis
                  ? currentAnalysis.stale_reasons.join("；") || "岗位或简历已变化，请先更新分析。"
                  : "分析会对照岗位要求与已保存的简历，标出匹配、缺口和证据。"}</p>
              </div>
              <button
                disabled={!ready}
                title={!hasProfile ? "请先完成个人资料并保存简历" : !draft.description.trim() ? "请先补充岗位描述" : undefined}
                onClick={() => void runTask("match")}
              >
                {analysisBusy ? "分析中…" : currentAnalysis ? "更新分析" : "开始分析"}<ArrowRight size={14} />
              </button>
            </section>
          ) : null}

      {selectedJob && analysisReady ? (
        <section className="job-stage-empty">
          <span><Target size={24} /></span>
          <div><h2>简历分析已完成</h2><p>查看匹配、缺口、证据和下一步建议。</p></div>
          <button onClick={() => onNavigateEvaluation(selectedJob.id)}>查看分析结果<ArrowRight size={14} /></button>
        </section>
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
  onUpdateVersion: (
    versionId: number,
    patch: { status?: "draft" | "final"; template_id?: ResumeTemplate }
  ) => Promise<void>;
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
  const [previewEdits, setPreviewEdits] = useState<Record<number, string>>({});

  useEffect(() => {
    setPreviewEdits({});
  }, [version?.id, version?.updated_at]);

  const previewContent = version
    ? version.changes
      .map((change) => change.decision === "rejected"
        ? change.before_text
        : previewEdits[change.id] ?? change.after_text)
      .filter(Boolean)
      .join("\n\n")
    : "";

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
                  { status: version.status === "final" ? "draft" : "final" }
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
                    onDraftChange={(value) => setPreviewEdits((current) => ({ ...current, [change.id]: value }))}
                    onUpdate={(patch) => onUpdateChange(version.id, change.id, patch)}
                  />
                ))}
              </div>
            </section>

            <section className="resume-preview-card">
              <header>
                <div><h3>当前版本预览</h3><p>编辑建议内容时，预览会即时更新。</p></div>
                <span className={version.status}>{version.status === "final" ? "最终版" : "草稿"}</span>
              </header>
              <label className="resume-template-picker">
                <span>版式模板</span>
                <select
                  value={version.template_id}
                  disabled={busy}
                  onChange={(event) => void onUpdateVersion(version.id, {
                    template_id: event.target.value as ResumeTemplate
                  })}
                >
                  <option value="classic">经典专业</option>
                  <option value="compact">紧凑一页</option>
                  <option value="minimal">极简黑白</option>
                </select>
              </label>
              <ResumePreview content={previewContent} templateId={version.template_id} />
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
  onDraftChange,
  onUpdate
}: {
  change: ResumeChange;
  busy: boolean;
  onDraftChange: (value: string) => void;
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
          onChange={(event) => {
            setDraft(event.target.value);
            onDraftChange(event.target.value);
          }}
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

function ResumePreview({ content, templateId }: { content: string; templateId: ResumeTemplate }) {
  return (
    <div className={`resume-paper template-${templateId}`}>
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
  nextStep: {
    title: string;
    detail: string;
    action: string;
  };
  onNextStep: () => void;
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
  nextStep,
  onNextStep,
  onOpenConversation
}: DashboardViewProps) {
  const stageCounts = workflow?.stage_counts;
  const counts = workflow?.counts;
  const stageCount = (stageId: string, legacy?: number) => stageCounts?.[stageId] ?? legacy ?? 0;
  const recentConversations = conversations.filter((conversation) => (conversation.message_count ?? 0) > 0);
  const cards = [
    { label: "岗位项目", value: jobs.length, icon: <Building2 size={18} />, note: `${jobs.filter((job) => job.priority === "high").length} 个高优先级` },
    { label: "岗位评估", value: stageCount("job_evaluation", counts?.jd_analyses), icon: <Target size={18} />, note: "当前对话累计" },
    { label: "定制简历", value: stageCount("material_preparation", counts?.tailored_resume_generations), icon: <FileText size={18} />, note: "高匹配文本" },
    { label: "面试准备", value: stageCount("interview_preparation", counts?.interview_advice_generations), icon: <UsersRound size={18} />, note: "个人化建议" }
  ];

  return (
    <section className="dashboard-page">
      <div className="dashboard-hero" aria-labelledby="dashboard-next-step-title">
        <div>
          <span className="eyebrow">建议下一步</span>
          <h2 id="dashboard-next-step-title">{nextStep.title}</h2>
          <p>{nextStep.detail}</p>
        </div>
        <ActionButton variant="primary" icon={<ArrowRight size={16} />} onClick={onNextStep}>
          {nextStep.action}
        </ActionButton>
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
          <small>{recentConversations.length} 条记录</small>
        </div>
        {recentConversations.length ? (
          <div className="dashboard-history-list">
            {recentConversations.slice(0, 8).map((conversation) => (
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
