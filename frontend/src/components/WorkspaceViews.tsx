import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  GripVertical,
  ImagePlus,
  Link2,
  ListChecks,
  LoaderCircle,
  MapPin,
  Minus,
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
  JobImportPreview,
  JobProject,
  JobProjectDraft,
  ResumeChange,
  ResumeChangeDecision,
  ResumeLayoutSettings,
  ResumeStyle,
  ResumeTemplate,
  ResumeVersion,
  ResumeVersionSummary,
  QuickMatchResult,
} from "../types";
import {
  priorityLabels,
  type WorkbenchStage
} from "../features/jobs/JobWorkspaceChrome";
import { ActionButton } from "./ui/ActionButton";
import { SectionHeader } from "./ui/SectionHeader";
import { WorkbenchModuleNav, type WorkbenchModule } from "./WorkbenchModuleNav";
import { composeJobDescription, splitJobDescription } from "../features/jobs/job-description";
import { AnalysisThinkingProcess } from "../features/jobs/AnalysisThinkingProcess";
import {
  applyAnalysisRunEvent,
  completeStepsFromResult,
  initialAnalysisSteps,
  stepStatusLabel,
  thinkingTask,
  thinkingTitle,
  type AnalysisRunEvent,
  type AnalysisStepView
} from "../features/jobs/analysis-run";
import { ResumeAnalysisResult } from "../features/jobs/ResumeAnalysisResult";
import { InterviewQaEmpty, InterviewQaWorkspace } from "../features/jobs/InterviewQaWorkspace";
import { latestStartedKitId } from "../features/jobs/interview-setup";
import {
  buildResumePreviewBlocks,
  estimateResumePreviewHeights,
  paginateResumePreview,
  type ResumePreviewBlock
} from "../features/settings/resume-pagination";
import {
  addResumeModule,
  composeResumeEditor,
  moveResumeModule,
  parseResumeEditor,
  projectOrdinalLabel,
  removeResumeModule,
  splitDocumentName,
  splitEntryHeading,
  RESUME_BUILTIN_MODULES,
  unusedResumeBuiltins,
  updateResumeModule,
  updateResumeProfile,
  type ResumeEditorModel,
  type ResumeEditorModule,
  type ResumeModuleKind
} from "../features/settings/resume-preview";
import {
  pageIndexForFocus,
  parseResumeLayoutSettings,
  resumePreviewBlockGap,
  resumePreviewContentHeight,
  resumeSpacingStyle,
  shouldHighlightPreviewBlock,
  shouldHighlightPreviewGroup,
  studioJumpTargets,
  studioPersistLabel,
  studioPersistState,
  type StudioPreviewFocus,
  RESUME_LAYOUTS,
  RESUME_PREVIEW_ONE_PAGE_HEIGHT,
  RESUME_SPACING_MAX,
  RESUME_SPACING_MIN,
  RESUME_STYLES
} from "../features/settings/resume-studio";

type WorkbenchViewMode = "index" | "new" | "detail" | "resume" | "interview";

