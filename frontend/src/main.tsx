import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentSubscriber, HttpAgent as HttpAgentType } from "@ag-ui/client";
import { createApiClient, fetchWithTimeout } from "./api/client";
import { readAnalysisRunStream, type AnalysisRunEvent } from "./features/jobs/analysis-run";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthGate, type AuthUser } from "./components/AuthGate";
import { AppSidebar } from "./components/AppSidebar";
import { AppIdentityMenu } from "./components/AppIdentityMenu";
import { AppTopBar } from "./components/AppTopBar";
import { createClientId } from "./api/clientId";
import { ConversationDialog, type ConversationDialogState } from "./components/ConversationDialog";
import type { AgentRunResult, AttachmentConfig, ChatAttachment, ChatMessage, ChatRetryDraft } from "./components/ChatWorkspace";
import {
  bossHomeUrl,
  defaultAgentSettings,
  emptyCandidateEditor,
  pageMeta,
  topbarSectionForPage
} from "./constants";
import { inboxFactLabel, isSettingsProfileReady } from "./features/home/home-metrics";
import { createPagePrefetcher } from "./page-prefetch";
import { createRouteDataCache, requiredDataForRoute, type RouteDataKey } from "./route-data";
import { useAsyncPolling } from "./hooks/useAsyncPolling";
import { appRouteHash, initialAppRoute, parseAppHash, routeForSection, type AppRoute, type PreparationFocus } from "./routing";
import type {
  AgentCapabilities,
  AgentOperationsSnapshot,
  AgentSettings,
  CandidateEditor,
  CareerProfileBundle,
  Conversation,
  InterviewKit,
  InterviewKitSummary,
  InterviewPreparation,
  InterviewRound,
  InterviewType,
  JobEvaluation,
  JobEvent,
  JobImportPreview,
  JobProject,
  JobProjectDraft,
  ResumeChangeDecision,
  ResumeProfileSuggestion,
  ResumeLayoutSettings,
  ResumeStyle,
  ResumeTemplate,
  ResumeVersion,
  ResumeVersionSummary,
  QuickMatchResult,
  ModelCapabilityReport,
  ModelServiceMonitor,
  ViewKey,
  WorkflowStatus
} from "./types";
import {
  CheckCircle2,
  Database,
  LoaderCircle,
  MessageCircle,
  TriangleAlert,
  X
} from "lucide-react";
import "./styles/foundations.css";
// The authenticated shell must be available immediately after login. Loading
// these styles through a lazy component kept the entire app behind a Suspense
// fallback while the CSS chunk was fetched, leaving users on a blank loading
// screen after their credentials had already been accepted.
import "./AppStyles";

const loadChatWorkspace = () => import("./components/ChatWorkspace");
const loadWorkspaceViews = () => import("./components/WorkspaceViews");
const loadHomePage = () => import("./features/home/HomePage");
const loadSettingsWorkspace = () => import("./features/settings/SettingsWorkspace");
const loadProfileSettingsPage = () => import("./features/settings/ProfileSettingsPage");
const loadAccountSettingsPage = () => import("./features/settings/AccountSettingsPage");
const loadInterviewPreparationPage = () => import("./features/interview/InterviewPreparationPage");
const loadProjectStudioPage = () => import("./features/projects/ProjectStudioPage");
const ChatWorkspace = lazy(() => loadChatWorkspace().then((module) => ({
  default: module.ChatWorkspace
})));

const WorkbenchView = lazy(() => loadWorkspaceViews().then((module) => ({
  default: module.WorkbenchView
})));

const HomePage = lazy(() => loadHomePage().then((module) => ({
  default: module.HomePage
})));

const AgentOperationsDashboard = lazy(() => import("./features/settings/AgentOperationsDashboard").then((module) => ({
  default: module.AgentOperationsDashboard
})));

const SettingsWorkspace = lazy(() => loadSettingsWorkspace().then((module) => ({
  default: module.SettingsWorkspace
})));

const SettingsOverview = lazy(() => loadSettingsWorkspace().then((module) => ({
  default: module.SettingsOverview
})));

const ProfileSettingsPage = lazy(() => loadProfileSettingsPage().then((module) => ({
  default: module.ProfileSettingsPage
})));

const AccountSettingsPage = lazy(() => loadAccountSettingsPage().then((module) => ({
  default: module.AccountSettingsPage
})));

const ModelSettingsPage = lazy(() => import("./features/settings/ModelSettingsPage").then((module) => ({
  default: module.ModelSettingsPage
})));

const loadOpportunityDiscoveryPage = () => import("./features/opportunities/OpportunityDiscoveryPage");
const OpportunityDiscoveryPage = lazy(() => loadOpportunityDiscoveryPage().then((module) => ({
  default: module.OpportunityDiscoveryPage
})));

const JobEvaluationPage = lazy(() => import("./features/jobs/JobEvaluationPage").then((module) => ({
  default: module.JobEvaluationPage
})));

const InterviewPreparationPage = lazy(() => loadInterviewPreparationPage().then((module) => ({
  default: module.InterviewPreparationPage
})));

const ProjectStudioPage = lazy(() => loadProjectStudioPage().then((module) => ({
  default: module.ProjectStudioPage
})));

const pagePrefetcher = createPagePrefetcher({
  chat: loadChatWorkspace,
  profile: () => Promise.all([loadSettingsWorkspace(), loadProfileSettingsPage()]),
  account: () => Promise.all([loadSettingsWorkspace(), loadAccountSettingsPage()]),
  projects: loadInterviewPreparationPage,
  knowledge: loadInterviewPreparationPage,
  records: loadInterviewPreparationPage,
  "project-lab": loadProjectStudioPage,
  workbench: loadWorkspaceViews,
  opportunities: loadOpportunityDiscoveryPage,
  dashboard: loadHomePage,
  settings: loadSettingsWorkspace
});

function PageLoading({ label }: { label: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <div className="page-loading-copy">
        <LoaderCircle className="spinning" size={18} />
        <span>{label}</span>
      </div>
      <div className="page-loading-skeleton" aria-hidden="true">
        <i /><i /><i />
      </div>
    </div>
  );
}

function resolveApiBase() {
  // Development uses Vite's /api proxy. The built SPA is served by FastAPI,
  // so production and HTTPS-tunnel traffic use this exact same origin.
  return import.meta.env.DEV ? "/api" : window.location.origin;
}

// One-time migration of pre-rebrand localStorage keys.
for (const key of ["sidebar", "view"]) {
  const legacy = window.localStorage.getItem(`bosscopilot-${key}`);
  if (legacy !== null) {
    if (window.localStorage.getItem(`careerloop-${key}`) === null) {
      window.localStorage.setItem(`careerloop-${key}`, legacy);
    }
    window.localStorage.removeItem(`bosscopilot-${key}`);
  }
}

