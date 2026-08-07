import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentSubscriber, HttpAgent as HttpAgentType } from "@ag-ui/client";
import { createApiClient } from "./api/client";
import { AppSidebar } from "./components/AppSidebar";
import type { AgentRunResult, AttachmentConfig, ChatAttachment, ChatMessage, ChatRetryDraft } from "./components/ChatWorkspace";
import { IconButton, SectionHeader } from "./components/ui";
import {
  captureBrowserJobPage,
  detectBrowserBridge,
  openBrowserJobPage
} from "./features/browser/browserBridge";
import {
  bossHomeUrl,
  defaultAgentSettings,
  emptyCandidateEditor,
  pageMeta
} from "./constants";
import { appRouteHash, initialAppRoute, parseAppHash, routeForSection, type AppRoute } from "./routing";
import type {
  AgentCapabilities,
  AgentOperationsSnapshot,
  AgentSettings,
  CandidateEditor,
  CareerProfileBundle,
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
  ResumeChangeDecision,
  ResumeProfileSuggestion,
  ResumeVersion,
  ResumeVersionSummary,
  ModelServiceMonitor,
  ViewKey,
  WorkflowStatus
} from "./types";
import {
  CheckCircle2,
  Database,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  TriangleAlert,
  X
} from "lucide-react";
import "./styles/foundations.css";
import "./styles.css";
import "./styles/primitives.css";

const ChatWorkspace = lazy(() => import("./components/ChatWorkspace").then((module) => ({
  default: module.ChatWorkspace
})));

const WorkbenchView = lazy(() => import("./components/WorkspaceViews").then((module) => ({
  default: module.WorkbenchView
})));

const DashboardView = lazy(() => import("./components/WorkspaceViews").then((module) => ({
  default: module.DashboardView
})));

const AgentOperationsDashboard = lazy(() => import("./features/settings/AgentOperationsDashboard").then((module) => ({
  default: module.AgentOperationsDashboard
})));

const SettingsWorkspace = lazy(() => import("./features/settings/SettingsWorkspace").then((module) => ({
  default: module.SettingsWorkspace
})));

const SettingsOverview = lazy(() => import("./features/settings/SettingsWorkspace").then((module) => ({
  default: module.SettingsOverview
})));

const ProfileSettingsPage = lazy(() => import("./features/settings/ProfileSettingsPage").then((module) => ({
  default: module.ProfileSettingsPage
})));

const ModelSettingsPage = lazy(() => import("./features/settings/ModelSettingsPage").then((module) => ({
  default: module.ModelSettingsPage
})));

const OpportunityDiscoveryPage = lazy(() => import("./features/opportunities/OpportunityDiscoveryPage").then((module) => ({
  default: module.OpportunityDiscoveryPage
})));

const JobEvaluationPage = lazy(() => import("./features/jobs/JobEvaluationPage").then((module) => ({
  default: module.JobEvaluationPage
})));

function PageLoading({ label }: { label: string }) {
  return (
    <div className="page-loading" role="status">
      <LoaderCircle className="spinning" size={18} />
      <span>{label}</span>
    </div>
  );
}