type WorkbenchViewProps = {
  viewMode: WorkbenchViewMode;
  hasProfile: boolean;
  resumeFilename?: string;
  resumeText?: string;
  profileName?: string;
  resumeLoading?: boolean;
  chatBusy: boolean;
  jobBusy: boolean;
  jobImportBusy: boolean;
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
  onNavigateResume: (jobId?: number) => void;
  onNavigateInterview: (jobId?: number) => void;
  onNavigateEvaluation: (jobId: number) => void;
  onCreateComparison: (evaluationIds: number[]) => Promise<number>;
  onQuickMatch: (
    payload: {
      job_description: string;
      job_title?: string;
      company_name?: string;
    },
    onEvent?: (event: AnalysisRunEvent) => void
  ) => Promise<QuickMatchResult>;
  onApplyResumeRewrite?: (payload: {
    original: string;
    suggested: string;
    job_description: string;
    job_title?: string;
    company_name?: string;
  }) => Promise<QuickMatchResult>;
  onSaveJob: (draft: JobProjectDraft, jobId: number | null) => Promise<JobProject>;
  onPreviewJobText: (text: string, sourceUrl?: string) => Promise<JobImportPreview>;
  onPreviewJobScreenshot: (file: File, sourceUrl?: string) => Promise<JobImportPreview>;
  onDeleteJob: (job: JobProject) => Promise<void>;
  onCreateResumeVersion: (job?: JobProject) => Promise<ResumeVersion>;
  onSelectResumeVersion: (versionId: number) => Promise<void>;
  onUpdateResumeChange: (
    versionId: number,
    changeId: number,
    patch: { decision?: ResumeChangeDecision; after_text?: string }
  ) => Promise<void>;
  onUpdateResumeVersion: (
    versionId: number,
    patch: { status?: "draft" | "final"; template_id?: ResumeTemplate; style_id?: ResumeStyle; layout?: ResumeLayoutSettings }
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
  conversations?: Conversation[];
  onOpenChat?: (conversationId: number) => void;
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

function resumeSourceLines(text?: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isResumeNameLine(line: string, profileName?: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (profileName && trimmed === profileName.trim()) return true;
  if (/[，。；：、|｜·•]/.test(trimmed)) return false;
  if (/^[\u4e00-\u9fff]{2,3}$/.test(trimmed)) return true;
  return /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2}$/.test(trimmed) && trimmed.length <= 24;
}

function resumeSourceIdentity(text?: string, profileName?: string): string {
  const first = resumeSourceLines(text)[0] || "";
  if (first && isResumeNameLine(first, profileName)) return first;
  return (profileName || "").trim();
}

function ResumeModuleShell({
  active,
  generic = false,
  onSelectAnalysis,
  onSelectResume,
  onSelectInterview,
  children
}: {
  active: WorkbenchModule;
  generic?: boolean;
  onSelectAnalysis: () => void;
  onSelectResume: () => void;
  onSelectInterview: () => void;
  children: ReactNode;
}) {
  const shellClass = active === "resume"
    ? "is-studio resume-studio-page"
    : active === "interview"
      ? "is-interview"
      : "is-analysis";
  return (
    <section className={`resume-module-shell ${shellClass}`}>
      <SectionHeader
        className="topbar"
        meta={generic ? (
          <div className="workspace-document-context">
            <FileText size={16} aria-hidden="true" />
            <span><strong>简历</strong><small>编辑、预览并导出当前文档</small></span>
          </div>
        ) : (
          <WorkbenchModuleNav
            active={active}
            onSelectAnalysis={onSelectAnalysis}
            onSelectResume={onSelectResume}
            onSelectInterview={onSelectInterview}
          />
        )}
      />
      <div className={`resume-module-body${active === "analysis" ? " resume-analysis-workspace" : ""}`}>
        {children}
      </div>
    </section>
  );
}

export function WorkbenchView({
  viewMode,
  resumeFilename,
  resumeText,
  profileName,
  resumeLoading,
  chatBusy,
  jobBusy,
  jobImportBusy,
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
  onNavigateResume,
  onNavigateInterview,
  onNavigateEvaluation,
  onCreateComparison,
  onQuickMatch,
  onApplyResumeRewrite,
  onSaveJob,
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
  onOpenProfile,
  conversations = [],
  onOpenChat
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
  const [activeStage, setActiveStage] = useState<WorkbenchStage>("analysis");
  const [jobSearch, setJobSearch] = useState("");
  const [comparisonJobs, setComparisonJobs] = useState<number[]>([]);
  const [quickMatchInput, setQuickMatchInput] = useState("");
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [quickMatchPreview, setQuickMatchPreview] = useState<JobImportPreview | null>(null);
  const [quickMatchResult, setQuickMatchResult] = useState<QuickMatchResult | null>(null);
  const [quickMatchError, setQuickMatchError] = useState("");
  const [quickMatchBusy, setQuickMatchBusy] = useState(false);
  const [analysisSteps, setAnalysisSteps] = useState<AnalysisStepView[]>(initialAnalysisSteps);
  const [appliedNotice, setAppliedNotice] = useState("");
  const [requirementsText, setRequirementsText] = useState("");
  const [jobMatchOpen, setJobMatchOpen] = useState(false);
  const selectedJob = viewMode === "detail" || viewMode === "resume" || viewMode === "interview"
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

  function loadJobIntoBench(job: JobProject) {
    const parts = splitJobDescription(job.description);
    setDraft({ ...jobToDraft(job), description: parts.description });
    setRequirementsText(parts.requirements);
    setQuickMatchInput(job.description.trim());
    setJobMatchOpen(true);
    setQuickMatchError("");
  }

  function openResumeStudio(jobId?: number) {
    onNavigateResume(jobId);
  }

  function openInterviewQa(jobId?: number) {
    if (jobId) {
      onNavigateInterview(jobId);
      return;
    }
    const resumePrepJob = jobs.find((item) => item.job_title === "按简历准备");
    onNavigateInterview(resumePrepJob?.id);
  }

  async function generateInterviewKit(job: JobProject | null) {
    if (job) {
      if (job.id !== selectedJobId) onNavigateInterview(job.id);
      await onCreateInterviewKit(job, "general");
      return;
    }
    const existingKit = interviewKits[0];
    if (existingKit) {
      onNavigateInterview(existingKit.job_id);
      await onSelectInterviewKit(existingKit.id);
      return;
    }
    const existing = jobs.find((item) => item.job_title === "按简历准备");
    if (existing) {
      onNavigateInterview(existing.id);
      await onCreateInterviewKit(existing, "general");
      return;
    }
    const created = await onSaveJob({
      ...emptyJobDraft,
      job_title: "按简历准备",
      description: "根据已保存简历生成的综合面试准备，未绑定具体岗位。"
    }, null);
    onNavigateInterview(created.id);
    await onCreateInterviewKit(created, "general");
  }

  async function continueInterviewKit() {
    const startedId = latestStartedKitId(interviewKits.map((item) => item.id));
    const existingKit = interviewKits.find((item) => item.id === startedId) ?? interviewKits[0];
    if (existingKit) {
      onNavigateInterview(existingKit.job_id);
      await onSelectInterviewKit(existingKit.id);
      return;
    }
    await generateInterviewKit(interviewJobForContinue());
  }

  function interviewJobForContinue() {
    if (selectedJobId) return jobs.find((job) => job.id === selectedJobId) ?? null;
    if (interviewKit) return jobs.find((job) => job.id === interviewKit.job_id) ?? null;
    return jobs.find((item) => item.job_title === "按简历准备") ?? null;
  }

  async function deleteCurrentJob(job: JobProject) {
    await onDeleteJob(job);
    onNavigateIndex();
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
  const hasResumeContent = Boolean((resumeText || "").trim());
  const ready = hasResumeContent && !chatBusy && !analyzing;

  function handleAnalysisEvent(event: AnalysisRunEvent) {
    setAnalysisSteps((current) => applyAnalysisRunEvent(current, event));
  }

  async function runResumeAnalysis(payload?: {
    job_description: string;
    job_title?: string;
    company_name?: string;
  }) {
    if (!ready) return;
    setQuickMatchBusy(true);
    setQuickMatchError("");
    setAppliedNotice("");
    setQuickMatchResult(null);
    setAnalysisSteps(applyAnalysisRunEvent(initialAnalysisSteps(), {
      type: "step",
      key: "direction",
      title: "方向匹配",
      status: "running",
      source: "local",
      label: "本地分析"
    }));
    try {
      const result = await onQuickMatch(payload ?? {
        job_description: composeJobDescription(draft.description, requirementsText),
        job_title: draft.job_title.trim(),
        company_name: draft.company_name.trim()
      }, handleAnalysisEvent);
      setQuickMatchResult(result);
      setAnalysisSteps((current) => completeStepsFromResult(current, result));
    } catch (error) {
      setQuickMatchError(error instanceof Error ? error.message : "分析失败，请稍后重试。");
    } finally {
      setQuickMatchBusy(false);
    }
  }

  async function runJobMatchFromBench() {
    if (quickMatchInput.trim()) {
      await submitQuickMatch();
      return;
    }
    await runResumeAnalysis();
  }

  async function applyResumeRewrite(patch: { original: string; suggested: string }) {
    if (!onApplyResumeRewrite || analyzing) return;
    const previousTitles = (quickMatchResult?.analysis.resume?.next_actions ?? []).map((item) => item.title);
    setQuickMatchBusy(true);
    setQuickMatchError("");
    try {
      const result = await onApplyResumeRewrite({
        original: patch.original,
        suggested: patch.suggested,
        job_description: composeJobDescription(draft.description, requirementsText),
        job_title: draft.job_title.trim(),
        company_name: draft.company_name.trim()
      });
      setQuickMatchResult(result);
      setAnalysisSteps(completeStepsFromResult(initialAnalysisSteps(), result));
      const remaining = new Set((result.analysis.resume?.next_actions ?? []).map((item) => item.title));
      const resolved = previousTitles.filter((title) => !remaining.has(title));
      setAppliedNotice(
        resolved.length
          ? `已写入简历并重新分析。刚处理：${resolved.join("、")}`
          : "已写入简历并重新分析。下面只列还需要改的。"
      );
    } catch (error) {
      setQuickMatchError(error instanceof Error ? error.message : "写入简历失败，请稍后重试。");
    } finally {
      setQuickMatchBusy(false);
    }
  }

  const analysisResultProps = {
    onEditProfile: onOpenProfile,
    onCustomizeResume: () => openResumeStudio(),
    onApplyRewrite: onApplyResumeRewrite ? (patch: { original: string; suggested: string }) => void applyResumeRewrite(patch) : undefined,
    applying: analyzing,
    appliedNotice
  };
  const nextAction: WorkbenchStage = !analysisReady
    ? "analysis"
    : !resumeVersions.length
      ? "resume"
      : "interview";
  const nextActionCopy = {
    analysis: currentAnalysis?.is_stale
      ? {
          title: "岗位资料有更新，建议重新分析",
          description: "岗位 JD、求职资料或求职策略发生变化，更新分析后再继续生成材料。",
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
      action: "生成面试问答"
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
    if (stoppedImportStatuses.has(preview.status)) {
      setQuickMatchError(
        preview.stop_reason
        || preview.warnings[0]
        || "未能读取到可用于分析的岗位内容，请改用粘贴描述或上传截图。"
      );
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
    try {
      const preview = await onPreviewJobText(input);
      await analyzeQuickMatchPreview(preview);
    } catch (error) {
      setQuickMatchError(error instanceof Error ? error.message : "快速匹配失败，请稍后重试。");
    } finally {
      setQuickMatchBusy(false);
    }
  }

  async function quickMatchFromScreenshot(file: File) {
    if (quickMatchBusy || jobImportBusy) return;
    setQuickMatchBusy(true);
    setQuickMatchError("");
    setQuickMatchResult(null);
    setQuickMatchPreview(null);
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
    const resumeChars = (resumeText || "").trim().length;
    const resumeIdentity = hasResumeContent ? resumeSourceIdentity(resumeText, profileName) : (profileName || "").trim();
    const resumeMeta = [
      resumeIdentity || null,
      resumeChars ? `${resumeChars.toLocaleString("zh-CN")} 字` : null
    ].filter(Boolean).join(" · ");
    const hasJobInput = Boolean(quickMatchInput.trim());
    return (
      <ResumeModuleShell
        active="analysis"
        onSelectAnalysis={onNavigateIndex}
        onSelectResume={() => openResumeStudio()}
        onSelectInterview={() => openInterviewQa()}
      >
        <article className="resume-match-bench">
          <header>
            <div>
              <h2>分析这份简历</h2>
              {resumeLoading ? (
                <p aria-busy="true">正在读取已保存的简历</p>
              ) : hasResumeContent ? (
                <p>已保存简历{resumeMeta ? ` · ${resumeMeta}` : ""}</p>
              ) : (
                <p>先保存一份简历，再回来分析。</p>
              )}
            </div>
            {onOpenProfile && hasResumeContent ? (
              <button className="resume-source-open" type="button" onClick={onOpenProfile}>
                <FileText size={14} />查看简历
              </button>
            ) : null}
          </header>
          {!hasResumeContent && !resumeLoading ? (
            <div className="job-index-profile-warning workspace-empty">
              <FileUp size={20} />
              <div><strong>还没有可用简历</strong><span>先保存一份简历，再回来分析。</span></div>
              {onOpenProfile ? <button type="button" onClick={onOpenProfile}>去求职资料</button> : null}
            </div>
          ) : (
            <footer className="resume-match-actions">
              <ActionButton
                variant="primary"
                type="button"
                onClick={() => void runResumeAnalysis({ job_description: "", job_title: "", company_name: "" })}
                disabled={!ready}
              >
                {analyzing ? <LoaderCircle className="spinning" size={15} /> : <ListChecks size={15} />}
                {analyzing ? "分析中…" : "开始分析"}
              </ActionButton>
              <ActionButton
                variant="secondary"
                type="button"
                onClick={() => setJobMatchOpen((open) => !open)}
                disabled={analyzing}
              >
                <Target size={15} />
                {jobMatchOpen ? "收起岗位" : "对照岗位"}
              </ActionButton>
            </footer>
          )}
          {jobMatchOpen && hasResumeContent ? (
            <div className="resume-match-job">
              <label className="resume-match-paste">
                <span>岗位描述</span>
                <textarea
                  value={quickMatchInput}
                  maxLength={50_000}
                  placeholder="粘贴岗位职责、任职要求…"
                  disabled={analyzing || jobImportBusy}
                  onChange={(event) => setQuickMatchInput(event.target.value)}
                />
              </label>
              <div className="resume-match-toolbar">
                <input
                  ref={screenshotInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  disabled={!ready}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void quickMatchFromScreenshot(file);
                  }}
                />
                <button
                  type="button"
                  className="resume-match-upload"
                  disabled={!ready}
                  onClick={() => screenshotInputRef.current?.click()}
                >
                  <ImagePlus size={15} />上传截图
                </button>
                <ActionButton
                  variant="primary"
                  type="button"
                  onClick={() => void runJobMatchFromBench()}
                  disabled={!ready || !hasJobInput}
                >
                  {analyzing ? <LoaderCircle className="spinning" size={15} /> : <Target size={15} />}
                  {analyzing ? "分析中…" : "对照分析"}
                </ActionButton>
              </div>
            </div>
          ) : null}
        </article>

        {analyzing ? (
          <ol className="resume-source-checklist is-analyzing" aria-label="分析步骤">
            {analysisSteps.map((step) => {
              const title = (
                <>
                  <span aria-hidden="true">{step.number}</span>
                  <strong>{step.title}</strong>
                  <em>{stepStatusLabel(step)}</em>
                </>
              );
              return (
                <li key={step.key} className={`is-${step.status}`}>
                  {step.status === "done" ? (
                    <a className="resume-analysis-step-main" href={`#analysis-${step.number}`}>
                      {title}
                    </a>
                  ) : (
                    <div className="resume-analysis-step-main">{title}</div>
                  )}
                  {step.summary && step.status === "done" ? (
                    <small className="resume-analysis-step-summary">{step.summary}</small>
                  ) : null}
                  <AnalysisThinkingProcess
                    streaming={step.status === "running"}
                    title={thinkingTitle(step)}
                    currentTask={thinkingTask(step)}
                    thoughts={step.thoughts}
                  />
                </li>
              );
            })}
          </ol>
        ) : null}

        {quickMatchError ? <p className="inline-error">{quickMatchError}</p> : null}
        {quickMatchResult ? (
          <ResumeAnalysisResult
            result={quickMatchResult}
            {...analysisResultProps}
          />
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
                    onClick={() => loadJobIntoBench(job)}
                  >
                    <div><h3>{job.job_title || "未命名岗位"}</h3><p>{job.company_name || "未填写公司"}</p></div>
                    <footer>
                      <span>{job.latest_evaluation_id ? "分析已完成" : "尚未分析"}</span>
                      <em>对照这份岗位<ArrowRight size={14} /></em>
                    </footer>
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </ResumeModuleShell>
    );
  }

  if (viewMode === "detail" && !selectedJob) {
    return (
      <section className="workbench-page job-project-subpage">
        <header className="job-subpage-nav">
          <button type="button" onClick={onNavigateIndex}><ArrowLeft size={15} />返回匹配分析</button>
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
          <button type="button" onClick={onNavigateIndex}><ArrowLeft size={15} />返回匹配分析</button>
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
            <span>{!hasResumeContent ? "分析前请先上传简历" : "没有岗位也可以先分析已保存的简历"}</span>
            <ActionButton
              variant="primary"
              onClick={() => void runResumeAnalysis()}
              disabled={!ready}
            >
              {analyzing ? <LoaderCircle className="spinning" size={14} /> : <Target size={14} />}
              {analyzing ? "分析中…" : "开始分析"}
            </ActionButton>
          </footer>
        </section>
        {quickMatchError ? <p className="inline-error">{quickMatchError}</p> : null}
        {quickMatchResult ? <ResumeAnalysisResult result={quickMatchResult} {...analysisResultProps} /> : null}
      </section>
    );
  }

  if (viewMode === "resume") {
    const resumeJob = selectedJobId
      ? jobs.find((job) => job.id === selectedJobId) ?? null
      : null;
    return (
      <ResumeModuleShell
        active="resume"
        generic={!resumeJob}
        onSelectAnalysis={onNavigateIndex}
        onSelectResume={() => openResumeStudio(resumeJob?.id)}
        onSelectInterview={() => openInterviewQa(resumeJob?.id)}
      >
        {resumeLoading ? (
          <section className="job-stage-empty">
            <span><LoaderCircle className="spinning" size={24} /></span>
            <div>
              <h2>正在读取已保存的简历</h2>
              <p>读取完成后可以编辑内容、调整样式并导出。</p>
            </div>
          </section>
        ) : hasResumeContent ? (
          <ResumeVersionPanel
            job={resumeJob}
            resumeText={resumeText || ""}
            versions={resumeVersions}
            version={resumeVersion}
            busy={resumeBusy}
            onCreate={onCreateResumeVersion}
            onSelect={onSelectResumeVersion}
            onUpdateChange={onUpdateResumeChange}
            onUpdateVersion={onUpdateResumeVersion}
            onExport={onExportResume}
          />
        ) : (
          <section className="job-stage-empty">
            <span><FileUp size={24} /></span>
            <div>
              <h2>工作台还没有文档</h2>
              <p>先在资料库中导入一份来源材料，再到这里编辑和导出。</p>
            </div>
            {onOpenProfile ? (
              <button type="button" onClick={onOpenProfile}>
                去资料库<ArrowRight size={14} />
              </button>
            ) : (
              <button type="button" onClick={onNavigateIndex}>
                返回匹配分析<ArrowRight size={14} />
              </button>
            )}
          </section>
        )}
      </ResumeModuleShell>
    );
  }

  if (viewMode === "interview") {
    const interviewJob = selectedJobId
      ? jobs.find((job) => job.id === selectedJobId) ?? null
      : interviewKit
        ? jobs.find((job) => job.id === interviewKit.job_id) ?? null
        : null;
    const hasAnalysis = Boolean(interviewJob?.latest_evaluation_id);
    return (
      <ResumeModuleShell
        active="interview"
        onSelectAnalysis={onNavigateIndex}
        onSelectResume={() => openResumeStudio(interviewJob?.id)}
        onSelectInterview={() => openInterviewQa(interviewJob?.id)}
      >
        {resumeLoading || (interviewBusy && !interviewKit) ? (
          <section className="job-stage-empty">
            <span><LoaderCircle className="spinning" size={24} /></span>
            <div>
              <h2>{resumeLoading ? "正在读取已保存的简历" : "正在打开面试问答"}</h2>
              <p>{resumeLoading ? "读取完成后可以按简历块开始练习。" : "已生成过的题目会直接打开，未练完的会接着上一题。"}</p>
            </div>
          </section>
        ) : !hasResumeContent ? (
          <section className="job-stage-empty">
            <span><FileUp size={24} /></span>
            <div>
              <h2>还没有保存简历</h2>
              <p>先在求职资料里上传并保存简历，再生成面试问答。</p>
            </div>
            {onOpenProfile ? (
              <button type="button" onClick={onOpenProfile}>
                去求职资料<ArrowRight size={14} />
              </button>
            ) : (
              <button type="button" onClick={onNavigateIndex}>
                返回匹配分析<ArrowRight size={14} />
              </button>
            )}
          </section>
        ) : interviewKit ? (
          <InterviewQaWorkspace
            job={interviewJob}
            kits={interviewKits}
            kit={interviewKit}
            busy={interviewBusy}
            onCreateKit={onCreateInterviewKit}
            onSelectKit={onSelectInterviewKit}
            onUpdateKit={onUpdateInterviewKit}
          />
        ) : (
          <InterviewQaEmpty
            canGenerate
            generateLabel={hasAnalysis ? "生成面试问答" : "按简历生成"}
            busy={interviewBusy}
            hasAnalysis={hasAnalysis}
            resumeText={resumeText}
            jobs={jobs}
            selectedJobId={interviewJob?.id ?? null}
            kits={interviewKits}
            conversations={conversations}
            onGenerate={() => void generateInterviewKit(interviewJob)}
            onStartForJob={(job) => void generateInterviewKit(job)}
            onContinueKit={() => void continueInterviewKit()}
            onContinueConversation={onOpenChat}
          />
        )}
      </ResumeModuleShell>
    );
  }

  return (
    <section className="workbench-page job-project-subpage">
      <header className="job-subpage-nav">
        <button type="button" onClick={onNavigateIndex}><ArrowLeft size={15} />返回匹配分析</button>
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
                  <h2>{selectedJob.job_title || "未命名岗位"}</h2>
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
                <ActionButton variant="secondary" onClick={cancelJobEditing} disabled={jobBusy}>
                  取消
                </ActionButton>
                <ActionButton variant="secondary" onClick={() => void persistJob()} disabled={!hasProjectContent || jobBusy || !dirty}>
                  <Save size={14} />{jobBusy ? "保存中…" : "保存修改"}
                </ActionButton>
              </footer>
            </section>
          ) : null}

          {selectedJob && !analysisReady ? (
            <section className="job-stage-empty">
              <span><Target size={24} /></span>
              <div>
                <h2>{currentAnalysis ? "岗位或简历有更新，需要重新分析" : "还没有这份岗位的匹配分析"}</h2>
                <p>{currentAnalysis
                  ? currentAnalysis.stale_reasons.join("；") || "岗位或简历已变化，请先更新分析。"
                  : "分析会对照岗位要求与已保存的简历，标出匹配、缺口和证据。"}</p>
              </div>
              <button
                disabled={!ready}
                title={!hasResumeContent ? "请先完成求职资料并保存简历" : !draft.description.trim() ? "请先补充岗位描述" : undefined}
                onClick={() => void runTask("match")}
              >
                {analysisBusy ? "分析中…" : currentAnalysis ? "更新分析" : "开始分析"}<ArrowRight size={14} />
              </button>
            </section>
          ) : null}

      {selectedJob && analysisReady ? (
        <section className="job-stage-empty">
          <span><Target size={24} /></span>
          <div><h2>匹配分析已完成</h2><p>查看匹配、缺口、证据和下一步建议。</p></div>
          <button onClick={() => onNavigateEvaluation(selectedJob.id)}>打开完整评估<ArrowRight size={14} /></button>
        </section>
      ) : null}

        </div>
      </section>
    </section>
  );
}

const MODULE_EDITOR_ROWS: Record<ResumeModuleKind, number> = {
  experience: 7,
  internship: 6,
  projects: 7,
  skills: 3,
  strengths: 6,
  education: 3,
  campus: 5,
  honors: 4,
  custom: 5
};

/** Grow the editor with its content instead of nesting a scrollbar, but stop before it swallows the panel. */
const MODULE_EDITOR_MAX_HEIGHT = 460;

function ResumeAutoTextarea({
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    if (node.scrollHeight <= 0) return;
    const borders = Math.max(0, node.offsetHeight - node.clientHeight);
    node.style.height = `${Math.min(node.scrollHeight + borders, MODULE_EDITOR_MAX_HEIGHT)}px`;
  }, [value]);

  return <textarea ref={ref} value={value} {...rest} />;
}

function moduleFirstLine(body: string) {
  return body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function moduleStats(body: string) {
  const text = body.trim();
  if (!text) return "";
  const entries = text.split(/\n{2,}/).filter((entry) => entry.trim()).length;
  const chars = text.replace(/\s/g, "").length;
  return `${entries} 条 · ${chars} 字`;
}

const ENTRY_MODULE_KINDS = new Set<ResumeModuleKind>([
  "experience",
  "internship",
  "projects",
  "education",
  "campus",
  "honors"
]);

function isEntryModule(kind: ResumeModuleKind) {
  return ENTRY_MODULE_KINDS.has(kind);
}

function splitModuleEntries(body: string): string[] {
  const text = body.replace(/\r\n/g, "\n");
  if (!text.trim()) return [""];
  return text.split(/\n{2,}/);
}

function joinModuleEntries(entries: string[]): string {
  return entries.map((entry) => entry.trim()).filter(Boolean).join("\n\n");
}

function entryOrdinalLabel(kind: ResumeModuleKind, index: number) {
  return kind === "projects" ? projectOrdinalLabel(index) : `第 ${index + 1} 条`;
}

function entryAddLabel(kind: ResumeModuleKind) {
  switch (kind) {
    case "projects":
      return "添加项目";
    case "experience":
      return "添加工作";
    case "internship":
      return "添加实习";
    case "education":
      return "添加教育";
    case "campus":
      return "添加经历";
    case "honors":
      return "添加荣誉";
    default:
      return "添加一条";
  }
}

function ResumeModuleEntryEditor({
  item,
  entries,
  busy,
  onFocus,
  onEntriesChange
}: {
  item: ResumeEditorModule;
  entries: string[];
  busy: boolean;
  onFocus?: () => void;
  onEntriesChange: (entries: string[]) => void;
}) {
  const placeholder = item.kind === "custom"
    ? "在这里写这个模块的内容"
    : RESUME_BUILTIN_MODULES.find((builtin) => builtin.kind === item.kind)?.placeholder;
  const addLabel = entryAddLabel(item.kind);

  function updateAt(index: number, value: string) {
    onEntriesChange(entries.map((entry, entryIndex) => (entryIndex === index ? value : entry)));
  }

  function removeAt(index: number) {
    const next = entries.filter((_, entryIndex) => entryIndex !== index);
    onEntriesChange(next.length ? next : [""]);
  }

  function moveAt(index: number, delta: number) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= entries.length) return;
    const next = [...entries];
    const [entry] = next.splice(index, 1);
    next.splice(nextIndex, 0, entry);
    onEntriesChange(next);
  }

  return (
    <div className="resume-module-entries">
      {entries.map((entry, index) => {
        const ordinal = entryOrdinalLabel(item.kind, index);
        const onlyEmpty = entries.length === 1 && !entry.trim();
        return (
          <div className="resume-module-entry" key={`${item.id}-${index}`}>
            <div className="resume-module-entry-head">
              <strong>{ordinal}</strong>
              <div className="resume-module-entry-actions">
                <button
                  type="button"
                  aria-label={`上移${ordinal}`}
                  disabled={busy || index === 0}
                  onClick={() => moveAt(index, -1)}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`下移${ordinal}`}
                  disabled={busy || index === entries.length - 1}
                  onClick={() => moveAt(index, 1)}
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  className="is-remove"
                  aria-label={`删除${ordinal}`}
                  disabled={busy || onlyEmpty}
                  onClick={() => removeAt(index)}
                >
                  <Minus size={14} />
                </button>
              </div>
            </div>
            <label className="resume-module-field">
              <ResumeAutoTextarea
                aria-label={`编辑${item.label} ${ordinal}`}
                value={entry}
                disabled={busy}
                placeholder={placeholder}
                rows={MODULE_EDITOR_ROWS[item.kind]}
                onFocus={onFocus}
                onChange={(event) => updateAt(index, event.target.value)}
              />
            </label>
          </div>
        );
      })}
      <button
        type="button"
        className="resume-module-add-entry"
        disabled={busy}
        aria-label={addLabel}
        onClick={() => onEntriesChange([...entries, ""])}
      >
        <Plus size={14} />
        <span>{addLabel}</span>
      </button>
    </div>
  );
}

function ResumeModuleList({
  model,
  busy,
  activeSection,
  onChange,
  onFocusSection
}: {
  model: ResumeEditorModel;
  busy: boolean;
  activeSection?: StudioPreviewFocus["section"] | null;
  onChange: (next: ResumeEditorModel) => void;
  onFocusSection: (focus: StudioPreviewFocus) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<string[] | null>(null);
  const [entryDrafts, setEntryDrafts] = useState<Record<string, string[]>>({});
  const pendingJump = useRef<string | null>(null);
  const unused = unusedResumeBuiltins(model);
  const jumps = studioJumpTargets(model);
  const collapsed = new Set(
    (collapsedIds ?? model.modules.map((item) => item.id))
      .filter((id) => model.modules.some((item) => item.id === id))
  );
  const allCollapsed = model.modules.length > 0 && collapsed.size === model.modules.length;

  useLayoutEffect(() => {
    const id = pendingJump.current;
    if (!id) return;
    pendingJump.current = null;
    const card = document.getElementById(`resume-studio-card-${id}`);
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ block: "nearest" });
    }
    card?.querySelector<HTMLElement>("input, textarea")?.focus();
  });

  function entriesFor(item: ResumeEditorModule): string[] {
    const draft = entryDrafts[item.id];
    if (draft && joinModuleEntries(draft) === joinModuleEntries(splitModuleEntries(item.body))) {
      return draft;
    }
    return splitModuleEntries(item.body);
  }

  function commitEntries(item: ResumeEditorModule, entries: string[]) {
    setEntryDrafts((current) => ({ ...current, [item.id]: entries }));
    onChange(updateResumeModule(model, item.id, { body: joinModuleEntries(entries) }));
  }

  function collapsedBase() {
    return collapsedIds ?? model.modules.map((item) => item.id);
  }

  function addModule(kind: ResumeModuleKind) {
    const next = addResumeModule(model, kind);
    const added = next.modules.find((item) => !model.modules.some((current) => current.id === item.id));
    setCollapsedIds(collapsedBase().filter((id) => next.modules.some((item) => item.id === id)));
    onChange(next);
    if (added) {
      pendingJump.current = added.id;
      onFocusSection({ section: added.kind === "custom" ? "other" : added.kind, label: added.label });
    }
  }

  function jumpTo(id: string, focus: StudioPreviewFocus) {
    if (id !== "profile" && id !== "summary") {
      setCollapsedIds(collapsedBase().filter((item) => item !== id));
    }
    pendingJump.current = id;
    onFocusSection(focus);
  }

  function toggleCollapsed(id: string) {
    setCollapsedIds((current) => {
      const base = current ?? model.modules.map((item) => item.id);
      return base.includes(id) ? base.filter((item) => item !== id) : [...base, id];
    });
  }

  function toggleAllCollapsed() {
    setCollapsedIds(allCollapsed ? [] : model.modules.map((item) => item.id));
  }

  function reorderTo(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    const from = model.modules.findIndex((item) => item.id === draggingId);
    const to = model.modules.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const modules = [...model.modules];
    const [item] = modules.splice(from, 1);
    modules.splice(to, 0, item);
    onChange({ ...model, modules });
  }

  return (
    <div className="resume-module-list">
      <nav className="resume-module-jump" aria-label="定位模块">
        {jumps.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-label={`定位到${item.label}`}
            aria-pressed={activeSection === item.focus.section}
            className={activeSection === item.focus.section ? "active" : ""}
            onClick={() => jumpTo(item.id, item.focus)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <article
        className={`resume-module-card is-fixed${activeSection === "title" ? " is-focused" : ""}`}
        id="resume-studio-card-profile"
      >
        <header className="resume-module-card-head">
          <strong>个人信息</strong>
        </header>
        <label className="resume-module-field">
          <span>姓名 / 求职方向</span>
          <input
            aria-label="简历标题"
            value={model.profile.title}
            disabled={busy}
            placeholder="姓名｜职位"
            onFocus={() => onFocusSection({ section: "title", label: "个人信息" })}
            onChange={(event) => onChange(updateResumeProfile(model, { title: event.target.value }))}
          />
        </label>
        <label className="resume-module-field">
          <span>联系方式</span>
          <input
            aria-label="联系方式"
            value={model.profile.contact}
            disabled={busy}
            placeholder="电话｜邮箱｜城市"
            onFocus={() => onFocusSection({ section: "title", label: "个人信息" })}
            onChange={(event) => onChange(updateResumeProfile(model, { contact: event.target.value }))}
          />
        </label>
        <label className="resume-module-field">
          <span>求职意向</span>
          <input
            aria-label="求职意向"
            value={model.profile.target}
            disabled={busy}
            placeholder="目标岗位"
            onFocus={() => onFocusSection({ section: "title", label: "个人信息" })}
            onChange={(event) => onChange(updateResumeProfile(model, { target: event.target.value }))}
          />
        </label>
      </article>
      <article
        className={`resume-module-card is-fixed${activeSection === "summary" ? " is-focused" : ""}`}
        id="resume-studio-card-summary"
      >
        <header className="resume-module-card-head">
          <strong>个人概述</strong>
          {model.profile.summary.trim() ? (
            <small>{moduleStats(model.profile.summary)}</small>
          ) : null}
        </header>
        <label className="resume-module-field">
          <ResumeAutoTextarea
            aria-label="编辑个人概述"
            value={model.profile.summary}
            disabled={busy}
            placeholder="一句话说明方向和优势"
            rows={3}
            onFocus={() => onFocusSection({ section: "summary", label: "个人概述" })}
            onChange={(event) => onChange(updateResumeProfile(model, { summary: event.target.value }))}
          />
        </label>
      </article>

      {model.modules.length ? (
        <div className="resume-module-toolbar">
          <span>已添加 {model.modules.length} 个模块</span>
          <button type="button" className="text-button" onClick={toggleAllCollapsed}>
            {allCollapsed ? "全部展开" : "全部收起"}
          </button>
        </div>
      ) : null}

      <div className="resume-module-active" role="list" aria-label="已添加模块">
        {model.modules.map((item, index) => {
          const isCollapsed = collapsed.has(item.id);
          const summary = moduleFirstLine(item.body);
          const stats = moduleStats(item.body);
          const focus = { section: item.kind === "custom" ? "other" as const : item.kind, label: item.label };
          const isFocused = activeSection === focus.section;
          return (
            <article
              className={`resume-module-card${isCollapsed ? " is-collapsed" : ""}${isFocused ? " is-focused" : ""}${draggingId === item.id ? " is-dragging" : ""}${dropId === item.id ? " is-drop-target" : ""}`}
              role="listitem"
              id={`resume-studio-card-${item.id}`}
              aria-grabbed={draggingId === item.id}
              key={item.id}
              onDragOver={(event) => {
                event.preventDefault();
                setDropId(item.id);
              }}
              onDragLeave={() => {
                setDropId((current) => current === item.id ? null : current);
              }}
              onDrop={(event) => {
                event.preventDefault();
                reorderTo(item.id);
                setDraggingId(null);
                setDropId(null);
              }}
            >
              <header className="resume-module-card-head">
                <span
                  className="resume-module-drag"
                  draggable={!busy}
                  aria-hidden="true"
                  onDragStart={(event) => {
                    setDraggingId(item.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropId(null);
                  }}
                >
                  <GripVertical size={14} />
                </span>
                <button
                  type="button"
                  className="resume-module-toggle"
                  aria-expanded={!isCollapsed}
                  aria-controls={`resume-module-body-${item.id}`}
                  aria-label={`${isCollapsed ? "展开" : "收起"}${item.label}`}
                  onClick={() => {
                    toggleCollapsed(item.id);
                    onFocusSection(focus);
                  }}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span className="resume-module-toggle-copy">
                    <strong>{item.label}</strong>
                    {isCollapsed ? <em>{summary || "还没有内容"}</em> : null}
                  </span>
                  {stats ? <small>{stats}</small> : null}
                </button>
                <div className="resume-module-card-actions">
                  <button
                    type="button"
                    aria-label={`上移${item.label}`}
                    disabled={busy || index === 0}
                    onClick={() => onChange(moveResumeModule(model, item.id, -1))}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`下移${item.label}`}
                    disabled={busy || index === model.modules.length - 1}
                    onClick={() => onChange(moveResumeModule(model, item.id, 1))}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="is-remove"
                    aria-label={`移除${item.label}`}
                    disabled={busy}
                    onClick={() => onChange(removeResumeModule(model, item.id))}
                  >
                    <Minus size={14} />
                  </button>
                </div>
              </header>
              {isCollapsed ? null : (
                <div className="resume-module-body" id={`resume-module-body-${item.id}`}>
                  {item.kind === "custom" ? (
                    <label className="resume-module-field">
                      <span>模块名称</span>
                      <input
                        aria-label="模块标题"
                        value={item.label}
                        disabled={busy}
                        placeholder="模块名称"
                        onFocus={() => onFocusSection(focus)}
                        onChange={(event) => onChange(updateResumeModule(model, item.id, { label: event.target.value }))}
                      />
                    </label>
                  ) : null}
                  {isEntryModule(item.kind) ? (
                    <ResumeModuleEntryEditor
                      item={item}
                      entries={entriesFor(item)}
                      busy={busy}
                      onFocus={() => onFocusSection(focus)}
                      onEntriesChange={(entries) => commitEntries(item, entries)}
                    />
                  ) : (
                    <label className="resume-module-field">
                      <ResumeAutoTextarea
                        aria-label={`编辑${item.label}`}
                        value={item.body}
                        disabled={busy}
                        placeholder={item.kind === "custom" ? "在这里写这个模块的内容" : RESUME_BUILTIN_MODULES.find((builtin) => builtin.kind === item.kind)?.placeholder}
                        rows={MODULE_EDITOR_ROWS[item.kind]}
                        onFocus={() => onFocusSection(focus)}
                        onChange={(event) => onChange(updateResumeModule(model, item.id, { body: event.target.value }))}
                      />
                    </label>
                  )}
                  <p className="resume-module-meta">
                    <span>{item.body.trim() ? "" : "留空时导出会跳过这个模块"}</span>
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="resume-module-add">
        <h3>添加模块</h3>
        <div className="resume-module-add-grid">
          {unused.map((item) => (
            <button
              type="button"
              key={item.kind}
              disabled={busy}
              aria-label={`添加${item.label}`}
              onClick={() => addModule(item.kind)}
            >
              <Plus size={14} />
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            aria-label="添加自定义模块"
            onClick={() => addModule("custom")}
          >
            <Plus size={14} />
            <span>自定义模块</span>
          </button>
        </div>
      </div>
    </div>
  );
}

type ResumeVersionPanelProps = {
  job: JobProject | null;
  resumeText: string;
  versions: ResumeVersionSummary[];
  version: ResumeVersion | null;
  busy: boolean;
  onCreate: (job?: JobProject) => Promise<ResumeVersion>;
  onSelect: (versionId: number) => Promise<void>;
  onUpdateChange: (
    versionId: number,
    changeId: number,
    patch: { decision?: ResumeChangeDecision; after_text?: string }
  ) => Promise<void>;
  onUpdateVersion: (
    versionId: number,
    patch: { status?: "draft" | "final"; template_id?: ResumeTemplate; style_id?: ResumeStyle; layout?: ResumeLayoutSettings }
  ) => Promise<void>;
  onExport: (versionId: number, format: "docx" | "pdf") => Promise<void>;
};

function composeVersionPreview(
  version: ResumeVersion | null,
  previewEdits: Record<number, string>
) {
  if (!version) return "";
  return version.changes
    .map((change) => change.decision === "rejected"
      ? change.before_text
      : previewEdits[change.id] ?? change.after_text)
    .filter(Boolean)
    .join("\n\n");
}

function ResumeVersionPanel({
  job,
  resumeText,
  version,
  busy,
  onCreate,
  onUpdateChange,
  onUpdateVersion,
  onExport
}: ResumeVersionPanelProps) {
  const [previewEdits, setPreviewEdits] = useState<Record<number, string>>({});
  const [draftContent, setDraftContent] = useState(resumeText);
  const [editorModel, setEditorModel] = useState(() => parseResumeEditor(resumeText));
  const [draftTemplate, setDraftTemplate] = useState<ResumeTemplate>(version?.template_id ?? "classic");
  const [draftStyle, setDraftStyle] = useState<ResumeStyle>(version?.style_id ?? "navy");
  const [draftLayout, setDraftLayout] = useState<ResumeLayoutSettings>(
    () => parseResumeLayoutSettings(version?.layout)
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [studioPane, setStudioPane] = useState<"modules" | "templates" | "layout">("modules");
  const [focusSection, setFocusSection] = useState<StudioPreviewFocus | null>(null);
  const [previewPulse, setPreviewPulse] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  const [previewPage, setPreviewPage] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const createRequest = useRef<Promise<ResumeVersion> | null>(null);
  const persistLayoutTimer = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const paperFitRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const previewPagesRef = useRef<ResumePreviewBlock[][]>([]);

  const composedPreview = composeVersionPreview(version, previewEdits) || resumeText;
  const templateId = draftTemplate;
  const styleId = draftStyle;
  const dirty = draftContent !== composedPreview;
  const showChangeList = Boolean(version && job?.latest_evaluation_id && version.changes.length);
  const previewBlocks = useMemo(
    () => buildResumePreviewBlocks(draftContent, templateId),
    [draftContent, templateId]
  );
  const previewPages = useMemo(() => {
    if (draftLayout.one_page) return [previewBlocks];
    const estimated = estimateResumePreviewHeights(previewBlocks, draftLayout.spacing);
    const measured = estimated.map((block) => ({
      ...block,
      height: measuredHeights[block.id] || block.height
    }));
    return paginateResumePreview(measured, resumePreviewContentHeight(draftLayout.spacing, templateId), {
      gap: resumePreviewBlockGap(draftLayout.spacing)
    });
  }, [draftContent, draftLayout.one_page, draftLayout.spacing, measuredHeights, previewBlocks, templateId]);
  previewPagesRef.current = previewPages;
  const pageCount = draftLayout.one_page ? 1 : Math.max(1, previewPages.length);
  const currentPage = Math.min(previewPage, pageCount - 1);
  const currentPageBlocks = draftLayout.one_page ? previewBlocks : (previewPages[currentPage] ?? previewBlocks);
  const persistState = studioPersistState({
    dirty,
    saving,
    exporting,
    hasVersion: Boolean(version),
    isFinal: version?.status === "final"
  });
  const persistLabel = studioPersistLabel(persistState);
  const studioBusy = busy || saving || exporting;
  const previewStatus = focusSection?.label
    ? `正在看：${focusSection.label}`
    : previewPulse
      ? "预览已更新"
      : studioPane === "templates"
        ? "点选风格，这张纸马上换一套。"
        : studioPane === "layout"
          ? "栏数和疏密会立刻反映在这张纸上。"
          : "改内容会立刻反映在这张纸上。";

  function notePreviewUpdate() {
    setPreviewPulse(true);
    if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPreviewPulse(false), 1200);
  }

  useEffect(() => {
    const nextContent = composeVersionPreview(version, {}) || resumeText;
    setPreviewEdits({});
    setDraftContent(nextContent);
    setEditorModel(parseResumeEditor(nextContent));
    setDraftTemplate(version?.template_id ?? "classic");
    setDraftStyle(version?.style_id ?? "navy");
    setDraftLayout(parseResumeLayoutSettings(version?.layout));
    setPreviewPage(0);
  }, [resumeText, version?.id, version?.updated_at, version?.template_id, version?.style_id, version?.layout?.spacing, version?.layout?.one_page]);

  async function ensureVersion() {
    if (version) return version;
    if (!createRequest.current) {
      createRequest.current = Promise.resolve(onCreate()).finally(() => {
        createRequest.current = null;
      });
    }
    return createRequest.current;
  }

  async function applyLayout(nextTemplate: ResumeTemplate) {
    setDraftTemplate(nextTemplate);
    notePreviewUpdate();
    try {
      const current = version ?? await ensureVersion();
      if (current?.id && current.template_id !== nextTemplate) {
        await onUpdateVersion(current.id, { template_id: nextTemplate });
      }
    } catch {
      // The parent already surfaces the create/update error.
    }
  }

  async function persistLayout(next: ResumeLayoutSettings) {
    try {
      const current = version ?? await ensureVersion();
      if (current?.id) await onUpdateVersion(current.id, { layout: next });
    } catch {
      // The parent already surfaces the update error.
    }
  }

  function updateLayout(patch: Partial<ResumeLayoutSettings>, persist: "now" | "later" = "now") {
    const next = parseResumeLayoutSettings({ ...draftLayout, ...patch });
    setDraftLayout(next);
    notePreviewUpdate();
    if (persistLayoutTimer.current) window.clearTimeout(persistLayoutTimer.current);
    if (persist === "later") {
      persistLayoutTimer.current = window.setTimeout(() => void persistLayout(next), 400);
      return;
    }
    void persistLayout(next);
  }

  async function applyStyle(nextStyle: ResumeStyle) {
    setDraftStyle(nextStyle);
    notePreviewUpdate();
    try {
      const current = version ?? await ensureVersion();
      if (current?.id && current.style_id !== nextStyle) {
        await onUpdateVersion(current.id, { style_id: nextStyle });
      }
    } catch {
      // The parent already surfaces the create/update error.
    }
  }

  function updateEditor(next: ResumeEditorModel) {
    setEditorModel(next);
    setDraftContent(composeResumeEditor(next));
    notePreviewUpdate();
  }

  async function saveContent() {
    setSaving(true);
    try {
      const current = version ?? await ensureVersion();
      const body = current?.changes.find((change) => change.section_key === "body")
        ?? current?.changes.at(-1);
      if (!current?.id || !body) return;
      await onUpdateChange(current.id, body.id, { after_text: draftContent });
    } catch {
      // The parent already surfaces the save error.
    } finally {
      setSaving(false);
    }
  }

  useLayoutEffect(() => {
    if (draftLayout.one_page) {
      const paper = paperRef.current;
      const inner = paperFitRef.current;
      if (!paper || !inner) {
        setFitScale(1);
        return;
      }
      inner.style.transform = "none";
      const contentHeight = Math.max(inner.scrollHeight, inner.offsetHeight);
      setFitScale(Math.min(1, Math.max(0.62, (RESUME_PREVIEW_ONE_PAGE_HEIGHT - 16) / Math.max(contentHeight, 1))));
      return;
    }

    setFitScale(1);
    const root = measureRef.current;
    if (!root) {
      setMeasuredHeights({});
      return;
    }
    const next: Record<string, number> = {};
    root.querySelectorAll("[data-resume-block]").forEach((node) => {
      const id = node.getAttribute("data-resume-block");
      if (!id || !(node instanceof HTMLElement)) return;
      next[id] = Math.ceil(node.getBoundingClientRect().height);
    });
    if (Object.values(next).some((height) => height > 0)) {
      setMeasuredHeights(next);
    }
  }, [draftContent, draftLayout.one_page, draftLayout.spacing, templateId, styleId]);

  useEffect(() => {
    if (!focusSection || draftLayout.one_page) return;
    setPreviewPage(pageIndexForFocus(previewPagesRef.current, focusSection));
  }, [draftLayout.one_page, focusSection]);

  useLayoutEffect(() => {
    if (!focusSection) return;
    const paper = paperRef.current;
    if (!paper) return;
    const hasSection = paper.querySelector(`[data-resume-section="${focusSection.section}"]`);
    const selector = focusSection.section === "title" || (focusSection.section === "summary" && !hasSection)
      ? '[data-resume-section="title"]'
      : `[data-resume-section="${focusSection.section}"]`;
    const node = paper.querySelector(selector);
    if (!(node instanceof HTMLElement) || typeof node.scrollIntoView !== "function") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [currentPage, focusSection]);

  useEffect(() => () => {
    if (persistLayoutTimer.current) window.clearTimeout(persistLayoutTimer.current);
    if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
  }, []);

  async function exportVersion(format: "docx" | "pdf") {
    setExporting(true);
    try {
      if (dirty) await saveContent();
      const current = version ?? await ensureVersion();
      if (current?.id) await onExport(current.id, format);
    } catch {
      // The parent already surfaces the export error.
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="resume-version-panel resume-studio-board">
      <div className="resume-studio-designer">
        <aside className="resume-studio-sidebar" aria-label={job ? "定制简历" : "简历编辑器"}>
          <header>
            <div>
              <p>{studioPane === "modules" ? "左侧改内容，右侧马上更新。" : studioPane === "templates" ? "点选风格，右侧马上换一套。" : "先定栏数和疏密，右侧跟着变。"}</p>
            </div>
            <div className="resume-studio-header-actions resume-export-actions">
              {job?.latest_evaluation_id ? (
                <button className="text-button" type="button" disabled={studioBusy} onClick={() => void onCreate(job)}>
                  <Target size={14} />对照岗位生成一版
                </button>
              ) : null}
              {persistState !== "none" ? (
                <span
                  className={`resume-studio-status${persistState === "final" ? " final" : ""}${persistState === "unsaved" ? " is-dirty" : ""}${persistState === "saving" || persistState === "exporting" ? " is-busy" : ""}`}
                  role="status"
                >
                  {persistState === "saved" || persistState === "final" ? <Check size={12} /> : null}
                  {persistLabel}
                </span>
              ) : null}
              {dirty && !saving ? (
                <ActionButton variant="primary" type="button" disabled={studioBusy} onClick={() => void saveContent()}>
                  <Save size={14} />保存草稿
                </ActionButton>
              ) : null}
              <div className="resume-export-menu">
                <button
                  type="button"
                  disabled={studioBusy}
                  aria-expanded={exportOpen}
                  aria-haspopup="menu"
                  title={dirty ? "会先保存未保存的修改" : undefined}
                  onClick={() => setExportOpen((open) => !open)}
                >
                  <Download size={14} />{exporting ? "导出中…" : "导出"}
                </button>
                {exportOpen ? (
                  <div className="resume-export-formats" role="menu" aria-label="导出格式">
                    {dirty ? <p className="resume-export-hint">会先保存未保存的修改</p> : null}
                    <button type="button" role="menuitem" disabled={studioBusy} onClick={() => { setExportOpen(false); void exportVersion("docx"); }}>
                      DOCX
                    </button>
                    <button type="button" role="menuitem" disabled={studioBusy} onClick={() => { setExportOpen(false); void exportVersion("pdf"); }}>
                      PDF
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>
          <div className="resume-studio-tabs" role="tablist" aria-label={job ? "定制简历面板" : "简历编辑面板"}>
            {([
              ["modules", "内容"],
              ["templates", "模板"],
              ["layout", "排版"]
            ] as const).map(([id, label]) => (
              <button
                type="button"
                role="tab"
                id={`resume-studio-tab-${id}`}
                aria-selected={studioPane === id}
                aria-controls={`resume-studio-panel-${id}`}
                className={studioPane === id ? "active" : ""}
                key={id}
                onClick={() => setStudioPane(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="resume-studio-panes">
            <div
              className="resume-studio-pane"
              hidden={studioPane !== "modules"}
              role="tabpanel"
              id="resume-studio-panel-modules"
              aria-labelledby="resume-studio-tab-modules"
            >
              <ResumeModuleList
                model={editorModel}
                busy={studioBusy}
                activeSection={focusSection?.section}
                onChange={updateEditor}
                onFocusSection={setFocusSection}
              />
            </div>
            <div
              className="resume-studio-pane"
              hidden={studioPane !== "templates"}
              role="tabpanel"
              id="resume-studio-panel-templates"
              aria-labelledby="resume-studio-tab-templates"
            >
              <div className="resume-template-gallery" aria-label="简历模板">
                {RESUME_STYLES.map((item) => (
                  <button
                    type="button"
                    className={`style-${item.id}${styleId === item.id ? " active" : ""}`}
                    aria-pressed={styleId === item.id}
                    aria-label={`选择模板：${item.name}`}
                    disabled={studioBusy}
                    key={item.id}
                    onClick={() => void applyStyle(item.id)}
                  >
                    <span className={`resume-style-thumb style-${item.id} layout-${templateId}`} aria-hidden="true">
                      {templateId === "compact" ? (
                        <>
                          <span className="thumb-rail"><b>Aa</b><i /><i /></span>
                          <span className="thumb-copy"><i /><i /><i /><i /></span>
                        </>
                      ) : (
                        <><b>Aa</b><i /><i /><i /></>
                      )}
                    </span>
                    <strong>{item.name}</strong>
                    <small>{item.note}</small>
                  </button>
                ))}
              </div>
            </div>
            <div
              className="resume-studio-pane"
              hidden={studioPane !== "layout"}
              role="tabpanel"
              id="resume-studio-panel-layout"
              aria-labelledby="resume-studio-tab-layout"
            >
              <div className="resume-layout-gallery" aria-label="简历类型">
                <div className="resume-layout-controls">
                  <label className="resume-spacing-control">
                    <span>简历间距</span>
                    <input
                      type="range"
                      min={RESUME_SPACING_MIN}
                      max={RESUME_SPACING_MAX}
                      step={5}
                      value={draftLayout.spacing}
                      disabled={studioBusy}
                      aria-label="简历间距"
                      onChange={(event) => updateLayout({ spacing: Number(event.target.value) }, "later")}
                    />
                    <small>{draftLayout.spacing <= 85 ? "紧凑" : draftLayout.spacing >= 115 ? "宽松" : "适中"}</small>
                  </label>
                  <label className="resume-one-page-control">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="一页模式"
                      checked={draftLayout.one_page}
                      disabled={studioBusy}
                      onChange={(event) => updateLayout({ one_page: event.target.checked })}
                    />
                    <span>
                      <strong>一页模式</strong>
                      <small>自动压缩间距，尽量放进一页</small>
                    </span>
                  </label>
                </div>
                {RESUME_LAYOUTS.map((item) => (
                  <button
                    type="button"
                    className={templateId === item.id ? "active" : ""}
                    aria-pressed={templateId === item.id}
                    aria-label={`选择类型：${item.name}`}
                    disabled={studioBusy}
                    key={item.id}
                    onClick={() => void applyLayout(item.id)}
                  >
                    <span className={`resume-layout-thumb template-${item.id}`} aria-hidden="true">
                      {item.id === "compact" ? (
                        <>
                          <span className="thumb-rail"><i /><i /><i /></span>
                          <span className="thumb-copy"><i /><i /><i /></span>
                        </>
                      ) : (
                        <><i /><i /><i /></>
                      )}
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.note}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>
        <section className="resume-studio-canvas" id="resume-preview" aria-label="简历预览">
          <header className="resume-studio-canvas-head">
            <div>
              <strong>
                <span className={`resume-studio-live-dot${previewPulse ? " is-pulse" : ""}`} aria-hidden="true" />
                实时预览
              </strong>
              <p role="status">{previewStatus}</p>
            </div>
            <span className="resume-page-badge">{draftLayout.one_page ? "一页" : `${currentPage + 1} / ${pageCount}`}</span>
          </header>
          <div
            ref={paperRef}
            className={`resume-paper template-${templateId} style-${styleId}${draftLayout.one_page ? " is-one-page" : ""}`}
            style={resumeSpacingStyle(draftLayout.spacing)}
            aria-label="简历预览效果"
          >
            <div
              ref={paperFitRef}
              className="resume-paper-fit"
              style={draftLayout.one_page ? { transform: `scale(${fitScale})` } : undefined}
            >
              {draftContent.trim()
                ? <ResumePagedSheet blocks={currentPageBlocks} templateId={templateId} focus={focusSection} />
                : <span className="resume-preview-placeholder">还没有内容，先在内容里填写。</span>}
            </div>
          </div>
          {!draftLayout.one_page && pageCount > 1 ? (
            <nav className="resume-page-controls" aria-label="预览翻页">
              <button
                type="button"
                aria-label="上一页"
                disabled={currentPage <= 0}
                onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}
              >
                <ArrowLeft size={14} />上一页
              </button>
              <span>{currentPage + 1} / {pageCount}</span>
              <button
                type="button"
                aria-label="下一页"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPreviewPage((page) => Math.min(pageCount - 1, page + 1))}
              >
                下一页<ArrowRight size={14} />
              </button>
            </nav>
          ) : null}
          {!draftLayout.one_page && draftContent.trim() ? (
            <div
              ref={measureRef}
              className={`resume-paper resume-paper-measure template-${templateId} style-${styleId}`}
              style={resumeSpacingStyle(draftLayout.spacing)}
              aria-hidden="true"
            >
              <ResumePagedSheet blocks={previewBlocks} templateId={templateId} measure />
            </div>
          ) : null}
        </section>
      </div>

      {showChangeList ? (
        <section className="resume-change-workspace">
          <header>
            <div><h3>对照岗位的修改建议</h3><p>逐项核对系统建议，必要时直接编辑。</p></div>
            <small>{version?.change_count} 项</small>
          </header>
          <div className="resume-change-list">
            {version?.changes.map((change) => (
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
      ) : null}
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

function ResumePreviewBlockView({ block }: { block: ResumePreviewBlock }) {
  if (block.type === "title") {
    const contact = (block.contact || []).filter(Boolean);
    const target = block.target?.trim() || "";
    const { name, role } = splitDocumentName(block.text || "");
    const subtitle = role && role !== name ? role : "";
    return (
      <div className="resume-preview-header">
        {name ? <p className="resume-preview-title">{name}</p> : null}
        {subtitle ? <p className="resume-preview-role">{subtitle}</p> : null}
        {contact.length ? <p className="resume-preview-contact">{contact.join("  ·  ")}</p> : null}
        {target ? <p className="resume-preview-target">{target.startsWith("求职") ? target : `求职意向：${target}`}</p> : null}
      </div>
    );
  }
  if (block.type === "heading") return <p className="resume-preview-section">{block.label}</p>;
  if (block.type === "skills") {
    return (
      <div className="resume-skill-chips">
        {block.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
    );
  }
  return (
    <div className="resume-compact-entry">
      {block.lines.map((line, lineIndex) => {
        if (lineIndex === 0) {
          const { title, date } = splitEntryHeading(line);
          return (
            <p className="resume-entry-heading" key={`${block.id}-${lineIndex}`}>
              <span className="resume-compact-entry-title">{title || line}</span>
              {date ? <span className="resume-entry-date">{date}</span> : null}
            </p>
          );
        }
        return (
          <p className="resume-preview-bullet" key={`${block.id}-${lineIndex}`}>
            {line}
          </p>
        );
      })}
    </div>
  );
}

function groupResumePreviewBlocks(blocks: ResumePreviewBlock[]) {
  const title = blocks.find((block) => block.type === "title") ?? null;
  const groups: Array<{ key: string; lane: ResumePreviewBlock["lane"]; items: ResumePreviewBlock[] }> = [];
  for (const block of blocks) {
    if (block.type === "title") continue;
    const current = groups.at(-1);
    if (block.type !== "heading" && current && current.lane === block.lane && current.items[0] && "sectionKind" in current.items[0] && "sectionKind" in block && (current.items[0].sectionId ?? current.items[0].sectionKind) === (block.sectionId ?? block.sectionKind)) {
      current.items.push(block);
      continue;
    }
    groups.push({
      key: block.type === "heading" ? `${block.lane}-${block.sectionKind}` : block.id,
      lane: block.lane,
      items: [block]
    });
  }
  return { title, groups };
}

function ResumePagedSheet({
  blocks,
  templateId,
  measure = false,
  focus = null
}: {
  blocks: ResumePreviewBlock[];
  templateId: ResumeTemplate;
  measure?: boolean;
  focus?: StudioPreviewFocus | null;
}) {
  const { title, groups } = groupResumePreviewBlocks(blocks);
  const renderBlock = (block: ResumePreviewBlock) => (
    measure
      ? <div data-resume-block={block.id} key={block.id}><ResumePreviewBlockView block={block} /></div>
      : <ResumePreviewBlockView block={block} key={block.id} />
  );
  const renderGroup = (group: (typeof groups)[number]) => {
    const sectionKind = group.items[0] && group.items[0].type !== "title" && "sectionKind" in group.items[0]
      ? group.items[0].sectionKind
      : undefined;
    return (
      <div
        className={`resume-compact-section${ !measure && shouldHighlightPreviewGroup(group.items, focus, blocks) ? " is-preview-focus" : ""}`}
        data-resume-section={measure ? undefined : sectionKind}
        key={group.key}
      >
        {group.items.map(renderBlock)}
      </div>
    );
  };
  const titleNode = title
    ? measure
      ? renderBlock(title)
      : (
        <div
          data-resume-section="title"
          className={shouldHighlightPreviewBlock(title, focus, blocks) ? "is-preview-focus" : undefined}
        >
          {renderBlock(title)}
        </div>
      )
    : null;
  const sidebar = groups.filter((group) => group.lane === "sidebar");
  const main = groups.filter((group) => group.lane === "main");
  const rest = groups.filter((group) => group.lane === "full");
  const useColumns = templateId === "compact" && sidebar.length > 0 && main.length > 0;
  const sheetClass = templateId === "compact" ? "resume-compact-sheet" : "resume-linear-sheet";

  return (
    <div className={sheetClass}>
      {titleNode}
      {useColumns ? (
        <div className="resume-compact-grid">
          <div className="resume-compact-sidebar" aria-label={measure ? undefined : "简历侧栏"} aria-hidden={measure || undefined}>
            {sidebar.map(renderGroup)}
          </div>
          <div className="resume-compact-main">
            {main.map(renderGroup)}
          </div>
        </div>
      ) : templateId === "compact" ? (
        <div className="resume-compact-main">
          {[...sidebar, ...main, ...rest].map(renderGroup)}
        </div>
      ) : (
        [...sidebar, ...main, ...rest].map(renderGroup)
      )}
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
  compact?: boolean;
  job: JobProject | null;
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
  compact = false,
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
  const kitPicker = section === "preparation" ? (
    <div className="interview-kit-picker">
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
        disabled={busy || !job}
        onChange={(event) => setNewKitType(event.target.value as InterviewType)}
      >
        {Object.entries(interviewTypeLabels).map(([value, label]) => (
          <option value={value} key={value}>{label}</option>
        ))}
      </select>
      <button disabled={busy || !job} onClick={() => job && void onCreateKit(job, newKitType)}>
        <Plus size={14} />新建准备包
      </button>
    </div>
  ) : null;

  return (
    <section className={`interview-workflow-panel${compact ? " is-workspace" : ""}`}>
      {compact ? kitPicker : (
        <header className="interview-workflow-heading">
          <div>
            <span className="analysis-kicker">{section === "preparation" ? "面试重点问答" : "面试记录与复盘"}</span>
            <h2>{section === "preparation" ? "用真实经历准备重点问答" : "记录真实问题、反馈和下一步动作"}</h2>
            <p>{section === "preparation"
              ? "准备包只引用脱敏简历证据，问题预测、STAR 素材和准备清单可持续更新。"
              : "面试安排、结果和手工备注会进入当前岗位的面试时间线。"}</p>
          </div>
          {kitPicker}
        </header>
      )}

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
                        <em>{question.status === "matched" ? "简历里有原文" : question.status === "partial" ? "部分对得上" : "简历没写到"}</em>
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

      {section === "progress" && job ? <div className="interview-progress-grid">
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