function preferenceKey(base: string, email: string) {
  return `${base}:${email}`;
}

function readPreference(base: string, email: string) {
  return window.localStorage.getItem(preferenceKey(base, email)) ?? window.localStorage.getItem(base);
}

function appTopBarShowsTitle(route: AppRoute): boolean {
  if (route.section === "dashboard" || route.section === "chat" || route.section === "interview-prep" || route.section === "project-lab") return false;
  if (route.section === "workbench") {
    return ["evaluation", "evaluation_section", "comparison"].includes(route.page || "");
  }
  return true;
}

function App({
  accessToken,
  onLogout,
  user,
  updateSession
}: {
  accessToken: string;
  onLogout: () => void;
  user: AuthUser;
  updateSession: (token: string, nextUser: AuthUser) => void;
}) {
  const userEmail = user.email;
  const apiBase = useMemo(() => resolveApiBase(), []);
  const fetchJson = useMemo(() => createApiClient(apiBase, accessToken), [apiBase, accessToken]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarEpoch, setAvatarEpoch] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readPreference("careerloop-sidebar", userEmail) === "collapsed");
  const [appRoute, setAppRoute] = useState<AppRoute>(() => initialAppRoute(
    window.location.hash,
    readPreference("careerloop-view", userEmail)
  ));
  const activeView: ViewKey = appRoute.section;
  const [workflow, setWorkflow] = useState<WorkflowStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [jobs, setJobs] = useState<JobProject[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [jobImportBusy, setJobImportBusy] = useState(false);
  const [jobEvaluation, setJobEvaluation] = useState<JobEvaluation | null>(null);
  const [jobEvaluationBusy, setJobEvaluationBusy] = useState(false);
  const [resumeVersions, setResumeVersions] = useState<ResumeVersionSummary[]>([]);
  const [resumeVersion, setResumeVersion] = useState<ResumeVersion | null>(null);
  const [resumeVersionBusy, setResumeVersionBusy] = useState(false);
  const [interviewKits, setInterviewKits] = useState<InterviewKitSummary[]>([]);
  const [interviewKit, setInterviewKit] = useState<InterviewKit | null>(null);
  const [interviewRounds, setInterviewRounds] = useState<InterviewRound[]>([]);
  const [interviewPreparation, setInterviewPreparation] = useState<InterviewPreparation | null>(null);
  const [interviewPreparationBusy, setInterviewPreparationBusy] = useState(false);
  const [autoAnalysisAttemptedRevision, setAutoAnalysisAttemptedRevision] = useState<number | null>(null);
  const [jobTimeline, setJobTimeline] = useState<JobEvent[]>([]);
  const [interviewBusy, setInterviewBusy] = useState(() => {
    const route = initialAppRoute(
      window.location.hash,
      readPreference("careerloop-view", userEmail)
    );
    return route.section === "workbench" && route.page === "interview";
  });
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const currentConversationIdRef = useRef<number | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [conversationDialog, setConversationDialog] = useState<ConversationDialogState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(12);
  const [chatBusy, setChatBusy] = useState(false);
  const [retryChatDraft, setRetryChatDraft] = useState<ChatRetryDraft | null>(null);
  const chatAgentRef = useRef<HttpAgentType | null>(null);
  const [taskCancelBusy, setTaskCancelBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [attachmentConfig, setAttachmentConfig] = useState<AttachmentConfig | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [candidateEditor, setCandidateEditor] = useState(emptyCandidateEditor);
  const hasStoredResumeRef = useRef(false);
  const candidateProfileGenerationRef = useRef(0);
  const [confirmedCareerFactCount, setConfirmedCareerFactCount] = useState(0);
  const [pendingCareerFacts, setPendingCareerFacts] = useState<Array<{
    id: number;
    statement: string;
    category?: string;
    value?: { name?: string };
    sourceKind?: string;
    evidence?: Array<{ excerpt?: string; source_title?: string }>;
  }>>([]);
  const [candidateProfileLoaded, setCandidateProfileLoaded] = useState(false);
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
  const modelSettingsEditingRef = useRef(false);
  const [modelMonitor, setModelMonitor] = useState<ModelServiceMonitor | null>(null);
  const [modelMonitorBusy, setModelMonitorBusy] = useState(false);
  const [agentOperations, setAgentOperations] = useState<AgentOperationsSnapshot | null>(null);
  const [agentOperationsDays, setAgentOperationsDays] = useState<7 | 30 | 90>(7);
  const [agentOperationsBusy, setAgentOperationsBusy] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelDiscoveryBusy, setModelDiscoveryBusy] = useState(false);
  const [modelDiscoveryError, setModelDiscoveryError] = useState("");
  const [modelCapabilities, setModelCapabilities] = useState<ModelCapabilityReport | null>(null);
  const [modelCapabilitiesBusy, setModelCapabilitiesBusy] = useState(false);
  const [databaseReady, setDatabaseReady] = useState(false);
  const databaseInitializationRef = useRef<Promise<void> | null>(null);
  const modelDiscoveryKeyRef = useRef("");
  const routeDataCacheRef = useRef(createRouteDataCache<RouteDataKey>(30_000));
  const currentConversation = conversations.find((item) => item.id === currentConversationId) ?? null;

  function navigateRoute(route: AppRoute, replace = false) {
    if (route.section === "workbench" && route.page === "interview") {
      setInterviewBusy(true);
    }
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
      readPreference("careerloop-view", userEmail)
    ));
    if (window.location.hash !== canonicalHash) {
      window.history.replaceState(null, "", canonicalHash);
    }
    function syncRoute() {
      const next = parseAppHash(window.location.hash);
      if (next) setAppRoute(next);
      else navigateRoute({ section: "dashboard" }, true);
    }
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      pagePrefetcher.prefetchWhenIdle(
        // Hover and keyboard focus already prefetch the destination page. On a
        // cold mobile connection, eagerly fetching every workspace competes
        // with the critical shell, styles, and authentication requests.
        ["chat"],
        (callback) => window.setTimeout(callback, 0)
      );
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (appRoute.section !== "workbench") return;
    if (["detail", "resume", "interview", "evaluation", "evaluation_section"].includes(appRoute.page || "") && appRoute.jobId) {
      setSelectedJobId(appRoute.jobId);
      return;
    }
    if (appRoute.page === "interview") {
      const resumePrepJob = jobs.find((item) => item.job_title === "按简历准备");
      if (resumePrepJob) {
        setSelectedJobId(resumePrepJob.id);
        return;
      }
    }
    setSelectedJobId(null);
  }, [appRoute, jobs]);

  useEffect(() => {
    if (appRoute.section !== "chat" || !currentConversationId || !conversations.length) return;
    const requestedConversationId = appRoute.conversationId;
    if (requestedConversationId && conversations.some((item) => item.id === requestedConversationId)) {
      if (requestedConversationId !== currentConversationId) setCurrentConversationId(requestedConversationId);
      return;
    }
    if (requestedConversationId !== currentConversationId) {
      navigateRoute({ section: "chat", conversationId: currentConversationId }, true);
    }
  }, [appRoute, conversations, currentConversationId]);

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  useEffect(() => {
    window.localStorage.setItem(preferenceKey("careerloop-view", userEmail), activeView);
  }, [activeView]);

  useEffect(() => {
    if (!noticeMessage) return;
    const timer = window.setTimeout(() => setNoticeMessage(""), 2600);
    return () => window.clearTimeout(timer);
  }, [noticeMessage]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (!user.has_avatar) {
      setAvatarUrl(null);
      return;
    }
    void fetch(`${apiBase}/auth/me/avatar`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("avatar missing");
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatarUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiBase, accessToken, user.has_avatar, avatarEpoch]);

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
      window.localStorage.setItem(preferenceKey("careerloop-sidebar", userEmail), next ? "collapsed" : "expanded");
      return next;
    });
  }

  const hasProfile = (workflow?.counts.profiles ?? 0) > 0;
  const hasSavedResume = Boolean(candidateEditor.resumeText.trim());
  const workbenchProfileReady = hasProfile && confirmedCareerFactCount > 0;
  const settingsProfileReady = candidateProfileLoaded
    ? isSettingsProfileReady(candidateEditor)
    : null;
  const hiddenMessageCount = Math.max(0, chatMessages.length - visibleMessageCount);
  const visibleChatMessages = chatMessages.slice(-visibleMessageCount);
  const latestAgent = [...chatMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.payload?.agent)?.payload?.agent;
  const waitingForUser = latestAgent?.status === "waiting_user";
  const nextStep = !hasProfile
    ? { title: "先建立职业画像", detail: "导入简历或填写关键经历，让岗位判断和面试准备真正贴合你。", action: "创建求职资料", kind: "settings" as const }
    : !workbenchProfileReady
      ? { title: "确认候选人事实", detail: "待确认知识不会参与岗位评分；请先在画像中心核对证据。", action: "审核画像", kind: "settings" as const }
      : { title: "分析这份简历", detail: "先看已保存简历的方向与缺口；需要时再对照岗位。", action: "开始分析", kind: "workbench" as const };

  async function refreshData(conversationId = currentConversationId) {
    try {
      const nextWorkflow = await fetchJson<WorkflowStatus>(`/workflow/status${conversationId ? `?conversation_id=${conversationId}` : ""}`);
      setWorkflow(nextWorkflow);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "数据刷新失败");
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
    setJobsLoaded(true);
    setSelectedJobId((current) => (
      current && next.some((job) => job.id === current)
        ? current
        : null
    ));
    return next;
  }

  async function refreshInterviewPreparation() {
    setInterviewPreparationBusy(true);
    try {
      const next = await fetchJson<InterviewPreparation>("/interview-preparation");
      setInterviewPreparation(next);
      return next;
    } finally {
      setInterviewPreparationBusy(false);
    }
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

  async function runQuickMatch(
    payload: {
      job_description: string;
      job_title?: string;
      company_name?: string;
    },
    onEvent?: (event: AnalysisRunEvent) => void
  ): Promise<QuickMatchResult> {
    if (!onEvent) {
      return fetchJson<QuickMatchResult>("/quick-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    });
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    const response = await fetchWithTimeout(
      `${apiBase}/quick-match/run`,
      { method: "POST", headers, body: JSON.stringify(payload) },
      90_000
    );
    return readAnalysisRunStream(response, onEvent);
  }

  async function applyResumeRewrite(payload: {
    original: string;
    suggested: string;
    job_description: string;
    job_title?: string;
    company_name?: string;
  }): Promise<QuickMatchResult> {
    const result = await fetchJson<QuickMatchResult & { resume_text?: string }>("/quick-match/apply-rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (result.resume_text) {
      setCandidateEditor((current) => ({ ...current, resumeText: result.resume_text || current.resumeText }));
      hasStoredResumeRef.current = true;
      routeDataCacheRef.current.invalidate("candidateProfile");
    }
    return result;
  }

  async function refreshResumeVersions(
    jobId?: number,
    preferredVersionId?: number
  ): Promise<ResumeVersionSummary[]> {
    const versions = await fetchJson<ResumeVersionSummary[]>(
      jobId ? `/jobs/${jobId}/resume-versions` : "/resume-versions"
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

  async function createTailoredResumeVersion(job?: JobProject): Promise<ResumeVersion> {
    setResumeVersionBusy(true);
    setErrorMessage("");
    try {
      const version = await fetchJson<ResumeVersion>(
        job ? `/jobs/${job.id}/resume-versions` : "/resume-versions",
        { method: "POST" }
      );
      setResumeVersion(version);
      await refreshResumeVersions(undefined, version.id);
      setNoticeMessage("简历已生成");
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
        template_id: version.template_id,
        style_id: version.style_id,
        layout: version.layout,
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
          ? "保存成功"
          : patch.decision === "rejected"
            ? "已拒绝"
            : patch.decision === "accepted"
              ? "已接受"
              : "已恢复"
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存简历修改失败");
    } finally {
      setResumeVersionBusy(false);
    }
  }

  async function updateTailoredResumeVersion(
    versionId: number,
    patch: { status?: "draft" | "final"; template_id?: ResumeTemplate; style_id?: ResumeStyle; layout?: ResumeLayoutSettings }
  ) {
    setResumeVersionBusy(true);
    setErrorMessage("");
    try {
      const version = await fetchJson<ResumeVersion>(`/resume-versions/${versionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
      });
      setResumeVersion(version);
      setResumeVersions((current) => current.map((item) => (
        item.id === version.id
          ? {
              ...item,
              title: version.title,
              status: version.status,
              template_id: version.template_id,
              style_id: version.style_id,
              layout: version.layout,
              change_count: version.change_count,
              change_counts: version.change_counts,
              updated_at: version.updated_at
            }
          : item
      )));
      setNoticeMessage(
        patch.layout
          ? "已更新排版"
          : patch.style_id
          ? "已应用模板"
          : patch.template_id
          ? "已选择简历类型"
          : patch.status === "final"
            ? "已设为最终版"
            : "已恢复草稿"
      );
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
        `${apiBase}/resume-versions/${versionId}/export?format=${format}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
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
      setNoticeMessage(`已导出 ${format.toUpperCase()}`);
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
      setNoticeMessage("面试准备已生成");
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
      setNoticeMessage(patch.status === "ready" ? "已标记为就绪" : "保存成功");
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
      await refreshInterviewWorkspace(jobId, interviewKit?.id);
      setNoticeMessage("已记录");
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
      setNoticeMessage("已更新");
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
      setNoticeMessage("已添加");
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
      setSelectedJobId(saved.id);
      if (!jobId) {
        setJobEvaluation(null);
        setResumeVersions([]);
        setResumeVersion(null);
        setInterviewKits([]);
        setInterviewKit(null);
        setInterviewRounds([]);
        setJobTimeline([]);
      }
      setNoticeMessage("保存成功");
      return saved;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存岗位项目失败");
      throw error;
    } finally {
      setJobBusy(false);
    }
  }

  async function previewJobText(
    text: string,
    sourceUrl = ""
  ): Promise<JobImportPreview> {
    setJobImportBusy(true);
    setErrorMessage("");
    try {
      const preview = await fetchJson<JobImportPreview>("/job-imports/text-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source_url: sourceUrl.trim() })
      });
      setNoticeMessage(
        preview.status === "ready"
          ? "岗位信息已读取"
          : "岗位信息不完整"
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
          ? "图片已读取"
          : "图片内容不完整"
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
      setNoticeMessage("已删除");
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
      setNoticeMessage("已新建对话");
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
      setNoticeMessage(conversation.status === "active" ? "已归档" : "已恢复");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "归档对话失败");
    } finally {
      setConversationBusy(false);
    }
  }

  async function renameConversation(conversation: Conversation, title: string) {
    try {
      setConversationBusy(true);
      await fetchJson(`/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      await refreshConversations();
      setConversationDialog(null);
      setNoticeMessage("已重命名");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setConversationBusy(false);
    }
  }

  async function removeConversation(conversation: Conversation) {
    setConversationBusy(true);
    try {
      const result = await fetchJson<{ next_conversation: Conversation }>(`/conversations/${conversation.id}`, { method: "DELETE" });
      const next = await refreshConversations();
      if (conversation.id === currentConversationId) {
        setCurrentConversationId(result.next_conversation?.id ?? next[0]?.id ?? null);
      }
      setConversationDialog(null);
      setNoticeMessage("已删除");
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

  function updateModelSettingsEditing(next: boolean) {
    modelSettingsEditingRef.current = next;
    setModelSettingsEditing(next);
  }

  async function refreshAgentSettings() {
    const next = await fetchJson<AgentSettings>("/agent/settings");
    const clean = { ...next, api_key: "" };
    setSavedAgentSettings(clean);
    if (modelSettingsEditingRef.current) {
      return;
    }
    setAgentSettings(clean);
    updateModelSettingsEditing(!next.api_key_configured);
    if (next.api_key_configured) {
      void discoverModels(clean, { silent: true });
    }
  }

  async function refreshModelMonitor() {
    const next = await fetchJson<ModelServiceMonitor>("/agent/model-monitor?hours=24");
    setModelMonitor(next);
    return next;
  }

  async function refreshModelCapabilities(probe = false) {
    setModelCapabilitiesBusy(true);
    try {
      const next = probe
        ? await fetchJson<ModelCapabilityReport>("/agent/models/capabilities", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model_name: agentSettings.model_name,
              model_base_url: agentSettings.model_base_url,
              api_key: agentSettings.api_key,
              probe: true
            })
          })
        : await fetchJson<ModelCapabilityReport>(
            `/agent/models/capabilities?model_name=${encodeURIComponent(agentSettings.model_name)}`
          );
      setModelCapabilities(next);
      if (probe && next.probe_error) {
        setErrorMessage(next.probe_error);
      } else if (probe) {
        setNoticeMessage(next.vision.source === "probe" ? "已完成能力检测" : "已读取模型能力");
      }
      return next;
    } finally {
      setModelCapabilitiesBusy(false);
    }
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
          ? "检测成功"
          : "检测完成"
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
        setNoticeMessage(`已识别 ${result.count} 个模型`);
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
    updateModelSettingsEditing(true);
  }

  function cancelModelSettingsEdit() {
    setAgentSettings({ ...savedAgentSettings, api_key: "" });
    updateModelSettingsEditing(false);
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
      updateModelSettingsEditing(false);
      modelDiscoveryKeyRef.current = "";
      await Promise.all([refreshCapabilities(), refreshModelMonitor(), refreshModelCapabilities()]);
      void discoverModels(clean, { silent: true, force: true });
      setNoticeMessage("保存成功");
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
      setNoticeMessage("已重置上下文");
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
    const generation = candidateProfileGenerationRef.current;
    try {
    const bundle = await fetchJson<CareerProfileBundle>("/career-profile");
    if (generation !== candidateProfileGenerationRef.current) return;
    setResumeProfileSuggestion(null);
    if (!bundle.profile) {
      setConfirmedCareerFactCount(0);
      setPendingCareerFacts([]);
      hasStoredResumeRef.current = false;
      setCandidateEditor(emptyCandidateEditor);
      return;
    }
    const profile = bundle.profile;
    const confirmedFacts = bundle.facts.filter((fact) => fact.status === "confirmed");
    const pendingFacts = bundle.facts.filter((fact) => fact.status === "pending");
    const strategy = bundle.active_strategy;
    const resumeSource = bundle.sources.find((source) => source.source_type === "resume");
    const blockedSkills = new Set(
      bundle.facts
        .filter((fact) => fact.category === "skill" && (fact.status === "disputed" || fact.status === "retracted"))
        .map((fact) => inboxFactLabel(fact).toLowerCase())
        .filter(Boolean)
    );
    const skills: string[] = [];
    const seenSkills = new Set<string>();
    for (const fact of confirmedFacts) {
      if (fact.category !== "skill") continue;
      const name = inboxFactLabel(fact);
      const key = name.toLowerCase();
      if (!name || blockedSkills.has(key) || seenSkills.has(key)) continue;
      seenSkills.add(key);
      skills.push(name);
    }
    setConfirmedCareerFactCount(confirmedFacts.length);
    setPendingCareerFacts(pendingFacts.map((fact) => ({
      id: fact.id,
      statement: fact.statement,
      category: fact.category,
      value: fact.value as { name?: string } | undefined,
      sourceKind: fact.source_kind,
      evidence: fact.evidence
    })));
    setCandidateEditor((current) => ({
      ...current,
      name: profile.name || "",
      targetRole: strategy?.target_roles?.join("，") || "",
      targetCity: strategy?.locations?.join("，") || "",
      salaryMin: strategy?.salary?.min ? String(Math.round(strategy.salary.min / 1000)) : "",
      salaryMax: strategy?.salary?.max ? String(Math.round(strategy.salary.max / 1000)) : "",
      skills: skills.join("，"),
      industries: strategy?.industries?.join("，") || "",
      blockedKeywords: [...(strategy?.hard_constraints || []), ...(strategy?.blocked_keywords || [])].join("，"),
      blockedCompanies: strategy?.blocked_companies?.join("，") || "",
      resumeText: profile.resume_text || "",
      resumeRedactedText: profile.resume_redacted_text || "",
      resumeFilename: resumeSource?.title || profile.resume_filename || "",
      privacyMode: profile.privacy_mode || "redacted"
    }));
    hasStoredResumeRef.current = Boolean((profile.resume_text || "").trim());
    } finally {
      if (generation === candidateProfileGenerationRef.current) {
        setCandidateProfileLoaded(true);
      }
    }
  }

  async function persistClearedResume() {
    await fetchJson("/career-profile/resume", { method: "DELETE" });
    hasStoredResumeRef.current = false;
    routeDataCacheRef.current.invalidate("candidateProfile");
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
        hasStoredResumeRef.current = true;
        await fetchJson(`/career-profile/sources/${resumeSourceId}/access`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allow_model_original: candidateEditor.privacyMode === "original",
            privacy_mode: candidateEditor.privacyMode
          })
        });
      } else if (hasStoredResumeRef.current) {
        await persistClearedResume();
      }
      await Promise.all(splitList(candidateEditor.skills).map(async (skill) => {
        const fact = await fetchJson<{ id: number; status: string }>("/career-profile/facts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "skill",
            canonical_key: `skill:${skill.toLowerCase()}`,
            statement: skill,
            value: { name: skill },
            source_id: resumeSourceId,
            excerpt: resumeSourceId ? skill : "",
            sensitivity: "private"
          })
        });
        if (fact.status === "pending") {
          await fetchJson(`/career-profile/facts/${fact.id}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "confirm" })
          });
        }
      }));
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
      setInterviewPreparation(null);
      setAutoAnalysisAttemptedRevision(null);
      await Promise.all([refreshCandidateProfile(), refreshData()]);
      setNoticeMessage("保存成功");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存求职资料失败");
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
      setNoticeMessage("简历导入成功");
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
    setNoticeMessage("已补充个人信息");
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
      setNoticeMessage(result.findings.length ? `发现 ${result.findings.length} 处敏感信息` : "未发现敏感信息");
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
      setNoticeMessage(kind === "resume" ? "简历已添加" : "图片已添加");
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
    setNoticeMessage("附件已移除");
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
        const existing = agent.events.find((item) => item.tool_call_id === agentEvent.tool_call_id);
        const incomingGeneric = !agentEvent.message.trim()
          || /^(?:正在执行(?:\s+\S+)?)$/i.test(agentEvent.message.trim());
        const keepExistingMessage = Boolean(
          existing?.message
          && incomingGeneric
          && existing.message.trim() !== agentEvent.message.trim()
        );
        const merged = {
          ...existing,
          ...agentEvent,
          message: keepExistingMessage ? existing!.message : agentEvent.message,
          data: { ...existing?.data, ...agentEvent.data }
        };
        const events = [
          ...agent.events.filter((item) => item.tool_call_id !== agentEvent.tool_call_id),
          merged
        ];
        return { ...message, payload: { ...message.payload, agent: { ...agent, events } } };
      }));
    };

    const handleTerminal = (snapshot: {
      workflow: WorkflowStatus;
      careerLoop: {
        status: "done" | "failed" | "cancelled" | "waiting_user";
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
      };
    }) => {
      terminalReceived = true;
      setWorkflow(snapshot.workflow);
      const { userMessage, assistantMessage, status } = snapshot.careerLoop;
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
      if (status === "cancelled") setNoticeMessage("已停止生成");
    };

    const agent = new HttpAgent({
      url: `${apiBase}/ag-ui`,
      headers: { Authorization: `Bearer ${accessToken}` },
      agentId: "careerloop",
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
        if (event.name === "careerloop.user_message") {
          const userMessage = event.value as ChatMessage;
          if (currentConversationIdRef.current === conversationId) {
            setChatMessages((current) => [
              ...current.filter((message) => ![optimisticId, userMessage.id].includes(message.id)),
              userMessage
            ]);
          }
        }
        if (event.name === "careerloop.agent_event" && event.value && typeof event.value === "object") {
          updateAgentEvent(event.value as AgentRunResult["events"][number]);
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
          runId: createClientId(),
          tools: [],
          context: [],
          forwardedProps: { conversationId, client: "careerloop-web", attachmentIds, visionAttachmentIds, webSearch }
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
      if (!result.cancelled) setNoticeMessage("没有可停止的任务");
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
      refreshData(currentConversationId)
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
    setNoticeMessage("已打开 BOSS 官网");
  }

  function handleNextStep() {
    if (nextStep.kind === "settings") {
      navigateRoute({ section: "settings", page: "profile", returnTo: "workbench" });
    } else {
      navigateRoute({ section: "workbench", page: "new" });
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
      setNoticeMessage("任务已结束");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "结束当前任务失败");
    } finally {
      setTaskCancelBusy(false);
    }
  }

  useEffect(() => {
    async function initializeDatabase() {
      const database = await fetchJson<{
          status: "uninitialized" | "requires_rebuild" | "ready";
          reason?: string;
        }>("/system/database-status");
        if (database.status === "requires_rebuild") {
          const confirmed = window.confirm(
            "CareerLoop 2.0 需要重建本地数据库。\n\n继续前会自动生成带时间戳的完整备份；旧数据不会自动导入新画像。是否现在备份并重建？"
          );
          if (!confirmed) {
            throw new Error("已取消数据库重建。当前旧数据库保持不变，确认后才能进入 CareerLoop 2.0。");
          }
          await fetchJson("/system/database-rebuild", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmation: "确认重建 CareerLoop 2.0 数据库" })
          });
        }
        setDatabaseReady(true);
    }
    const initialization = databaseInitializationRef.current ?? initializeDatabase();
    databaseInitializationRef.current = initialization;
    initialization.catch((error: unknown) => {
      databaseInitializationRef.current = null;
      setErrorMessage(error instanceof Error ? error.message : "系统连接失败");
    });
  }, []);

  useEffect(() => {
    if (!databaseReady) return;
    const loaders: Record<RouteDataKey, () => Promise<unknown>> = {
      attachmentConfig: refreshAttachmentConfig,
      agentOperations: () => refreshAgentOperations(7, false),
      agentSettings: refreshAgentSettings,
      candidateProfile: refreshCandidateProfile,
      capabilities: refreshCapabilities,
      conversations: async () => {
        const next = await refreshConversations();
        setCurrentConversationId((current) => current ?? next.find((item) => item.status === "active")?.id ?? next[0]?.id ?? null);
      },
      interviewPreparation: refreshInterviewPreparation,
      jobs: refreshJobs,
      modelMonitor: refreshModelMonitor,
      modelCapabilities: () => refreshModelCapabilities(false),
      workflow: () => refreshData(currentConversationId)
    };
    void Promise.all(requiredDataForRoute(appRoute).map((key) => (
      routeDataCacheRef.current.load(key, loaders[key])
    ))).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "读取页面数据失败");
    });
    if (appRoute.section === "dashboard") {
      const timer = window.setTimeout(() => {
        void pagePrefetcher.prefetch("workbench");
        void routeDataCacheRef.current.load("jobs", loaders.jobs);
        void routeDataCacheRef.current.load("candidateProfile", loaders.candidateProfile);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [appRoute, databaseReady]);

  useAsyncPolling({
    enabled: databaseReady && appRoute.section === "settings" && ["model", "agent"].includes(appRoute.page),
    intervalMs: 15_000,
    poll: () => appRoute.section === "settings" && appRoute.page === "model"
      ? refreshModelMonitor()
      : refreshAgentOperations(agentOperationsDays, false),
    onError: (_reason, failures) => {
      if (failures >= 3) setErrorMessage("设置状态连续刷新失败，当前仍显示上一次数据。");
    }
  });

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
      refreshData(currentConversationId)
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
    const onResumePage = appRoute.section === "workbench" && appRoute.page === "resume";
    if (!onResumePage && !selectedJobId) {
      setResumeVersions([]);
      setResumeVersion(null);
      return;
    }
    let active = true;
    setResumeVersionBusy(true);
    const url = onResumePage || !selectedJobId
      ? "/resume-versions"
      : `/jobs/${selectedJobId}/resume-versions`;
    fetchJson<ResumeVersionSummary[]>(url)
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
  }, [appRoute.section, appRoute.section === "workbench" ? appRoute.page : undefined, selectedJobId, fetchJson]);

  useEffect(() => () => chatAgentRef.current?.abortRun(), []);

  useEffect(() => {
    if (chatMessages.length > 0 || chatBusy) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [chatMessages, chatBusy]);

  const routePageMeta = appRoute.section === "settings"
    ? {
        overview: pageMeta.settings,
        account: { title: "账号与安全", description: "管理跟随登录账号的昵称、头像和密码" },
        profile: { title: "求职资料", description: "完善经历、简历和求职偏好，让推荐和准备更贴合你" },
        model: { title: "模型设置", description: "配置推理模型、服务地址和 API Key，并检查连接质量" },
        agent: { title: "Agent 执行记录", description: "查看 Agent 已完成的任务、工具使用和异常原因" }
      }[appRoute.page]
    : appRoute.section === "opportunities"
      ? appRoute.page === "new"
        ? { title: "新建发现任务", description: "选择扫描来源、识别招聘页或评估已收集岗位" }
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
        ? { title: "新的分析", description: "先分析已保存简历，需要时再对照岗位" }
        : appRoute.page === "evaluation_section"
          ? { title: "匹配分析依据", description: "查看 Agent 的分析依据、不确定项和你需要确认的内容" }
            : appRoute.page === "evaluation"
              ? { title: "匹配分析", description: "查看匹配、缺口、证据和下一步建议" }
              : appRoute.page === "comparison"
                ? { title: "选择优先岗位", description: "在同一求职目标下比较岗位匹配与下一步行动" }
        : appRoute.page === "interview"
          ? { title: "面试问答", description: "根据已保存简历准备预测问题、STAR 讲法和追问；导入岗位后可以再出一版" }
        : appRoute.page === "detail"
          ? { title: "匹配分析", description: "对照这份岗位查看匹配、缺口和证据" }
          : pageMeta.workbench
      : appRoute.section === "interview-prep"
        ? appRoute.page === "knowledge"
          ? { title: "知识点回顾", description: "从真实项目出发，回顾技术概念、实际用法与选型边界" }
          : appRoute.page === "records"
            ? { title: "面试记录", description: "记录真实问题、原回答与复盘，把反馈变成下一次准备" }
            : { title: "项目解析", description: "把真实项目拆成可讲证据，并通过文字追问反复练习" }
      : pageMeta[appRoute.section];

  const documentPageTitle = appRoute.section === "chat"
    ? currentConversation?.title || "新对话"
    : routePageMeta.title;
  const topbarTitle = appTopBarShowsTitle(appRoute) ? documentPageTitle : undefined;
  const topbarSection = topbarTitle ? topbarSectionForPage(appRoute.section, topbarTitle) : undefined;

  useEffect(() => {
    document.title = `${documentPageTitle}｜CareerLoop`;
  }, [documentPageTitle]);

  const identityMenu = (
    <AppIdentityMenu
      userEmail={userEmail}
      accountName={user.display_name}
      avatarUrl={avatarUrl}
      activeView={activeView}
      settingsPage={appRoute.section === "settings" ? appRoute.page : undefined}
      onOpenProfile={() => navigateRoute({ section: "settings", page: "profile" })}
      onOpenAccount={() => navigateRoute({ section: "settings", page: "account" })}
      onLogout={onLogout}
      onPrefetchPage={(page) => void pagePrefetcher.prefetch(page)}
    />
  );

  return (
    <main className="app-shell">
      <AppSidebar
        collapsed={sidebarCollapsed}
        activeView={activeView}
        onToggle={toggleSidebar}
        onGoHome={() => navigateRoute({ section: "dashboard" })}
        onPrefetchPage={(page) => void pagePrefetcher.prefetch(page)}
        settingsPage={appRoute.section === "settings" ? appRoute.page : undefined}
        onSelectView={setActiveView}
        identity={identityMenu}
      />

      <section className={`content${activeView === "chat" ? " chat-content" : ""}${topbarTitle ? "" : " is-titleless"}`}>
        <AppTopBar
          section={topbarSection}
          title={topbarTitle}
        >
          {identityMenu}
        </AppTopBar>

        {errorMessage ? (
          <div className="feedback-banner error-banner global-error-toast"><TriangleAlert size={16} /><span>{errorMessage}</span><button onClick={() => setErrorMessage("")} aria-label="关闭错误提示"><X size={15} /></button></div>
        ) : null}

        {conversationDialog ? (
          <ConversationDialog
            dialog={conversationDialog}
            busy={conversationBusy}
            onClose={() => setConversationDialog(null)}
            onRename={(conversation, title) => void renameConversation(conversation, title)}
            onDelete={(conversation) => void removeConversation(conversation)}
          />
        ) : null}
        {noticeMessage ? (
          <div className="feedback-banner notice-banner global-notice-toast" role="status" aria-live="polite"><CheckCircle2 size={16} /><span>{noticeMessage}</span></div>
        ) : null}

        {activeView === "dashboard" ? (
          <Suspense fallback={<PageLoading label="正在加载首页…" />}>
            <HomePage
              apiBase={apiBase}
              accessToken={accessToken}
              displayName={user.display_name}
              email={userEmail}
              profileName={candidateEditor.name}
              targetRole={candidateEditor.targetRole}
              targetCity={candidateEditor.targetCity}
              resumeText={candidateEditor.resumeText}
              resumeFilename={candidateEditor.resumeFilename}
              skills={candidateEditor.skills}
              profileLoaded={candidateProfileLoaded}
              jobs={jobs}
              jobsLoaded={jobsLoaded}
              conversations={conversations}
              pendingFacts={pendingCareerFacts}
              onOpenAnalysis={() => navigateRoute({ section: "workbench", page: "index" })}
              onOpenResume={() => navigateRoute({ section: "workbench", page: "resume" })}
              onOpenInterview={() => {
                const resumePrepJob = jobs.find((item) => item.job_title === "按简历准备");
                navigateRoute(
                  resumePrepJob
                    ? { section: "workbench", page: "interview", jobId: resumePrepJob.id }
                    : { section: "workbench", page: "interview" }
                );
              }}
              onOpenProject={(experienceId) => navigateRoute({
                section: "project-lab",
                projectId: experienceId || undefined
              })}
              onOpenProfile={() => navigateRoute({ section: "settings", page: "profile" })}
              onOpenJob={(jobId) => {
                const job = jobs.find((item) => item.id === jobId);
                navigateRoute(
                  job?.latest_evaluation_id
                    ? { section: "workbench", page: "evaluation", jobId }
                    : { section: "workbench", page: "detail", jobId }
                );
              }}
              onOpenChat={(conversationId) => {
                if (conversationId) setCurrentConversationId(conversationId);
                navigateRoute({ section: "chat", conversationId });
              }}
              onOpenOpportunities={() => navigateRoute({ section: "opportunities", page: "index" })}
              onFactsChanged={() => void refreshCandidateProfile()}
            />
          </Suspense>
        ) : null}

        {activeView === "chat" ? (
          <Suspense fallback={<PageLoading label="正在加载对话…" />}>
            <ChatWorkspace
              conversationTitle={currentConversation?.title}
              messages={visibleChatMessages}
              hiddenMessageCount={hiddenMessageCount}
              chatBusy={chatBusy}
              currentConversationId={currentConversationId}
              conversations={conversations}
              conversationBusy={conversationBusy}
              waitingForUser={waitingForUser}
              latestAgent={latestAgent}
              taskCancelBusy={taskCancelBusy}
              retryDraft={retryChatDraft}
              chatEndRef={chatEndRef}
              chatInputRef={chatInputRef}
              sessionContext={{
                resumeLabel: hasSavedResume ? (candidateEditor.resumeFilename || "已保存简历") : null,
                analysisLabel: jobEvaluation
                  ? [jobEvaluation.job?.company_name, jobEvaluation.job?.job_title].filter(Boolean).join(" · ") || "最近一次分析"
                  : null
              }}
              onLoadMore={() => setVisibleMessageCount((count) => count + 12)}
              onSelectConversation={(conversationId) => {
                setCurrentConversationId(conversationId);
                setActiveView("chat");
              }}
              onCreateConversation={() => void createNewConversation()}
              onRenameConversation={(conversation) => setConversationDialog({ kind: "rename", conversation })}
              onArchiveConversation={(conversation) => void archiveConversation(conversation)}
              onRemoveConversation={(conversation) => setConversationDialog({ kind: "delete", conversation })}
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
              onOpenResume={() => {
                navigateRoute({ section: "settings", page: "profile" });
                const startedAt = Date.now();
                const tryScroll = () => {
                  const target = document.getElementById("resume-upload");
                  if (target) {
                    target.scrollIntoView({ behavior: "smooth", block: "start" });
                    return;
                  }
                  if (Date.now() - startedAt < 2000) window.requestAnimationFrame(tryScroll);
                };
                window.requestAnimationFrame(tryScroll);
              }}
            />
          </Suspense>
        ) : null}

        {activeView === "opportunities" ? (
          <Suspense fallback={<PageLoading label="正在加载岗位发现…" />}>
            <OpportunityDiscoveryPage
              apiBase={apiBase}
              accessToken={accessToken}
              page={appRoute.section === "opportunities" ? appRoute.page || "index" : "index"}
              runId={appRoute.section === "opportunities" ? appRoute.runId : undefined}
              discoveredJobId={appRoute.section === "opportunities" ? appRoute.discoveredJobId : undefined}
              onNavigateHome={() => navigateRoute({ section: "opportunities", page: "index" })}
              onNavigatePipeline={() => navigateRoute({ section: "opportunities", page: "pipeline" })}
              onNavigateSources={() => navigateRoute({ section: "opportunities", page: "sources" })}
              onNavigateRun={(runId) => navigateRoute({ section: "opportunities", page: "run", runId })}
              onNavigateJob={(discoveredJobId) => navigateRoute({ section: "opportunities", page: "job", discoveredJobId })}
              onJobsChanged={async () => { await refreshJobs(); }}
              onOpenPreparedJob={(jobId) => {
                const job = jobs.find((item) => item.id === jobId);
                navigateRoute(
                  job?.latest_evaluation_id
                    ? { section: "workbench", page: "evaluation", jobId }
                    : { section: "workbench", page: "detail", jobId }
                );
              }}
            />
          </Suspense>
        ) : null}

        {activeView === "workbench" ? (
          <Suspense fallback={<PageLoading label={appRoute.section === "workbench" && appRoute.page === "resume" ? "正在加载定制简历…" : appRoute.section === "workbench" && appRoute.page === "interview" ? "正在加载面试问答…" : "正在加载匹配分析…"} />}>
            {appRoute.section === "workbench" && ["evaluation", "evaluation_section", "comparison"].includes(appRoute.page || "") ? (
              <JobEvaluationPage
                apiBase={apiBase}
                accessToken={accessToken}
                page={appRoute.page as "evaluation" | "evaluation_section" | "comparison"}
                jobId={appRoute.jobId}
                job={jobs.find((item) => item.id === appRoute.jobId)}
                sectionKey={appRoute.sectionKey}
                comparisonId={appRoute.comparisonId}
                onBack={() => navigateRoute({ section: "workbench", page: "index" })}
                onOpenOverview={() => appRoute.jobId && navigateRoute({ section: "workbench", page: "evaluation", jobId: appRoute.jobId })}
                onOpenResume={() => appRoute.jobId && navigateRoute({ section: "workbench", page: "resume", jobId: appRoute.jobId })}
                onOpenInterview={() => appRoute.jobId && navigateRoute({ section: "workbench", page: "interview", jobId: appRoute.jobId })}
                onOpenSection={(sectionKey) => appRoute.jobId && navigateRoute({ section: "workbench", page: "evaluation_section", jobId: appRoute.jobId, sectionKey })}
                interviewKit={interviewKit}
                interviewBusy={interviewBusy}
                onCreateInterviewKit={async () => {
                  const job = jobs.find((item) => item.id === appRoute.jobId);
                  if (job) await createInterviewPreparation(job, "general");
                }}
              />
            ) : (
            <WorkbenchView
              viewMode={appRoute.section === "workbench" && ["index", "new", "detail", "resume", "interview"].includes(appRoute.page || "index") ? (appRoute.page || "index") as "index" | "new" | "detail" | "resume" | "interview" : "index"}
              hasProfile={hasSavedResume}
              resumeFilename={candidateEditor.resumeFilename}
              resumeText={candidateEditor.resumeText}
              profileName={candidateEditor.name}
              resumeLoading={!candidateProfileLoaded}
              chatBusy={chatBusy}
              jobBusy={jobBusy}
              jobImportBusy={jobImportBusy}
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
              onNavigateResume={(jobId) => navigateRoute(
                jobId
                  ? { section: "workbench", page: "resume", jobId }
                  : { section: "workbench", page: "resume" }
              )}
              onNavigateInterview={(jobId) => navigateRoute(
                jobId
                  ? { section: "workbench", page: "interview", jobId }
                  : { section: "workbench", page: "interview" }
              )}
              onNavigateEvaluation={(jobId) => navigateRoute({ section: "workbench", page: "evaluation", jobId })}
              onCreateComparison={createJobComparison}
              onQuickMatch={runQuickMatch}
              onApplyResumeRewrite={applyResumeRewrite}
              onSaveJob={saveJobProject}
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
              conversations={conversations}
              onOpenChat={(conversationId) => {
                setCurrentConversationId(conversationId);
                navigateRoute({ section: "chat", conversationId });
              }}
              onOpenProfile={() => navigateRoute({ section: "settings", page: "profile" })}
            />
            )}
          </Suspense>
        ) : null}

        {appRoute.section === "project-lab" ? (
          <Suspense fallback={<PageLoading label="正在加载项目…" />}>
            <ProjectStudioPage
              apiBase={apiBase}
              accessToken={accessToken}
              projectId={appRoute.projectId}
              onOpenProject={(projectId) => navigateRoute({ section: "project-lab", projectId })}
              onOpenProfile={() => navigateRoute({ section: "settings", page: "profile" })}
            />
          </Suspense>
        ) : null}

        {appRoute.section === "interview-prep" ? (
          <Suspense fallback={<PageLoading label="正在加载项目解析…" />}>
            <InterviewPreparationPage
              apiBase={apiBase}
              accessToken={accessToken}
              initialData={interviewPreparation}
              initialDataLoading={!databaseReady || interviewPreparationBusy}
              dataManagedByShell
              area={appRoute.page || "projects"}
              experienceId={appRoute.experienceId}
              focus={appRoute.focus as PreparationFocus | undefined}
              nodeId={appRoute.nodeId}
              onNavigate={({ area, experienceId, focus, nodeId }) => navigateRoute({ section: "interview-prep", page: area, experienceId, focus, nodeId })}
              onOpenProfile={() => navigateRoute({ section: "settings", page: "profile" })}
              onDataChange={setInterviewPreparation}
              autoAnalysisAttemptedRevision={autoAnalysisAttemptedRevision}
              onAutoAnalysisStarted={setAutoAnalysisAttemptedRevision}
            />
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
                  profileReady={settingsProfileReady}
                  accountEmail={user.email}
                  accountName={user.display_name}
                  modelName={savedAgentSettings.model_name}
                  apiKeyConfigured={savedAgentSettings.api_key_configured}
                  onOpen={(page) => navigateRoute({ section: "settings", page })}
                />
              ) : null}
              {appRoute.page === "account" ? (
                <AccountSettingsPage
                  apiBase={apiBase}
                  accessToken={accessToken}
                  account={user}
                  avatarUrl={avatarUrl}
                  onAccountChange={(next) => {
                    updateSession(accessToken, next);
                    if (next.has_avatar) setAvatarEpoch((value) => value + 1);
                  }}
                  onPasswordChanged={updateSession}
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
                  onClearResume={() => {
                    candidateProfileGenerationRef.current += 1;
                    setCandidateEditor((current) => ({
                      ...current,
                      resumeText: "",
                      resumeFilename: "",
                      resumeRedactedText: ""
                    }));
                    setCandidateProfileLoaded(true);
                    setPrivacyFindings([]);
                    setResumeProfileSuggestion(null);
                    setInterviewPreparation(null);
                    setAutoAnalysisAttemptedRevision(null);
                    if (!hasStoredResumeRef.current) {
                      routeDataCacheRef.current.invalidate("candidateProfile");
                      return;
                    }
                    void persistClearedResume().catch((error) => {
                      setErrorMessage(error instanceof Error ? error.message : "清除简历失败");
                    });
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
                  capabilities={modelCapabilities}
                  capabilitiesBusy={modelCapabilitiesBusy}
                  onSettingsChange={setAgentSettings}
                  onDiscoverModels={(force) => void discoverModels(agentSettings, { force, silent: !force })}
                  onCheckService={() => void checkModelService()}
                  onProbeCapabilities={() => void refreshModelCapabilities(true)}
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
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthGate apiBase={resolveApiBase()}>
        {(accessToken, onLogout, user, updateSession) => (
          <App accessToken={accessToken} onLogout={onLogout} user={user} updateSession={updateSession} />
        )}
      </AuthGate>
    </AppErrorBoundary>
  </React.StrictMode>
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount());
}