function App() {
  const apiBase = useMemo(() => `${window.location.protocol}//${window.location.hostname}:8000`, []);
  const fetchJson = useMemo(() => createApiClient(apiBase), [apiBase]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem("bosscopilot-sidebar") === "collapsed");
  const [appRoute, setAppRoute] = useState<AppRoute>(() => initialAppRoute(
    window.location.hash,
    window.localStorage.getItem("bosscopilot-view")
  ));
  const activeView: ViewKey = appRoute.section;
  const [workflow, setWorkflow] = useState<WorkflowStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [jobs, setJobs] = useState<JobProject[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [jobImportBusy, setJobImportBusy] = useState(false);
  const [jobImportActivity, setJobImportActivity] = useState<JobImportActivityEvent[]>([]);
  const [browserJobImportAvailable, setBrowserJobImportAvailable] = useState(false);
  const [browserJobTabId, setBrowserJobTabId] = useState<number | null>(null);
  const [browserJobOpened, setBrowserJobOpened] = useState(false);
  const [jobEvaluation, setJobEvaluation] = useState<JobEvaluation | null>(null);
  const [jobEvaluationBusy, setJobEvaluationBusy] = useState(false);
  const [resumeVersions, setResumeVersions] = useState<ResumeVersionSummary[]>([]);
  const [resumeVersion, setResumeVersion] = useState<ResumeVersion | null>(null);
  const [resumeVersionBusy, setResumeVersionBusy] = useState(false);
  const [interviewKits, setInterviewKits] = useState<InterviewKitSummary[]>([]);
  const [interviewKit, setInterviewKit] = useState<InterviewKit | null>(null);
  const [interviewRounds, setInterviewRounds] = useState<InterviewRound[]>([]);
  const [jobTimeline, setJobTimeline] = useState<JobEvent[]>([]);
  const [interviewBusy, setInterviewBusy] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const currentConversationIdRef = useRef<number | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(12);
  const [chatBusy, setChatBusy] = useState(false);
  const [retryChatDraft, setRetryChatDraft] = useState<ChatRetryDraft | null>(null);
  const chatAgentRef = useRef<HttpAgentType | null>(null);
  const [taskCancelBusy, setTaskCancelBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [opportunityRefreshKey, setOpportunityRefreshKey] = useState(0);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [attachmentConfig, setAttachmentConfig] = useState<AttachmentConfig | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [candidateEditor, setCandidateEditor] = useState(emptyCandidateEditor);
  const [confirmedCareerFactCount, setConfirmedCareerFactCount] = useState(0);
  const [candidateProfileBusy, setCandidateProfileBusy] = useState(false);
  const [resumeParseBusy, setResumeParseBusy] = useState(false);
  const [chatAttachmentBusy, setChatAttachmentBusy] = useState(false);
  const [enhancedResumeParse, setEnhancedResumeParse] = useState(false);
  const [privacyFindings, setPrivacyFindings] = useState<Array<{ entity_type: string; preview: string }>>([]);
  const [resumeProfileSuggestion, setResumeProfileSuggestion] = useState<ResumeProfileSuggestion | null>(null);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(defaultAgentSettings);
  const [savedAgentSettings, setSavedAgentSettings] = useState<AgentSettings>(defaultAgentSettings);
  const [agentSettingsBusy, setAgentSettingsBusy] = useState(false);
  const [modelSettingsEditing, setModelSettingsEditing] = useState(false);
  const [modelMonitor, setModelMonitor] = useState<ModelServiceMonitor | null>(null);
  const [modelMonitorBusy, setModelMonitorBusy] = useState(false);
  const [agentOperations, setAgentOperations] = useState<AgentOperationsSnapshot | null>(null);
  const [agentOperationsDays, setAgentOperationsDays] = useState<7 | 30 | 90>(7);
  const [agentOperationsBusy, setAgentOperationsBusy] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelDiscoveryBusy, setModelDiscoveryBusy] = useState(false);
  const [modelDiscoveryError, setModelDiscoveryError] = useState("");
  const modelDiscoveryKeyRef = useRef("");
  const currentConversation = conversations.find((item) => item.id === currentConversationId) ?? null;

  function navigateRoute(route: AppRoute, replace = false) {
    const nextHash = appRouteHash(route);
    setAppRoute(route);
    if (replace) {
      window.history.replaceState(null, "", nextHash);
    } else if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }

  function setActiveView(view: ViewKey) {
    navigateRoute(routeForSection(view));
  }

  useEffect(() => {
    const canonicalHash = appRouteHash(initialAppRoute(
      window.location.hash,
      window.localStorage.getItem("bosscopilot-view")
    ));
    if (window.location.hash !== canonicalHash) {
      window.history.replaceState(null, "", canonicalHash);
    }
    function syncRoute() {
      const next = parseAppHash(window.location.hash);
      if (next) setAppRoute(next);
      else navigateRoute({ section: "workbench" }, true);
    }
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    if (appRoute.section !== "workbench") return;
    if (["detail", "evaluation", "evaluation_section", "evaluation_deep"].includes(appRoute.page || "") && appRoute.jobId) {
      setSelectedJobId(appRoute.jobId);
      return;
    }
    setSelectedJobId(null);
  }, [appRoute]);

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson<{
        enabled: boolean;
        capabilities: string[];
      }>("/browser/capabilities"),
      detectBrowserBridge()
    ])
      .then(([backend, extension]) => {
        if (cancelled) return;
        setBrowserJobImportAvailable(
          backend.enabled
          && backend.capabilities.includes("job_page_capture")
          && extension.available
          && extension.capabilities.includes("job_page_capture")
        );
      })
      .catch(() => {
        if (!cancelled) setBrowserJobImportAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchJson]);

  useEffect(() => {
    window.localStorage.setItem("bosscopilot-view", activeView);
  }, [activeView]);

  useEffect(() => {
    if (!noticeMessage) return;
    const timer = window.setTimeout(() => setNoticeMessage(""), 4200);
    return () => window.clearTimeout(timer);
  }, [noticeMessage]);

  useEffect(() => {
    function focusComposer(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.matches("input, textarea, select, [contenteditable='true']");
      if (event.key === "/" && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setActiveView("chat");
        window.setTimeout(() => chatInputRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", focusComposer);
    return () => window.removeEventListener("keydown", focusComposer);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("bosscopilot-sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  const hasProfile = (workflow?.counts.profiles ?? 0) > 0;
  const workbenchProfileReady = hasProfile && confirmedCareerFactCount > 0;
  const hiddenMessageCount = Math.max(0, chatMessages.length - visibleMessageCount);
  const visibleChatMessages = chatMessages.slice(-visibleMessageCount);
  const latestAgent = [...chatMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.payload?.agent)?.payload?.agent;
  const waitingForUser = latestAgent?.status === "waiting_user";
  const nextStep = !hasProfile
    ? { title: "先建立职业画像", detail: "可以在主聊天完成访谈，也可以在画像中心导入简历。", action: "打开设置", kind: "settings" as const }
    : !workbenchProfileReady
      ? { title: "确认候选人事实", detail: "待确认知识不会参与岗位评分；请先在画像中心核对证据。", action: "审核画像", kind: "settings" as const }
      : { title: "分析一个岗位 JD", detail: "把 BOSS 岗位 JD 粘贴到输入框，或上传你自己保存的岗位截图。", action: "开始分析", kind: "chat" as const };

  async function refreshData(showFeedback = false, conversationId = currentConversationId) {
    if (showFeedback) setRefreshBusy(true);
    try {
      const nextWorkflow = await fetchJson<WorkflowStatus>(`/workflow/status${conversationId ? `?conversation_id=${conversationId}` : ""}`);
      setWorkflow(nextWorkflow);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "数据刷新失败");
    } finally {
      if (showFeedback) setRefreshBusy(false);
    }
  }

  async function refreshCurrentRoute() {
    setRefreshBusy(true);
    setErrorMessage("");
    try {
      if (appRoute.section === "opportunities") {
        setOpportunityRefreshKey((value) => value + 1);
      } else if (appRoute.section === "workbench") {
        await Promise.all([refreshJobs(), refreshCandidateProfile(), refreshData()]);
      } else if (appRoute.section === "dashboard") {
        await Promise.all([refreshData(), refreshConversations(), refreshJobs()]);
      } else if (appRoute.section === "settings") {
        if (appRoute.page === "profile") {
          await refreshCandidateProfile();
        } else if (appRoute.page === "model") {
          await Promise.all([refreshAgentSettings(), refreshModelMonitor()]);
        } else if (appRoute.page === "agent") {
          await refreshAgentOperations(agentOperationsDays, false);
        } else {
          await Promise.all([
            refreshCandidateProfile(),
            refreshAgentSettings(),
            refreshModelMonitor(),
            refreshAgentOperations(7, false)
          ]);
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新当前页面失败");
    } finally {
      setRefreshBusy(false);
    }
  }

  async function refreshChat(conversationId = currentConversationId) {
    if (!conversationId) return;
    setChatMessages(await fetchJson<ChatMessage[]>(`/chat/messages?conversation_id=${conversationId}`));
  }

  async function refreshConversations() {
    const next = await fetchJson<Conversation[]>("/conversations");
    setConversations(next);
    return next;
  }

  async function refreshJobs() {
    const next = await fetchJson<JobProject[]>("/jobs");
    setJobs(next);
    setSelectedJobId((current) => (
      current && next.some((job) => job.id === current)
        ? current
        : null
    ));
    return next;
  }

  async function createJobComparison(evaluationIds: number[]): Promise<number> {
    setJobEvaluationBusy(true);
    setErrorMessage("");
    try {
      const comparison = await fetchJson<{ id: number }>("/job-comparisons", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluation_ids: evaluationIds })
      });
      navigateRoute({ section: "workbench", page: "comparison", comparisonId: comparison.id });
      return comparison.id;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "岗位比较失败");
      throw error;
    } finally {
      setJobEvaluationBusy(false);
    }
  }

  async function refreshResumeVersions(
    jobId: number,
    preferredVersionId?: number
  ): Promise<ResumeVersionSummary[]> {
    const versions = await fetchJson<ResumeVersionSummary[]>(
      `/jobs/${jobId}/resume-versions`
    );
    setResumeVersions(versions);
    const versionId = preferredVersionId ?? versions[0]?.id;
    if (!versionId) {
      setResumeVersion(null);
      return versions;
    }
    const version = await fetchJson<ResumeVersion>(`/resume-versions/${versionId}`);
    setResumeVersion(version);
    return versions;
  }

  async function createTailoredResumeVersion(job: JobProject): Promise<ResumeVersion> {
    setResumeVersionBusy(true);
    setErrorMessage("");
    try {
      const version = await fetchJson<ResumeVersion>(
        `/jobs/${job.id}/resume-versions`,
        { method: "POST" }
      );
      setResumeVersion(version);
      await refreshResumeVersions(job.id, version.id);
      setNoticeMessage("定制简历版本已生成。每项修改都可以单独确认或编辑。");
      return version;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "生成定制简历失败");
      throw error;
    } finally {
      setResumeVersionBusy(false);
    }
  }

  async function selectResumeVersion(versionId: number) {
    setResumeVersionBusy(true);
    setErrorMessage("");
    try {
      setResumeVersion(await fetchJson<ResumeVersion>(`/resume-versions/${versionId}`));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取简历版本失败");
    } finally {
      setResumeVersionBusy(false);
    }
  }

  async function updateTailoredResumeChange(
    versionId: number,
    changeId: number,
    patch: {
      decision?: ResumeChangeDecision;
      after_text?: string;
    }
  ) {
    setResumeVersionBusy(true);
    setErrorMessage("");
    try {
      const version = await fetchJson<ResumeVersion>(
        `/resume-versions/${versionId}/changes/${changeId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
        }
      );
      setResumeVersion(version);
      const summary: ResumeVersionSummary = {
        id: version.id,
        job_id: version.job_id,
        profile_id: version.profile_id,
        evaluation_id: version.evaluation_id,
        title: version.title,
        status: version.status,
        change_count: version.change_count,
        change_counts: version.change_counts,
        created_at: version.created_at,
        updated_at: version.updated_at
      };
      setResumeVersions((current) => current.map((item) => (
        item.id === version.id
          ? { ...item, ...summary }
          : item
      )));
      setNoticeMessage(
        patch.after_text !== undefined
          ? "修改已保存，并标记为用户编辑内容。"
          : patch.decision === "rejected"
            ? "已拒绝这项修改。"
            : patch.decision === "accepted"
              ? "已接受这项修改。"
              : "已恢复为待确认状态。"
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存简历修改失败");
    } finally {
      setResumeVersionBusy(false);
    }
  }

  async function updateTailoredResumeVersion(
    versionId: number,
    status: "draft" | "final"
  ) {
    setResumeVersionBusy(true);
    setErrorMessage("");
    try {
      const version = await fetchJson<ResumeVersion>(`/resume-versions/${versionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      setResumeVersion(version);
      if (selectedJobId) await refreshResumeVersions(selectedJobId, version.id);
      setNoticeMessage(status === "final" ? "该简历版本已标记为最终版。" : "已恢复为草稿。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "更新简历版本失败");
    } finally {
      setResumeVersionBusy(false);
    }
  }

  async function exportTailoredResume(versionId: number, format: "docx" | "pdf") {
    setResumeVersionBusy(true);
    setErrorMessage("");
    try {
      const response = await fetch(
        `${apiBase}/resume-versions/${versionId}/export?format=${format}`
      );
      if (!response.ok) {
        let message = `导出失败（${response.status}）`;
        try {
          const payload = await response.json() as { detail?: string };
          if (payload.detail) message = payload.detail;
        } catch {
          // 非 JSON 错误响应保留状态码。
        }
        throw new Error(message);
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const filename = encodedName
        ? decodeURIComponent(encodedName)
        : `定制简历.${format}`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNoticeMessage(`${format.toUpperCase()} 文件已生成。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "导出简历失败");
    } finally {
      setResumeVersionBusy(false);
    }
  }

  async function refreshInterviewWorkspace(
    jobId: number,
    preferredKitId?: number
  ) {
    const [kits, rounds, timeline] = await Promise.all([
      fetchJson<InterviewKitSummary[]>(`/jobs/${jobId}/interview-kits`),
      fetchJson<InterviewRound[]>(`/jobs/${jobId}/interview-rounds`),
      fetchJson<JobEvent[]>(`/jobs/${jobId}/timeline`)
    ]);
    setInterviewKits(kits);
    setInterviewRounds(rounds);
    setJobTimeline(timeline);
    const kitId = preferredKitId ?? kits[0]?.id;
    if (!kitId) {
      setInterviewKit(null);
      return;
    }
    setInterviewKit(await fetchJson<InterviewKit>(`/interview-kits/${kitId}`));
  }

  async function createInterviewPreparation(
    job: JobProject,
    interviewType: InterviewType = "general"
  ): Promise<InterviewKit> {
    setInterviewBusy(true);
    setErrorMessage("");
    try {
      const kit = await fetchJson<InterviewKit>(`/jobs/${job.id}/interview-kits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interview_type: interviewType })
      });
      setInterviewKit(kit);
      await refreshInterviewWorkspace(job.id, kit.id);
      setNoticeMessage("面试准备包已生成，问题、证据和行动清单已保存在本地。");
      return kit;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "生成面试准备包失败");
      throw error;
    } finally {
      setInterviewBusy(false);
    }
  }

  async function selectInterviewKit(kitId: number) {
    setInterviewBusy(true);
    setErrorMessage("");
    try {
      setInterviewKit(await fetchJson<InterviewKit>(`/interview-kits/${kitId}`));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取面试准备包失败");
    } finally {
      setInterviewBusy(false);
    }
  }

  async function updateInterviewPreparation(
    kitId: number,
    patch: {
      status?: "draft" | "ready";
      self_intro?: string;
      notes?: string;
    }
  ) {
    setInterviewBusy(true);
    setErrorMessage("");
    try {
      const kit = await fetchJson<InterviewKit>(`/interview-kits/${kitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      setInterviewKit(kit);
      setInterviewKits((current) => current.map((item) => (
        item.id === kit.id
          ? {
              id: kit.id,
              job_id: kit.job_id,
              profile_id: kit.profile_id,
              evaluation_id: kit.evaluation_id,
              interview_type: kit.interview_type,
              title: kit.title,
              status: kit.status,
              task_count: kit.task_count,
              completed_task_count: kit.completed_task_count,
              created_at: kit.created_at,
              updated_at: kit.updated_at
            }
          : item
      )));
      setNoticeMessage(patch.status === "ready" ? "准备包已标记为就绪。" : "面试准备内容已保存。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存面试准备包失败");
    } finally {
      setInterviewBusy(false);
    }
  }

  async function toggleInterviewTask(kitId: number, taskId: number, completed: boolean) {
    setInterviewBusy(true);
    setErrorMessage("");
    try {
      const kit = await fetchJson<InterviewKit>(
        `/interview-kits/${kitId}/tasks/${taskId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed })
        }
      );
      setInterviewKit(kit);
      setInterviewKits((current) => current.map((item) => (
        item.id === kit.id
          ? {
              ...item,
              completed_task_count: kit.completed_task_count,
              updated_at: kit.updated_at
            }
          : item
      )));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "更新准备任务失败");
    } finally {
      setInterviewBusy(false);
    }
  }

  async function createInterviewSchedule(
    jobId: number,
    payload: {
      kit_id?: number;
      round_type: InterviewType;
      scheduled_at?: string;
      interviewer?: string;
      location?: string;
      notes?: string;
    }
  ) {
    setInterviewBusy(true);
    setErrorMessage("");
    try {
      await fetchJson<InterviewRound>(`/jobs/${jobId}/interview-rounds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await Promise.all([refreshInterviewWorkspace(jobId, interviewKit?.id), refreshJobs()]);
      setNoticeMessage("面试轮次已记录，岗位状态已同步更新。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "记录面试轮次失败");
    } finally {
      setInterviewBusy(false);
    }
  }

  async function updateInterviewSchedule(
    roundId: number,
    patch: {
      status?: "scheduled" | "completed" | "cancelled";
      outcome?: "pending" | "passed" | "failed";
      notes?: string;
    }
  ) {
    setInterviewBusy(true);
    setErrorMessage("");
    try {
      await fetchJson<InterviewRound>(`/interview-rounds/${roundId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (selectedJobId) await refreshInterviewWorkspace(selectedJobId, interviewKit?.id);
      setNoticeMessage("面试结果已更新并写入岗位时间线。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "更新面试轮次失败");
    } finally {
      setInterviewBusy(false);
    }
  }

  async function addTimelineNote(jobId: number, title: string, detail: string) {
    setInterviewBusy(true);
    setErrorMessage("");
    try {
      await fetchJson<JobEvent>(`/jobs/${jobId}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, detail })
      });
      await refreshInterviewWorkspace(jobId, interviewKit?.id);
      setNoticeMessage("进展备注已加入岗位时间线。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存进展备注失败");
    } finally {
      setInterviewBusy(false);
    }
  }

  async function saveJobProject(
    draft: JobProjectDraft,
    jobId: number | null
  ): Promise<JobProject> {
    setJobBusy(true);
    setErrorMessage("");
    try {
      const saved = await fetchJson<JobProject>(jobId ? `/jobs/${jobId}` : "/jobs", {
        method: jobId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      await Promise.all([refreshJobs(), refreshConversations()]);
      setSelectedJobId(saved.status === "archived" ? null : saved.id);
      if (!jobId || saved.status === "archived") {
        setJobEvaluation(null);
        setResumeVersions([]);
        setResumeVersion(null);
        setInterviewKits([]);
        setInterviewKit(null);
        setInterviewRounds([]);
        setJobTimeline([]);
      }
      setNoticeMessage(jobId ? "岗位项目已更新。" : "岗位项目已保存，并创建了独立对话。");
      return saved;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存岗位项目失败");
      throw error;
    } finally {
      setJobBusy(false);
    }
  }

  async function consumeJobImportStream(
    path: string,
    body: Record<string, unknown>
  ): Promise<JobImportPreview> {
    const response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      let message = `岗位链接解析失败（${response.status}）`;
      try {
        const payload = await response.json() as { detail?: string };
        if (payload.detail) message = payload.detail;
      } catch {
        // 保留状态码错误。
      }
      throw new Error(message);
    }
    if (!response.body) throw new Error("浏览器不支持智能体流式响应");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const previewResults: JobImportPreview[] = [];

    const consumeLine = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as (
        JobImportActivityEvent
        | { type: "result"; preview: JobImportPreview }
        | { type: "error"; message: string }
      );
      if (event.type === "result") {
        previewResults.push(event.preview);
        return;
      }
      if (event.type === "error") throw new Error(event.message);
      setJobImportActivity((current) => {
        const index = current.findIndex((item) => item.id === event.id);
        if (index < 0) return [...current, event];
        const next = [...current];
        next[index] = event;
        return next;
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(consumeLine);
      if (done) break;
    }
    consumeLine(buffer);
    const preview = previewResults[previewResults.length - 1];
    if (!preview) throw new Error("岗位导入智能体没有返回最终结果");
    return preview;
  }

  async function previewJobLink(url: string): Promise<JobImportPreview> {
    setJobImportBusy(true);
    setBrowserJobOpened(false);
    setBrowserJobTabId(null);
    setJobImportActivity([]);
    setErrorMessage("");
    try {
      const preview = await consumeJobImportStream(
        "/job-imports/preview/stream",
        {
          url,
          browser_capture_available: browserJobImportAvailable
        }
      );
      setNoticeMessage(
        preview.status === "ready"
          ? "岗位链接已解析，请确认内容后保存。"
          : preview.status === "partial"
            ? "已读取部分岗位信息，请补充缺失内容后保存。"
            : preview.status === "browser_required"
              ? "公开读取受限，可以从 Chrome 读取当前岗位。"
            : preview.stop_reason || "该页面不适合继续解析，已停止读取。"
      );
      return preview;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "岗位链接解析失败");
      throw error;
    } finally {
      setJobImportBusy(false);
    }
  }

  async function openJobInBrowser(url: string): Promise<{ tabId: number; opened: boolean; reused: boolean }> {
    setJobImportBusy(true);
    setErrorMessage("");
    setJobImportActivity((current) => [
      ...current,
      {
        type: "task",
        id: "browser-extension-open",
        round: 0,
        tool: "browser_open_page",
        status: "running",
        message: "正在打开 Chrome 岗位页面"
      }
    ]);
    try {
      const extension = await detectBrowserBridge();
      const extensionReady = (
        extension.available
        && extension.capabilities.includes("job_page_open")
      );
      setBrowserJobImportAvailable(extensionReady);
      if (!extensionReady) {
        throw new Error("未检测到浏览器助手，请先在 Chrome 中加载扩展并刷新工作台");
      }
      const result = await openBrowserJobPage(url);
      setBrowserJobTabId(result.tabId);
      setBrowserJobOpened(true);
      setJobImportActivity((current) => current.map((event) => (
        event.id === "browser-extension-open"
          ? {
              ...event,
              status: "done",
              message: result.reused
                ? "已切换到之前打开的岗位标签页"
                : "已打开 Chrome 岗位标签页"
            }
          : event
      )));
      setNoticeMessage(
        "请在 Chrome 岗位页完成登录或安全验证，完成后回到这里点击“确认已登录，继续读取”。"
      );
      return result;
    } catch (error) {
      setJobImportActivity((current) => current.map((event) => (
        event.id === "browser-extension-open"
          ? {
              ...event,
              status: "failed",
              message: error instanceof Error ? error.message : "打开 Chrome 岗位页失败"
            }
          : event
      )));
      setErrorMessage(error instanceof Error ? error.message : "打开 Chrome 岗位页失败");
      throw error;
    } finally {
      setJobImportBusy(false);
    }
  }

  async function previewJobFromBrowser(
    url: string,
    tabId?: number
  ): Promise<JobImportPreview> {
    setJobImportBusy(true);
    setErrorMessage("");
    setJobImportActivity((current) => [
      ...current,
      {
        type: "task",
        id: "browser-extension-capture",
        round: 0,
        tool: "browser_read_page",
        status: "running",
        message: "正在从 Chrome 读取当前岗位页面"
      }
    ]);
    try {
      const extension = await detectBrowserBridge();
      const extensionReady = (
        extension.available
        && extension.capabilities.includes("job_page_capture")
      );
      setBrowserJobImportAvailable(extensionReady);
      if (!extensionReady) {
        throw new Error("未检测到浏览器助手，请先在 Chrome 中加载扩展并刷新岗位页面");
      }
      const capture = await captureBrowserJobPage(url, tabId ?? browserJobTabId ?? undefined);
      setJobImportActivity((current) => current.map((event) => (
        event.id === "browser-extension-capture"
          ? {
              ...event,
              status: "done",
              message: "已读取 Chrome 中的岗位页面"
            }
          : event
      )));
      const preview = await consumeJobImportStream(
        "/job-imports/browser-preview/stream",
        capture
      );
      setNoticeMessage(
        preview.status === "ready"
          ? "浏览器岗位页面已读取，请确认内容后保存。"
          : preview.stop_reason || "浏览器页面没有可导入的岗位内容。"
      );
      return preview;
    } catch (error) {
      setJobImportActivity((current) => current.map((event) => (
        event.id === "browser-extension-capture"
          ? {
              ...event,
              status: "failed",
              message: error instanceof Error ? error.message : "浏览器岗位读取失败"
            }
          : event
      )));
      setErrorMessage(error instanceof Error ? error.message : "浏览器岗位读取失败");
      throw error;
    } finally {
      setJobImportBusy(false);
    }
  }

  async function previewJobText(
    text: string,
    sourceUrl = ""
  ): Promise<JobImportPreview> {
    setJobImportBusy(true);
    setJobImportActivity([]);
    setErrorMessage("");
    try {
      const preview = await fetchJson<JobImportPreview>("/job-imports/text-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source_url: sourceUrl.trim() })
      });
      setNoticeMessage(
        preview.status === "ready"
          ? "岗位文字已完成字段识别，请确认内容后保存。"
          : "已读取部分岗位文字，请补充完整 JD 后保存。"
      );
      return preview;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "岗位文字解析失败");
      throw error;
    } finally {
      setJobImportBusy(false);
    }
  }

  async function previewJobScreenshot(file: File, sourceUrl = ""): Promise<JobImportPreview> {
    setJobImportBusy(true);
    setJobImportActivity([]);
    setErrorMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      if (sourceUrl.trim()) form.append("source_url", sourceUrl.trim());
      const preview = await fetchJson<JobImportPreview>("/job-imports/screenshot-preview", {
        method: "POST",
        body: form
      });
      setNoticeMessage(
        preview.status === "ready"
          ? "岗位截图已完成本地 OCR，请确认内容后保存。"
          : "截图已读取部分内容，请补充完整 JD 后保存。"
      );
      return preview;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "岗位截图解析失败");
      throw error;
    } finally {
      setJobImportBusy(false);
    }
  }

  async function removeJobProject(job: JobProject) {
    if (!window.confirm(`确定删除岗位项目“${job.job_title || job.company_name || "未命名岗位"}”吗？\n\n关联对话会保留，可继续查看历史结果。`)) return;
    setJobBusy(true);
    setErrorMessage("");
    try {
      await fetchJson(`/jobs/${job.id}`, { method: "DELETE" });
      await refreshJobs();
      setJobEvaluation(null);
      setResumeVersions([]);
      setResumeVersion(null);
      setInterviewKits([]);
      setInterviewKit(null);
      setInterviewRounds([]);
      setJobTimeline([]);
      setNoticeMessage("岗位项目已删除，关联对话历史仍然保留。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除岗位项目失败");
    } finally {
      setJobBusy(false);
    }
  }

  async function createNewConversation() {
    if (conversationBusy) return;
    setConversationBusy(true);
    try {
      const created = await fetchJson<Conversation>("/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新对话" })
      });
      await refreshConversations();
      setCurrentConversationId(created.id);
      setActiveView("chat");
      setNoticeMessage("已新建独立对话。求职画像仍会共享。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "新建对话失败");
    } finally {
      setConversationBusy(false);
    }
  }

  async function archiveConversation(conversation: Conversation) {
    setConversationBusy(true);
    try {
      await fetchJson(`/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: conversation.status === "active" ? "archived" : "active" })
      });
      const next = await refreshConversations();
      if (conversation.id === currentConversationId && conversation.status === "active") {
        setCurrentConversationId(next.find((item) => item.status === "active")?.id ?? next[0]?.id ?? null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "归档对话失败");
    } finally {
      setConversationBusy(false);
    }
  }

  async function renameConversation(conversation: Conversation) {
    const title = window.prompt("修改对话名称", conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    try {
      await fetchJson(`/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      await refreshConversations();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重命名失败");
    }
  }

  async function removeConversation(conversation: Conversation) {
    if (!window.confirm(`确定删除对话“${conversation.title}”吗？\n\n只删除该对话和任务记录，不会删除求职画像。`)) return;
    setConversationBusy(true);
    try {
      const result = await fetchJson<{ next_conversation: Conversation }>(`/conversations/${conversation.id}`, { method: "DELETE" });
      const next = await refreshConversations();
      if (conversation.id === currentConversationId) {
        setCurrentConversationId(result.next_conversation?.id ?? next[0]?.id ?? null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除对话失败");
    } finally {
      setConversationBusy(false);
    }
  }

  async function refreshCapabilities() {
    const next = await fetchJson<AgentCapabilities>("/agent/capabilities");
    setCapabilities(next);
  }

  async function refreshAttachmentConfig() {
    const next = await fetchJson<AttachmentConfig>("/attachments/config");
    setAttachmentConfig(next);
  }

  async function refreshAgentSettings() {
    const next = await fetchJson<AgentSettings>("/agent/settings");
    const clean = { ...next, api_key: "" };
    setAgentSettings(clean);
    setSavedAgentSettings(clean);
    setModelSettingsEditing(!next.api_key_configured);
    if (next.api_key_configured) {
      void discoverModels(clean, { silent: true });
    }
  }

  async function refreshModelMonitor() {
    const next = await fetchJson<ModelServiceMonitor>("/agent/model-monitor?hours=24");
    setModelMonitor(next);
    return next;
  }

  async function refreshAgentOperations(days = agentOperationsDays, showLoading = true) {
    if (showLoading) setAgentOperationsBusy(true);
    try {
      const next = await fetchJson<AgentOperationsSnapshot>(`/agent/operations?days=${days}&limit=20`);
      setAgentOperations(next);
      return next;
    } finally {
      if (showLoading) setAgentOperationsBusy(false);
    }
  }

  function changeAgentOperationsWindow(days: 7 | 30 | 90) {
    setAgentOperationsDays(days);
    void refreshAgentOperations(days).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "读取 Agent 运行记录失败");
    });
  }

  async function checkModelService() {
    setModelMonitorBusy(true);
    setErrorMessage("");
    try {
      const next = await fetchJson<ModelServiceMonitor>("/agent/model-monitor/check", {
        method: "POST"
      });
      setModelMonitor(next);
      setNoticeMessage(
        next.status === "healthy"
          ? "模型服务检测成功，连接与推理响应正常。"
          : `模型服务检测完成：${next.status_message}`
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "模型服务检测失败");
    } finally {
      setModelMonitorBusy(false);
    }
  }

  async function discoverModels(
    settings: AgentSettings,
    options: { silent?: boolean; force?: boolean } = {}
  ) {
    const discoveryKey = `${settings.model_base_url.trim()}|${settings.api_key ? "draft" : "saved"}`;
    if (!options.force && modelDiscoveryKeyRef.current === discoveryKey) return;
    modelDiscoveryKeyRef.current = discoveryKey;
    setModelDiscoveryBusy(true);
    setModelDiscoveryError("");
    if (!options.silent) setErrorMessage("");
    try {
      const result = await fetchJson<{ models: string[]; count: number }>(
        "/agent/models/discover",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model_base_url: settings.model_base_url,
            api_key: settings.api_key
          })
        }
      );
      setAvailableModels(result.models);
      if (!settings.model_name.trim() && result.models[0]) {
        setAgentSettings((current) => ({ ...current, model_name: result.models[0] }));
      }
      if (!options.silent) {
        setNoticeMessage(`已识别 ${result.count} 个可用模型。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "识别可用模型失败";
      setAvailableModels([]);
      setModelDiscoveryError(message);
      if (!options.silent) setErrorMessage(message);
    } finally {
      setModelDiscoveryBusy(false);
    }
  }

  function beginModelSettingsEdit() {
    if (!window.confirm("确认编辑模型连接或切换模型吗？\n\n设置将在再次确认保存后生效，编辑期间不会影响当前连接。")) return;
    setModelSettingsEditing(true);
  }

  function cancelModelSettingsEdit() {
    setAgentSettings({ ...savedAgentSettings, api_key: "" });
    setModelSettingsEditing(false);
    setModelDiscoveryError("");
  }

  async function saveAgentPreferences() {
    if (!window.confirm(`确认应用模型连接吗？\n\n模型：${agentSettings.model_name}\n服务：${agentSettings.model_base_url || "OpenAI 默认地址"}\n\n新的连接将从下一次模型调用开始生效。`)) return;
    setAgentSettingsBusy(true);
    setErrorMessage("");
    try {
      const saved = await fetchJson<AgentSettings>("/agent/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentSettings)
      });
      const clean = { ...saved, api_key: "" };
      setAgentSettings(clean);
      setSavedAgentSettings(clean);
      setModelSettingsEditing(false);
      modelDiscoveryKeyRef.current = "";
      await Promise.all([refreshCapabilities(), refreshModelMonitor()]);
      void discoverModels(clean, { silent: true, force: true });
      setNoticeMessage("模型设置已保存，将从下一条消息开始生效。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存 Agent 设置失败");
    } finally {
      setAgentSettingsBusy(false);
    }
  }

  async function resetCurrentContext() {
    if (!currentConversationId || !window.confirm("从当前位置开始新的上下文吗？\n\n历史消息仍然可见，但 Agent 后续不会再读取此前对话。人物画像不会删除。")) return;
    setAgentSettingsBusy(true);
    setErrorMessage("");
    try {
      await fetchJson(`/conversations/${currentConversationId}/context/reset`, { method: "POST" });
      await refreshConversations();
      setNoticeMessage("当前对话上下文已在此处截断，下一条消息将作为新的任务起点。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重置上下文失败");
    } finally {
      setAgentSettingsBusy(false);
    }
  }

  function splitList(value: string) {
    return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
  }

  async function refreshCandidateProfile() {
    const bundle = await fetchJson<CareerProfileBundle>("/career-profile");
    setResumeProfileSuggestion(null);
    if (!bundle.profile) {
      setConfirmedCareerFactCount(0);
      setCandidateEditor(emptyCandidateEditor);
      return;
    }
    const confirmedFacts = bundle.facts.filter((fact) => fact.status === "confirmed");
    const strategy = bundle.active_strategy;
    const skills = confirmedFacts
      .filter((fact) => fact.category === "skill")
      .map((fact) => String(fact.value?.name || fact.statement.replace(/^具备\s+|\s+相关经验$/g, "")));
    setConfirmedCareerFactCount(confirmedFacts.length);
    setCandidateEditor((current) => ({
      ...current,
      name: bundle.profile?.name || "",
      targetRole: strategy?.target_roles?.join("，") || "",
      targetCity: strategy?.locations?.join("，") || "",
      salaryMin: strategy?.salary?.min ? String(Math.round(strategy.salary.min / 1000)) : "",
      salaryMax: strategy?.salary?.max ? String(Math.round(strategy.salary.max / 1000)) : "",
      skills: skills.join("，"),
      industries: strategy?.industries?.join("，") || "",
      blockedKeywords: [...(strategy?.hard_constraints || []), ...(strategy?.blocked_keywords || [])].join("，"),
      blockedCompanies: strategy?.blocked_companies?.join("，") || "",
      resumeFilename: current.resumeFilename || bundle.sources.find((source) => source.source_type === "resume")?.title || "",
      privacyMode: bundle.profile?.privacy_mode || "redacted"
    }));
  }

  async function saveCandidateProfile(): Promise<boolean> {
    if (!candidateEditor.name.trim()) {
      setErrorMessage("请填写称呼");
      return false;
    }
    setCandidateProfileBusy(true);
    setErrorMessage("");
    try {
      await fetchJson("/career-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: candidateEditor.name.trim(),
          locale: "zh-CN",
          privacy_mode: candidateEditor.privacyMode
        })
      });
      let resumeSourceId: number | null = null;
      if (candidateEditor.resumeText.trim()) {
        const sourceResult = await fetchJson<{ source: { id: number } }>("/career-profile/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_type: "resume",
            title: candidateEditor.resumeFilename || "候选人简历",
            content: candidateEditor.resumeText,
            privacy_mode: candidateEditor.privacyMode,
            allow_model_original: candidateEditor.privacyMode === "original",
            extract_knowledge: true
          })
        });
        resumeSourceId = sourceResult.source.id;
        await fetchJson(`/career-profile/sources/${resumeSourceId}/access`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allow_model_original: candidateEditor.privacyMode === "original",
            privacy_mode: candidateEditor.privacyMode
          })
        });
      }
      await Promise.all(splitList(candidateEditor.skills).map((skill) => fetchJson("/career-profile/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "skill",
          canonical_key: `skill:${skill.toLowerCase()}`,
          statement: `具备 ${skill} 相关经验`,
          value: { name: skill },
          source_id: resumeSourceId,
          excerpt: resumeSourceId ? skill : "",
          sensitivity: "private"
        })
      })));
      const strategies = await fetchJson<Array<{ id: number; is_active: boolean }>>("/career-profile/strategies");
      const strategyPayload = {
        name: candidateEditor.targetRole.trim() || "主要求职方向",
        target_roles: splitList(candidateEditor.targetRole),
        regions: splitList(candidateEditor.targetCity),
        salary_min: candidateEditor.salaryMin ? Number(candidateEditor.salaryMin) * 1000 : null,
        salary_max: candidateEditor.salaryMax ? Number(candidateEditor.salaryMax) * 1000 : null,
        salary_currency: "CNY",
        industries: splitList(candidateEditor.industries),
        blocked_companies: splitList(candidateEditor.blockedCompanies),
        hard_constraints: splitList(candidateEditor.blockedKeywords),
        is_active: true,
        priority: 100
      };
      const activeStrategy = strategies.find((item) => item.is_active) || strategies[0];
      await fetchJson(activeStrategy ? `/career-profile/strategies/${activeStrategy.id}` : "/career-profile/strategies", {
        method: activeStrategy ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(strategyPayload)
      });
      await Promise.all([refreshCandidateProfile(), refreshData()]);
      setNoticeMessage("个人资料已保存在本地，Agent 后续分析会读取这些信息。");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存个人资料失败");
      return false;
    } finally {
      setCandidateProfileBusy(false);
    }
  }

  async function parseResumeFiles(files: File[]) {
    if (!files.length) return;
    setResumeParseBusy(true);
    setResumeProfileSuggestion(null);
    setErrorMessage("");
    try {
      type ParsedResume = { filename: string; text: string; redacted_text: string; privacy_findings: Array<{ entity_type: string; preview: string }>; suggested_skills: string[]; suggested_profile: ResumeProfileSuggestion; character_count: number; parser: string; warnings: string[] };
      const results: ParsedResume[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("mode", enhancedResumeParse ? "enhanced" : "fast");
        results.push(await fetchJson<ParsedResume>("/career-profile/resume/parse", {
          method: "POST",
          body: form
        }));
      }
      const text = results.map((result) => result.text.trim()).filter(Boolean).join("\n\n");
      const redactedText = results.map((result) => result.redacted_text.trim()).filter(Boolean).join("\n\n");
      const suggestions = results.map((result) => result.suggested_profile);
      const resultSuggestion: ResumeProfileSuggestion = {
        name: suggestions.find((item) => item.name)?.name || "",
        target_roles: Array.from(new Set(suggestions.flatMap((item) => item.target_roles))),
        target_cities: Array.from(new Set(suggestions.flatMap((item) => item.target_cities))),
        skills: Array.from(new Set(suggestions.flatMap((item) => item.skills)))
      };
      setCandidateEditor((current) => ({
        ...current,
        resumeText: text,
        resumeFilename: results.map((result) => result.filename).join("、").slice(0, 255),
        resumeRedactedText: redactedText
      }));
      setPrivacyFindings(results.flatMap((result) => result.privacy_findings));
      setResumeProfileSuggestion(resultSuggestion);
      const warnings = results.flatMap((result) => result.warnings);
      const fallback = warnings.length ? ` ${warnings.join("；")}。` : "";
      const characterCount = results.reduce((total, result) => total + result.character_count, 0);
      setNoticeMessage(`已按选择顺序解析 ${results.length} 份简历材料，提取 ${characterCount} 个字符。${fallback}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "简历解析失败");
    } finally {
      setResumeParseBusy(false);
    }
  }

  function fillProfileFromResume() {
    if (!resumeProfileSuggestion) return;
    setCandidateEditor((current) => {
      const currentSkills = splitList(current.skills);
      const mergedSkills = Array.from(new Set([...currentSkills, ...resumeProfileSuggestion.skills]));
      return {
        ...current,
        name: current.name.trim() || resumeProfileSuggestion.name,
        targetRole: current.targetRole.trim() || resumeProfileSuggestion.target_roles.join("，"),
        targetCity: current.targetCity.trim() || resumeProfileSuggestion.target_cities.join("，"),
        skills: mergedSkills.join("，")
      };
    });
    setResumeProfileSuggestion(null);
    setNoticeMessage("已从简历补充人物画像，原有内容未被覆盖；保存前仍可继续修改。");
  }

  async function scanResumePrivacy() {
    if (!candidateEditor.resumeText.trim()) return;
    setResumeParseBusy(true);
    setErrorMessage("");
    try {
      const result = await fetchJson<{ findings: Array<{ entity_type: string; preview: string }>; redacted_text: string }>("/career-profile/privacy/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: candidateEditor.resumeText })
      });
      setPrivacyFindings(result.findings);
      setCandidateEditor((current) => ({ ...current, resumeRedactedText: result.redacted_text }));
      setNoticeMessage(result.findings.length ? `本地检测到 ${result.findings.length} 处敏感信息，默认仅向 Agent 提供脱敏文本。` : "未检测到常见手机号、邮箱或身份证号。此结果不能代替人工检查。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "隐私检查失败");
    } finally {
      setResumeParseBusy(false);
    }
  }

  async function uploadChatAttachment(file: File): Promise<ChatAttachment> {
    if (!currentConversationId) throw new Error("请先选择一个对话");
    const filename = file.name.toLowerCase();
    const kind = /\.(png|jpe?g|webp)$/.test(filename) ? "job_screenshot" : /\.(pdf|docx|txt|md)$/.test(filename) ? "resume" : null;
    if (!kind) throw new Error("仅支持岗位截图（PNG、JPG、WEBP）或简历（PDF、DOCX、TXT、MD）");
    setChatAttachmentBusy(true);
    setErrorMessage("");
    let uploadedAttachmentId = "";
    try {
      const uploadForm = new FormData();
      uploadForm.append("conversation_id", String(currentConversationId));
      uploadForm.append("kind", kind);
      uploadForm.append("file", file);
      const attachment = await fetchJson<ChatAttachment>("/attachments", { method: "POST", body: uploadForm });
      uploadedAttachmentId = attachment.id;
      const parseForm = new FormData();
      parseForm.append("mode", "fast");
      const parsed = await fetchJson<ChatAttachment>(`/attachments/${attachment.id}/parse`, { method: "POST", body: parseForm });
      setNoticeMessage(
        kind === "resume"
          ? "简历已在本地解析并脱敏，可随下一条消息一同使用。"
          : attachmentConfig?.vision_ready
            ? "岗位截图已准备好，会随下一条消息一同发送给模型。"
            : "岗位截图已保存；当前图片直传未启用，发送时会提示配置问题。"
      );
      return parsed;
    } catch (error) {
      if (uploadedAttachmentId) {
        void fetchJson(`/attachments/${uploadedAttachmentId}`, { method: "DELETE" }).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : "附件上传或解析失败";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setChatAttachmentBusy(false);
    }
  }

  async function removeChatAttachment(attachmentId: string) {
    await fetchJson(`/attachments/${attachmentId}`, { method: "DELETE" });
    setNoticeMessage("附件已从本地临时存储中删除。");
  }

  async function sendChatMessage(
    contentOverride: string,
    attachmentIds: string[] = [],
    visionAttachmentIds: string[] = [],
    webSearch = false,
    conversationIdOverride?: number,
  ) {
    const content = contentOverride.trim();
    const targetConversationId = conversationIdOverride ?? currentConversationId;
    if (!content || chatBusy || !targetConversationId) return;
    const { HttpAgent } = await import("@ag-ui/client");
    const conversationId = targetConversationId;
    chatAgentRef.current?.abortRun();
    const optimisticId = -Date.now();
    const optimisticAssistantId = optimisticId - 1;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      role: "user",
      content,
      created_at: new Date().toISOString()
    };
    setChatBusy(true);
    setRetryChatDraft(null);
    setErrorMessage("");
    setNoticeMessage("");
    setChatMessages((current) => [...current, optimisticMessage]);
    let terminalReceived = false;

    const ensureStreamingAssistant = () => {
      setChatMessages((current) => current.some((message) => message.id === optimisticAssistantId)
        ? current
        : [...current, {
            id: optimisticAssistantId,
            role: "assistant",
            content: "",
            created_at: new Date().toISOString(),
            payload: {
              agent: {
                provider: "openai",
                platform: "manual",
                rounds: 0,
                status: "done",
                events: []
              }
            }
          }]);
    };

    const updateAgentEvent = (agentEvent: AgentRunResult["events"][number]) => {
      ensureStreamingAssistant();
      setChatMessages((current) => current.map((message) => {
        if (message.id !== optimisticAssistantId) return message;
        const agent = message.payload?.agent ?? {
          provider: "openai",
          platform: "manual",
          rounds: 0,
          status: "done" as const,
          events: []
        };
        const events = [
          ...agent.events.filter((item) => item.tool_call_id !== agentEvent.tool_call_id),
          agentEvent
        ];
        return { ...message, payload: { ...message.payload, agent: { ...agent, events } } };
      }));
    };

    const handleTerminal = (snapshot: {
      workflow: WorkflowStatus;
      bossCopilot: {
        status: "done" | "failed" | "cancelled" | "waiting_user";
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
      };
    }) => {
      terminalReceived = true;
      setWorkflow(snapshot.workflow);
      const { userMessage, assistantMessage, status } = snapshot.bossCopilot;
      if (currentConversationIdRef.current === conversationId) {
        setChatMessages((current) => [
          ...current.filter((message) => ![
            optimisticId,
            optimisticAssistantId,
            userMessage.id,
            assistantMessage.id
          ].includes(message.id)),
          userMessage,
          assistantMessage
        ]);
      }
      if (status === "cancelled") setNoticeMessage("已停止生成，当前已生成内容已保留。");
    };

    const agent = new HttpAgent({
      url: `${apiBase}/ag-ui`,
      agentId: "bosscopilot",
      threadId: String(conversationId),
      initialMessages: [
        ...chatMessages.map((message) => ({
          id: String(message.id),
          role: message.role,
          content: message.content
        })),
        { id: String(optimisticId), role: "user" as const, content }
      ],
      initialState: { conversationId }
    });
    chatAgentRef.current = agent;

    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        if (event.name === "bosscopilot.user_message") {
          const userMessage = event.value as ChatMessage;
          if (currentConversationIdRef.current === conversationId) {
            setChatMessages((current) => [
              ...current.filter((message) => ![optimisticId, userMessage.id].includes(message.id)),
              userMessage
            ]);
          }
        }
      },
      onTextMessageStartEvent: () => {
        ensureStreamingAssistant();
        setChatMessages((current) => current.map((message) =>
          message.id === optimisticAssistantId ? { ...message, content: "" } : message
        ));
      },
      onTextMessageContentEvent: ({ event }) => {
        ensureStreamingAssistant();
        setChatMessages((current) => current.map((message) =>
          message.id === optimisticAssistantId
            ? { ...message, content: message.content + event.delta }
            : message
        ));
      },
      onReasoningMessageStartEvent: ({ event }) => {
        updateAgentEvent({
          round: 0,
          tool_call_id: event.messageId,
          tool_name: "agent_thinking",
          status: "running",
          message: ""
        });
      },
      onReasoningMessageContentEvent: ({ event, reasoningMessageBuffer }) => {
        updateAgentEvent({
          round: 0,
          tool_call_id: event.messageId,
          tool_name: "agent_thinking",
          status: "running",
          message: reasoningMessageBuffer + event.delta
        });
      },
      onReasoningMessageEndEvent: ({ event, reasoningMessageBuffer }) => {
        updateAgentEvent({
          round: 0,
          tool_call_id: event.messageId,
          tool_name: "agent_thinking",
          status: "done",
          message: reasoningMessageBuffer
        });
      },
      onToolCallStartEvent: ({ event }) => {
        updateAgentEvent({
          round: 0,
          tool_call_id: event.toolCallId,
          tool_name: event.toolCallName,
          status: "running",
          message: `正在执行 ${event.toolCallName}`
        });
      },
      onToolCallResultEvent: ({ event }) => {
        try {
          updateAgentEvent(JSON.parse(event.content) as AgentRunResult["events"][number]);
        } catch {
          updateAgentEvent({
            round: 0,
            tool_call_id: event.toolCallId,
            tool_name: "agent_tool",
            status: "done",
            message: event.content
          });
        }
      },
      onStateSnapshotEvent: ({ event }) => {
        handleTerminal(event.snapshot as Parameters<typeof handleTerminal>[0]);
      },
      onRunErrorEvent: ({ event }) => {
        setErrorMessage(event.message || "流式执行失败");
      }
    };

    try {
      await agent.runAgent(
        {
          runId: crypto.randomUUID(),
          tools: [],
          context: [],
          forwardedProps: { conversationId, client: "bosscopilot-web", attachmentIds, visionAttachmentIds, webSearch }
        },
        subscriber
      );
      if (!terminalReceived) throw new Error("AG-UI 消息流意外中断，请重试");

      void Promise.all([refreshData(), refreshConversations()]).catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : "后台数据刷新失败");
      });
    } catch (error) {
      if (currentConversationIdRef.current === conversationId) {
        setChatMessages((current) => current.filter((message) => ![optimisticId, optimisticAssistantId].includes(message.id)));
      }
      if (error instanceof DOMException && error.name === "AbortError") return;
      setErrorMessage(error instanceof Error ? error.message : "消息发送失败");
      setRetryChatDraft({ content, attachmentIds, visionAttachmentIds, webSearch });
    } finally {
      if (chatAgentRef.current === agent) {
        chatAgentRef.current = null;
        setChatBusy(false);
      }
    }
  }

  async function stopChatGeneration() {
    if (!currentConversationId || !chatBusy || taskCancelBusy) return;
    setTaskCancelBusy(true);
    setErrorMessage("");
    try {
      const result = await fetchJson<{ cancelled: boolean }>(
        `/agent/tasks/current/cancel?conversation_id=${currentConversationId}`,
        { method: "POST" }
      );
      if (!result.cancelled) setNoticeMessage("当前没有可停止的生成任务。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停止生成失败");
    } finally {
      setTaskCancelBusy(false);
    }
  }

  async function rewindChatToUserMessage(userMessageId: number) {
    if (!currentConversationId) throw new Error("请先选择一个对话");
    await fetchJson(
      `/chat/messages/${userMessageId}/tail?conversation_id=${currentConversationId}`,
      { method: "DELETE" }
    );
    await Promise.all([
      refreshChat(currentConversationId),
      refreshConversations(),
      refreshData(false, currentConversationId)
    ]);
  }

  async function editChatMessage(userMessageId: number, content: string) {
    await rewindChatToUserMessage(userMessageId);
    await sendChatMessage(content);
  }

  async function regenerateChatMessage(userMessageId: number) {
    const sourceMessage = chatMessages.find(
      (message) => message.id === userMessageId && message.role === "user"
    );
    if (!sourceMessage) throw new Error("找不到要重新生成的用户消息");
    await rewindChatToUserMessage(userMessageId);
    await sendChatMessage(sourceMessage.content);
  }

  function openBoss() {
    setErrorMessage("");
    const bossWindow = window.open(bossHomeUrl, "_blank");
    if (!bossWindow) {
      setErrorMessage("浏览器阻止了新窗口，请允许本站打开弹窗，或手动访问 BOSS 官网");
      return;
    }
    bossWindow.opener = null;
    setNoticeMessage("已打开 BOSS 官网。当前页面可继续浏览；需要 Agent 处理时，可在对话中直接提出任务或提供岗位内容。 ");
  }

  function handleNextStep() {
    if (nextStep.kind === "settings") {
      navigateRoute({ section: "settings", page: "profile", returnTo: "workbench" });
    } else {
      setActiveView("chat");
      window.setTimeout(() => chatInputRef.current?.focus(), 0);
    }
  }

  function handleSuggestedAction() {
    if (!waitingForUser) {
      handleNextStep();
      return;
    }
    void sendChatMessage("检查刚才的失败原因，告诉我最简单的恢复步骤");
  }

  async function cancelCurrentTask() {
    setTaskCancelBusy(true);
    setErrorMessage("");
    try {
      await fetchJson(`/agent/tasks/current/cancel?conversation_id=${currentConversationId}`, { method: "POST" });
      await Promise.all([refreshChat(), refreshData(), refreshConversations()]);
      setNoticeMessage("当前任务已结束，你可以直接开始新的求职任务。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "结束当前任务失败");
    } finally {
      setTaskCancelBusy(false);
    }
  }

  useEffect(() => {
    async function initialize() {
      const database = await fetchJson<{
          status: "uninitialized" | "requires_rebuild" | "ready";
          reason?: string;
        }>("/system/database-status");
        if (database.status === "requires_rebuild") {
          const confirmed = window.confirm(
            "BossCopilot 2.0 需要重建本地数据库。\n\n继续前会自动生成带时间戳的完整备份；旧数据不会自动导入新画像。是否现在备份并重建？"
          );
          if (!confirmed) {
            throw new Error("已取消数据库重建。当前旧数据库保持不变，确认后才能进入 BossCopilot 2.0。");
          }
          await fetchJson("/system/database-rebuild", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmation: "确认重建 BossCopilot 2.0 数据库" })
          });
        }
        const next = await refreshConversations();
        const initialId = next.find((item) => item.status === "active")?.id ?? next[0]?.id ?? null;
        setCurrentConversationId(initialId);
      await Promise.all([refreshCapabilities(), refreshAttachmentConfig(), refreshAgentSettings(), refreshModelMonitor(), refreshAgentOperations(7, false), refreshCandidateProfile(), refreshJobs(), refreshData(false, initialId)]);
    }
    initialize().catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "系统连接失败");
    });
  }, []);

  useEffect(() => {
    if (appRoute.section !== "settings") return;
    if (appRoute.page === "overview") {
      void Promise.all([
        refreshCandidateProfile(),
        refreshAgentSettings(),
        refreshModelMonitor(),
        refreshAgentOperations(7, false)
      ]).catch(() => {
        // 概览保留上一次可用状态，主动刷新时再展示错误。
      });
      return;
    }
    if (appRoute.page !== "model" && appRoute.page !== "agent") return;
    const refreshActiveDetail = () => appRoute.page === "model"
      ? refreshModelMonitor()
      : refreshAgentOperations(agentOperationsDays, false);
    void refreshActiveDetail().catch(() => {
      // 详情页轮询失败不覆盖已有快照。
    });
    const timer = window.setInterval(() => {
      void refreshActiveDetail().catch(() => {
        // 保留上一次快照，下一轮继续尝试。
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [appRoute.section, appRoute.section === "settings" ? appRoute.page : "", fetchJson, agentOperationsDays]);

  useEffect(() => {
    if (!currentConversationId) return;
    chatAgentRef.current?.abortRun();
    chatAgentRef.current = null;
    setChatBusy(false);
    setRetryChatDraft(null);
    setVisibleMessageCount(12);
    setChatMessages([]);
    Promise.all([
      refreshChat(currentConversationId),
      refreshData(false, currentConversationId)
    ]).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "切换对话失败");
    });
  }, [currentConversationId]);

  useEffect(() => {
    if (!selectedJobId) {
      setJobEvaluation(null);
      return;
    }
    let active = true;
    setJobEvaluationBusy(true);
    fetchJson<JobEvaluation[]>(`/jobs/${selectedJobId}/evaluations?limit=1`)
      .then((evaluations) => {
        const evaluation = evaluations[0];
        if (active) setJobEvaluation(evaluation && ["completed", "partial_failed"].includes(evaluation.status) ? evaluation : null);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : "读取岗位分析失败");
      })
      .finally(() => {
        if (active) setJobEvaluationBusy(false);
      });
    return () => {
      active = false;
    };
  }, [selectedJobId, fetchJson]);

  useEffect(() => {
    if (!selectedJobId) {
      setInterviewKits([]);
      setInterviewKit(null);
      setInterviewRounds([]);
      setJobTimeline([]);
      return;
    }
    let active = true;
    setInterviewBusy(true);
    Promise.all([
      fetchJson<InterviewKitSummary[]>(`/jobs/${selectedJobId}/interview-kits`),
      fetchJson<InterviewRound[]>(`/jobs/${selectedJobId}/interview-rounds`),
      fetchJson<JobEvent[]>(`/jobs/${selectedJobId}/timeline`)
    ])
      .then(async ([kits, rounds, timeline]) => {
        if (!active) return;
        setInterviewKits(kits);
        setInterviewRounds(rounds);
        setJobTimeline(timeline);
        if (!kits.length) {
          setInterviewKit(null);
          return;
        }
        const kit = await fetchJson<InterviewKit>(`/interview-kits/${kits[0].id}`);
        if (active) setInterviewKit(kit);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : "读取面试工作区失败");
      })
      .finally(() => {
        if (active) setInterviewBusy(false);
      });
    return () => {
      active = false;
    };
  }, [selectedJobId, fetchJson]);

  useEffect(() => {
    if (!selectedJobId) {
      setResumeVersions([]);
      setResumeVersion(null);
      return;
    }
    let active = true;
    setResumeVersionBusy(true);
    fetchJson<ResumeVersionSummary[]>(`/jobs/${selectedJobId}/resume-versions`)
      .then(async (versions) => {
        if (!active) return;
        setResumeVersions(versions);
        if (!versions.length) {
          setResumeVersion(null);
          return;
        }
        const version = await fetchJson<ResumeVersion>(
          `/resume-versions/${versions[0].id}`
        );
        if (active) setResumeVersion(version);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : "读取简历版本失败");
      })
      .finally(() => {
        if (active) setResumeVersionBusy(false);
      });
    return () => {
      active = false;
    };
  }, [selectedJobId, fetchJson]);

  useEffect(() => () => chatAgentRef.current?.abortRun(), []);

  useEffect(() => {
    if (chatMessages.length > 0 || chatBusy) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [chatMessages, chatBusy]);

  const routePageMeta = appRoute.section === "settings"
    ? {
        overview: pageMeta.settings,
        profile: { title: "Agent 求职资料库", description: "维护 Agent 可以使用的经历、简历和信息授权范围" },
        model: { title: "Agent 推理模型", description: "配置 Agent 使用的模型服务，并检查连接质量" },
        agent: { title: "Agent 执行记录", description: "查看 Agent 已完成的任务、工具使用和异常原因" }
      }[appRoute.page]
    : appRoute.section === "opportunities"
      ? appRoute.page === "new"
        ? { title: "岗位读取", description: "岗位只能通过浏览器助手从当前招聘详情页读取" }
        : appRoute.page === "pipeline"
          ? { title: "岗位队列", description: "查看已读取岗位并决定哪些值得继续推进" }
          : appRoute.page === "sources"
            ? { title: "岗位来源记录", description: "查看岗位来源与需要补充核验的信息" }
            : appRoute.page === "run"
              ? { title: "分析任务记录", description: "查看岗位读取和初步匹配分析的处理状态" }
              : appRoute.page === "job"
                ? { title: "岗位要求与初步分析", description: "核对岗位要求，查看初步匹配结论并决定是否推进" }
                : pageMeta.opportunities
    : appRoute.section === "workbench"
      ? appRoute.page === "new"
        ? { title: "浏览器读取", description: "岗位只能通过浏览器助手从当前详情页读取" }
        : appRoute.page === "evaluation_section"
          ? { title: "匹配分析依据", description: "查看 Agent 的分析依据、不确定项和你需要确认的内容" }
          : appRoute.page === "evaluation_deep"
          ? { title: "补充岗位研究", description: "让 Agent 在明确范围内补充公开信息和匹配依据" }
            : appRoute.page === "evaluation"
              ? { title: "岗位匹配分析", description: "查看岗位要求、个人经历证据、匹配结论与下一步建议" }
              : appRoute.page === "comparison"
                ? { title: "选择优先岗位", description: "在同一求职目标下比较岗位匹配与下一步行动" }
        : appRoute.page === "detail"
          ? { title: "求职准备", description: "依次完成匹配分析、定制简历、重点问答和面试记录复盘" }
          : pageMeta.workbench
      : pageMeta[appRoute.section];

  useEffect(() => {
    document.title = `${routePageMeta.title} · BossCopilot`;
  }, [routePageMeta.title]);

  return (
    <main className="app-shell">
      <AppSidebar
        collapsed={sidebarCollapsed}
        activeView={activeView}
        conversations={conversations}
        currentConversationId={currentConversationId}
        conversationBusy={conversationBusy}
        capabilities={capabilities}
        contextMode={activeView === "chat" ? "conversations" : "navigation"}
        onToggle={toggleSidebar}
        onGoHome={() => setActiveView("chat")}
        onSelectView={setActiveView}
        onSelectConversation={(conversationId) => {
          setCurrentConversationId(conversationId);
          setActiveView("chat");
        }}
        onCreateConversation={() => void createNewConversation()}
        onRenameConversation={(conversation) => void renameConversation(conversation)}
        onArchiveConversation={(conversation) => void archiveConversation(conversation)}
        onRemoveConversation={(conversation) => void removeConversation(conversation)}
      />

      <section className={`content ${activeView === "chat" ? "chat-content" : ""}`}>
        <SectionHeader
          className="topbar"
          level={1}
          title={activeView === "chat" && currentConversation ? currentConversation.title : routePageMeta.title}
          description={activeView === "chat" ? undefined : routePageMeta.description}
          actions={activeView !== "chat" ? (
            <IconButton
              label="刷新当前页面数据"
              onClick={() => void refreshCurrentRoute()}
              disabled={refreshBusy}
            >
              <RefreshCw className={refreshBusy ? "spinning" : ""} size={18} />
            </IconButton>
          ) : null}
        />

        {errorMessage ? (
          <div className="feedback-banner error-banner"><TriangleAlert size={16} /><span>{errorMessage}</span><button onClick={() => setErrorMessage("")} aria-label="关闭错误提示"><X size={15} /></button></div>
        ) : null}
        {noticeMessage ? (
          <div className="feedback-banner notice-banner"><CheckCircle2 size={16} /><span>{noticeMessage}</span><button onClick={() => setNoticeMessage("")} aria-label="关闭成功提示"><X size={15} /></button></div>
        ) : null}

        {activeView === "dashboard" ? (
          <Suspense fallback={<PageLoading label="正在加载数据看板…" />}>
            <DashboardView
              workflow={workflow}
              conversations={conversations}
              jobs={jobs}
              onOpenConversation={(conversationId) => {
                setCurrentConversationId(conversationId);
                setActiveView("chat");
              }}
            />
          </Suspense>
        ) : null}

        {activeView === "chat" ? (
          <Suspense fallback={<PageLoading label="正在加载对话…" />}>
            <ChatWorkspace
              messages={visibleChatMessages}
              hiddenMessageCount={hiddenMessageCount}
              chatBusy={chatBusy}
              currentConversationId={currentConversationId}
              waitingForUser={waitingForUser}
              latestAgent={latestAgent}
              taskCancelBusy={taskCancelBusy}
              retryDraft={retryChatDraft}
              chatEndRef={chatEndRef}
              chatInputRef={chatInputRef}
              onLoadMore={() => setVisibleMessageCount((count) => count + 12)}
              attachmentBusy={chatAttachmentBusy}
              attachmentConfig={attachmentConfig}
              webSearchAvailable={Boolean(capabilities?.web_research?.enabled)}
              onUploadAttachment={uploadChatAttachment}
              onRemoveAttachment={removeChatAttachment}
              onAttachmentInvalid={setErrorMessage}
              onSuggestedAction={handleSuggestedAction}
              onCancelTask={() => void cancelCurrentTask()}
              onSend={sendChatMessage}
              onStop={stopChatGeneration}
              onEdit={editChatMessage}
              onRegenerate={regenerateChatMessage}
            />
          </Suspense>
        ) : null}

        {activeView === "opportunities" ? (
          <Suspense fallback={<PageLoading label="正在加载岗位发现…" />}>
            <OpportunityDiscoveryPage
              key={`${opportunityRefreshKey}-${appRoute.section === "opportunities" ? appRoute.page : "index"}`}
              apiBase={apiBase}
              page={appRoute.section === "opportunities" ? appRoute.page || "index" : "index"}
              runId={appRoute.section === "opportunities" ? appRoute.runId : undefined}
              discoveredJobId={appRoute.section === "opportunities" ? appRoute.discoveredJobId : undefined}
              onNavigateHome={() => navigateRoute({ section: "opportunities", page: "index" })}
              onNavigateNew={() => navigateRoute({ section: "opportunities", page: "new" })}
              onNavigatePipeline={() => navigateRoute({ section: "opportunities", page: "pipeline" })}
              onNavigateSources={() => navigateRoute({ section: "opportunities", page: "sources" })}
              onNavigateRun={(runId) => navigateRoute({ section: "opportunities", page: "run", runId })}
              onNavigateJob={(discoveredJobId) => navigateRoute({ section: "opportunities", page: "job", discoveredJobId })}
              onJobsChanged={async () => { await refreshJobs(); }}
            />
          </Suspense>
        ) : null}

        {activeView === "workbench" ? (
          <Suspense fallback={<PageLoading label="正在加载岗位工作台…" />}>
            {appRoute.section === "workbench" && ["evaluation", "evaluation_section", "evaluation_deep", "comparison"].includes(appRoute.page || "") ? (
              <JobEvaluationPage
                apiBase={apiBase}
                page={appRoute.page as "evaluation" | "evaluation_section" | "evaluation_deep" | "comparison"}
                jobId={appRoute.jobId}
                job={jobs.find((item) => item.id === appRoute.jobId)}
                sectionKey={appRoute.sectionKey}
                comparisonId={appRoute.comparisonId}
                onBack={() => appRoute.jobId
                  ? navigateRoute({ section: "workbench", page: "detail", jobId: appRoute.jobId })
                  : navigateRoute({ section: "workbench", page: "index" })}
                onOpenOverview={() => appRoute.jobId && navigateRoute({ section: "workbench", page: "evaluation", jobId: appRoute.jobId })}
                onOpenSection={(sectionKey) => appRoute.jobId && navigateRoute({ section: "workbench", page: "evaluation_section", jobId: appRoute.jobId, sectionKey })}
                onOpenDeep={() => appRoute.jobId && navigateRoute({ section: "workbench", page: "evaluation_deep", jobId: appRoute.jobId })}
                onCreateResume={async () => {
                  const job = jobs.find((item) => item.id === appRoute.jobId);
                  if (job) { await createTailoredResumeVersion(job); navigateRoute({ section: "workbench", page: "detail", jobId: job.id }); }
                }}
                onCreateInterviewKit={async () => {
                  const job = jobs.find((item) => item.id === appRoute.jobId);
                  if (job) { await createInterviewPreparation(job, "general"); navigateRoute({ section: "workbench", page: "detail", jobId: job.id }); }
                }}
              />
            ) : (
            <WorkbenchView
              viewMode={appRoute.section === "workbench" && ["index", "new", "detail"].includes(appRoute.page || "index") ? appRoute.page as "index" | "new" | "detail" : "index"}
              hasProfile={workbenchProfileReady}
              chatBusy={chatBusy}
              jobBusy={jobBusy}
              jobImportBusy={jobImportBusy}
              jobImportActivity={jobImportActivity}
              browserJobImportAvailable={browserJobImportAvailable}
              browserJobOpened={browserJobOpened}
              browserJobTabId={browserJobTabId}
              analysis={jobEvaluation}
              analysisBusy={jobEvaluationBusy}
              resumeVersions={resumeVersions}
              resumeVersion={resumeVersion}
              resumeBusy={resumeVersionBusy}
              interviewKits={interviewKits}
              interviewKit={interviewKit}
              interviewRounds={interviewRounds}
              jobTimeline={jobTimeline}
              interviewBusy={interviewBusy}
              jobs={jobs}
              selectedJobId={selectedJobId}
              onSelectJob={setSelectedJobId}
              onNavigateIndex={() => navigateRoute({ section: "workbench", page: "index" })}
              onNavigateNew={() => navigateRoute({ section: "workbench", page: "new" })}
              onNavigateDetail={(jobId) => navigateRoute({ section: "workbench", page: "detail", jobId })}
              onNavigateEvaluation={(jobId) => navigateRoute({ section: "workbench", page: "evaluation", jobId })}
              onCreateComparison={createJobComparison}
              onSaveJob={saveJobProject}
              onPreviewJobUrl={previewJobLink}
              onOpenJobInBrowser={openJobInBrowser}
              onPreviewJobFromBrowser={previewJobFromBrowser}
              onPreviewJobText={previewJobText}
              onPreviewJobScreenshot={previewJobScreenshot}
              onDeleteJob={removeJobProject}
              onCreateResumeVersion={createTailoredResumeVersion}
              onSelectResumeVersion={selectResumeVersion}
              onUpdateResumeChange={updateTailoredResumeChange}
              onUpdateResumeVersion={updateTailoredResumeVersion}
              onExportResume={exportTailoredResume}
              onCreateInterviewKit={createInterviewPreparation}
              onSelectInterviewKit={selectInterviewKit}
              onUpdateInterviewKit={updateInterviewPreparation}
              onToggleInterviewTask={toggleInterviewTask}
              onCreateInterviewRound={createInterviewSchedule}
              onUpdateInterviewRound={updateInterviewSchedule}
              onAddTimelineNote={addTimelineNote}
            />
            )}
          </Suspense>
        ) : null}

        {appRoute.section === "settings" ? (
          <Suspense fallback={<PageLoading label="正在加载设置…" />}>
            <SettingsWorkspace
              page={appRoute.page}
              onBack={() => navigateRoute({ section: "settings", page: "overview" })}
            >
              {appRoute.page === "overview" ? (
                <SettingsOverview
                  profile={candidateEditor}
                  profileReady={workbenchProfileReady}
                  settings={agentSettings}
                  monitor={modelMonitor}
                  operations={agentOperations}
                  onOpen={(page) => navigateRoute({ section: "settings", page })}
                />
              ) : null}
              {appRoute.page === "profile" ? (
                <ProfileSettingsPage
                  apiBase={apiBase}
                  editor={candidateEditor}
                  busy={candidateProfileBusy}
                  resumeBusy={resumeParseBusy}
                  enhancedParse={enhancedResumeParse}
                  privacyFindings={privacyFindings}
                  suggestion={resumeProfileSuggestion}
                  returnToWorkbench={appRoute.returnTo === "workbench"}
                  onChange={(editor: CandidateEditor) => {
                    setCandidateEditor(editor);
                    if (editor.resumeText !== candidateEditor.resumeText) {
                      setPrivacyFindings([]);
                      setResumeProfileSuggestion(null);
                    }
                  }}
                  onEnhancedParseChange={setEnhancedResumeParse}
                  onParseFiles={(files) => void parseResumeFiles(files)}
                  onScanPrivacy={() => void scanResumePrivacy()}
                  onFillSuggestion={fillProfileFromResume}
                  onCareerChange={refreshCandidateProfile}
                  onOpenChat={() => navigateRoute({ section: "chat" })}
                  onClearResume={() => {
                    setCandidateEditor({ ...candidateEditor, resumeText: "", resumeFilename: "", resumeRedactedText: "" });
                    setPrivacyFindings([]);
                    setResumeProfileSuggestion(null);
                  }}
                  onSave={async () => {
                    const saved = await saveCandidateProfile();
                    if (saved && appRoute.returnTo === "workbench") navigateRoute({ section: "workbench" });
                  }}
                  onReturnToWorkbench={() => navigateRoute({ section: "workbench" })}
                />
              ) : null}
              {appRoute.page === "model" ? (
                <ModelSettingsPage
                  settings={agentSettings}
                  savedSettings={savedAgentSettings}
                  editing={modelSettingsEditing}
                  busy={agentSettingsBusy}
                  monitor={modelMonitor}
                  monitorBusy={modelMonitorBusy}
                  availableModels={availableModels}
                  discoveryBusy={modelDiscoveryBusy}
                  discoveryError={modelDiscoveryError}
                  onSettingsChange={setAgentSettings}
                  onDiscoverModels={(force) => void discoverModels(agentSettings, { force, silent: !force })}
                  onCheckService={() => void checkModelService()}
                  onBeginEdit={beginModelSettingsEdit}
                  onCancelEdit={cancelModelSettingsEdit}
                  onSave={() => void saveAgentPreferences()}
                />
              ) : null}
              {appRoute.page === "agent" ? (
                <Suspense fallback={<PageLoading label="正在加载 Agent 运行记录…" />}>
                  <AgentOperationsDashboard
                    snapshot={agentOperations}
                    days={agentOperationsDays}
                    loading={agentOperationsBusy}
                    onDaysChange={changeAgentOperationsWindow}
                    onRefresh={() => void refreshAgentOperations().catch((error: unknown) => {
                      setErrorMessage(error instanceof Error ? error.message : "刷新 Agent 运行记录失败");
                    })}
                  />
                </Suspense>
              ) : null}
            </SettingsWorkspace>
          </Suspense>
        ) : null}

      </section>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode><App /></React.StrictMode>
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount());
}
