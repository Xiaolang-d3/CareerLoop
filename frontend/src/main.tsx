import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentSubscriber, HttpAgent as HttpAgentType } from "@ag-ui/client";
import { createApiClient, fetchWithTimeout } from "./api/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthGate, type AuthUser } from "./components/AuthGate";
import { AssistantSurface } from "./components/AssistantSurface";
import { AppSidebar, type ProductNavKey } from "./components/AppSidebar";
import { AppIdentityMenu } from "./components/AppIdentityMenu";
import { AppTopBar } from "./components/AppTopBar";
import { createClientId } from "./api/clientId";
import { interruptedRunRetryDraft, type DurableAgentRunSummary } from "./durable-agent-run";
import { ConversationDialog, type ConversationDialogState } from "./components/ConversationDialog";
import type { AgentRunResult, AttachmentConfig, ChatAttachment, ChatMessage, ChatRetryDraft, WebSearchMode } from "./components/ChatWorkspace";
import {
  defaultAgentSettings,
  emptyCandidateEditor,
  pageMeta,
  topbarSectionForPage
} from "./constants";
import { inboxFactLabel } from "./features/home/home-metrics";
import { createPagePrefetcher } from "./page-prefetch";
import { createRouteDataCache, requiredDataForRoute, type RouteDataKey } from "./route-data";
import { useAsyncPolling } from "./hooks/useAsyncPolling";
import { appRouteHash, initialAppRoute, parseAppHash, routeForSection, type AppRoute } from "./routing";
import type {
  AgentCapabilities,
  AgentOperationsSnapshot,
  AgentSettings,
  CandidateEditor,
  CareerProfileBundle,
  Conversation,
  LibrarySource,
  LibrarySourceDetail,
  ModelCapabilityReport,
  ModelServiceCheck,
  ModelServiceMonitor,
  ViewKey,
  WorkflowStatus
} from "./types";
import {
  CheckCircle2,
  Database,
  LoaderCircle,
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
const loadHomePage = () => import("./features/home/HomePage");
const loadSettingsWorkspace = () => import("./features/settings/SettingsWorkspace");
const loadProfileSettingsPage = () => import("./features/settings/ProfileSettingsPage");
const loadAccountSettingsPage = () => import("./features/settings/AccountSettingsPage");
const ChatWorkspace = lazy(() => loadChatWorkspace().then((module) => ({
  default: module.ChatWorkspace
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

const pagePrefetcher = createPagePrefetcher({
  chat: loadChatWorkspace,
  profile: () => Promise.all([loadSettingsWorkspace(), loadProfileSettingsPage()]),
  account: () => Promise.all([loadSettingsWorkspace(), loadAccountSettingsPage()]),
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

type DesktopRuntimeConfig = { apiBase?: string | null; startupError?: string | null };

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke: <T>(command: string) => Promise<T> } };
  }
}

async function resolveApiBase(): Promise<DesktopRuntimeConfig> {
  const desktopApiBase = import.meta.env.VITE_API_BASE?.trim();
  if (desktopApiBase) return { apiBase: desktopApiBase.replace(/\/$/, "") };
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    try {
      const runtime = await invoke<DesktopRuntimeConfig>("desktop_runtime_config");
      if (runtime.startupError || !runtime.apiBase) return runtime;
      return runtime;
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      return { startupError: `桌面运行时读取失败：${detail}` };
    }
  }
  // Bundled desktop must talk through Tauri; falling back to location.origin
  // (https://tauri.localhost) looks "started" but cannot reach the sidecar.
  if (window.location.protocol.startsWith("tauri") || /tauri\.localhost$/i.test(window.location.hostname)) {
    return { startupError: "桌面运行时未注入，请重新安装或从仓库重建 CareerLoop.app" };
  }
  return { apiBase: import.meta.env.DEV ? "/api" : window.location.origin };
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
  return route.section === "settings";
}

function App({
  apiBase,
  accessToken,
  onLogout,
  user,
  updateSession
}: {
  apiBase: string;
  accessToken: string;
  onLogout: () => void;
  user: AuthUser;
  updateSession: (token: string, nextUser: AuthUser) => void;
}) {
  const userEmail = user.email;
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
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const currentConversationIdRef = useRef<number | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [conversationDialog, setConversationDialog] = useState<ConversationDialogState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(12);
  const [chatBusy, setChatBusy] = useState(false);
  const [modelUnavailable, setModelUnavailable] = useState<string | null>(null);
  const [retryChatDraft, setRetryChatDraft] = useState<ChatRetryDraft | null>(null);
  const chatAgentRef = useRef<HttpAgentType | null>(null);
  const [taskCancelBusy, setTaskCancelBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [attachmentConfig, setAttachmentConfig] = useState<AttachmentConfig | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [candidateEditor, setCandidateEditor] = useState(emptyCandidateEditor);
  const [librarySources, setLibrarySources] = useState<LibrarySource[]>([]);
  const [confirmedCareerFactCount, setConfirmedCareerFactCount] = useState(0);
  const [careerSourceCount, setCareerSourceCount] = useState(0);
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
    const nextHash = appRouteHash(route);
    const nextRoute = parseAppHash(nextHash) ?? route;
    setAppRoute(nextRoute);
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
      const next = parseAppHash(window.location.hash) ?? { section: "chat" as const };
      const canonicalHash = appRouteHash(next);
      if (window.location.hash !== canonicalHash) {
        window.history.replaceState(null, "", canonicalHash);
      }
      setAppRoute(next);
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
    void fetchWithTimeout(`${apiBase}/auth/me/avatar`, {
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

  const hasSavedResume = Boolean(candidateEditor.resumeText.trim());
  const settingsProfileReady = candidateProfileLoaded
    ? Boolean(candidateEditor.name.trim() && candidateEditor.resumeText.trim())
    : null;
  const hiddenMessageCount = Math.max(0, chatMessages.length - visibleMessageCount);
  const visibleChatMessages = chatMessages.slice(-visibleMessageCount);
  const latestAgent = [...chatMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.payload?.agent)?.payload?.agent;
  const waitingForUser = latestAgent?.status === "waiting_user";
  async function refreshData(_conversationId = currentConversationId) {
    // Task progress is provided by durable Agent runs, not career stages.
  }

  async function refreshChat(conversationId = currentConversationId) {
    if (!conversationId) return;
    const [messages, durableRunResponse] = await Promise.all([
      fetchJson<ChatMessage[]>(`/chat/messages?conversation_id=${conversationId}`),
      fetchJson<{ run: DurableAgentRunSummary | null }>(`/agent/runs/current?conversation_id=${conversationId}`)
    ]);
    setChatMessages(messages);
    const interruptedDraft = interruptedRunRetryDraft(durableRunResponse.run, messages);
    if (interruptedDraft) {
      setRetryChatDraft(interruptedDraft);
    } else {
      setRetryChatDraft((current) => current?.reason === "interrupted" ? null : current);
    }
    return messages;
  }

  async function refreshConversations() {
    const next = await fetchJson<Conversation[]>("/conversations");
    setConversations(next);
    return next;
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
    try {
      const next = await fetchJson<AgentCapabilities>("/agent/capabilities");
      setCapabilities(next);
      return next;
    } catch (error) {
      setCapabilities(null);
      setErrorMessage(error instanceof Error ? `无法读取服务能力：${error.message}` : "无法读取服务能力");
      return null;
    }
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
    const keyOptional = next.resolved_model_protocol === "ollama";
    updateModelSettingsEditing(!next.api_key_configured && !keyOptional);
    if (next.api_key_configured || keyOptional) {
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
              model_protocol: agentSettings.model_protocol,
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
      const next = await fetchJson<ModelServiceCheck>("/agent/model-monitor/check", {
        method: "POST"
      });
      setModelMonitor(next);
      if (next.available) {
        setModelUnavailable(null);
        setNoticeMessage("连接检测成功");
      } else {
        setErrorMessage(next.check_error_message || "模型连接检测失败");
      }
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
    const discoveryKey = `${settings.model_base_url.trim()}|${settings.model_protocol}|${settings.model_name.trim()}|${settings.api_key ? "draft" : "saved"}`;
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
            model_name: settings.model_name,
            model_protocol: settings.model_protocol,
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
    const protocolName = {
      auto: "自动匹配",
      openai: "OpenAI 兼容 Chat Completions",
      responses: "OpenAI Responses API",
      anthropic: "Anthropic Messages API",
      gemini: "Google Gemini generateContent",
      ollama: "Ollama Chat API"
    }[agentSettings.model_protocol];
    if (!window.confirm(`确认应用模型连接吗？\n\n模型：${agentSettings.model_name}\n协议：${protocolName}\n服务：${agentSettings.model_base_url || "官方默认地址"}\n\n新的连接将从下一次模型调用开始生效。`)) return;
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
      let connectionCheck: ModelServiceCheck | null = null;
      let connectionCheckFailure = "";
      try {
        connectionCheck = await fetchJson<ModelServiceCheck>("/agent/model-monitor/check", {
          method: "POST"
        });
        setModelMonitor(connectionCheck);
      } catch (checkError) {
        connectionCheckFailure = checkError instanceof Error
          ? checkError.message
          : "无法完成模型连接检测";
      }
      await Promise.all([refreshCapabilities(), refreshModelCapabilities()]);
      void discoverModels(clean, { silent: true, force: true });
      if (connectionCheck?.available) {
        setModelUnavailable(null);
        setNoticeMessage("设置已保存，连接检测成功");
      } else {
        const reason = connectionCheck?.check_error_message || connectionCheckFailure || "模型服务暂不可用";
        setNoticeMessage("设置已保存");
        setErrorMessage(`配置已保存，但连接检测失败：${reason}`);
      }
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

  async function refreshCandidateProfile() {
    try {
      const bundle = await fetchJson<CareerProfileBundle>("/library");
      const confirmedFacts = bundle.facts.filter((fact) => fact.status === "confirmed");
      const pendingFacts = bundle.facts.filter((fact) => fact.status === "pending");
      const blockedSkills = new Set(
        bundle.facts
          .filter((fact) => fact.category === "skill" && (fact.status === "disputed" || fact.status === "retracted"))
          .map((fact) => inboxFactLabel(fact).toLowerCase())
          .filter(Boolean)
      );
      const skills = confirmedFacts
        .filter((fact) => fact.category === "skill")
        .map(inboxFactLabel)
        .filter((name, index, items) => name && !blockedSkills.has(name.toLowerCase()) && items.indexOf(name) === index);
      setConfirmedCareerFactCount(confirmedFacts.length);
      setCareerSourceCount(bundle.sources.length);
      setLibrarySources(bundle.sources);
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
        name: bundle.profile?.name || "",
        skills: skills.join("，"),
        resumeText: "",
        resumeRedactedText: "",
        resumeFilename: bundle.sources[0]?.title || "",
        privacyMode: bundle.profile?.privacy_mode || "redacted"
      }));
    } finally {
      setCandidateProfileLoaded(true);
    }
  }

  async function saveCandidateProfile(): Promise<boolean> {
    setCandidateProfileBusy(true);
    setErrorMessage("");
    try {
      await fetchJson("/library", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: candidateEditor.name.trim(),
          locale: "zh-CN",
          privacy_mode: candidateEditor.privacyMode
        })
      });
      await Promise.all([refreshCandidateProfile(), refreshData()]);
      setNoticeMessage("个性化信息已保存");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存资料库失败");
      return false;
    } finally {
      setCandidateProfileBusy(false);
    }
  }

  async function parseResumeFiles(files: File[]) {
    if (!files.length) return;
    setResumeParseBusy(true);
    setErrorMessage("");
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      form.append("mode", enhancedResumeParse ? "enhanced" : "fast");
      form.append("privacy_mode", "redacted");
      const response = await fetchJson<{ results: Array<{ filename: string; ok: boolean; error?: string }> }>("/library/sources/import", {
        method: "POST",
        body: form
      });
      const failures = response.results.filter((item) => !item.ok);
      await Promise.all([refreshCandidateProfile(), refreshData()]);
      if (failures.length) {
        setErrorMessage(`${response.results.length - failures.length} 个文件已导入，${failures.length} 个失败：${failures.map((item) => item.filename).join("、")}`);
      } else {
        setNoticeMessage(`${response.results.length} 个来源已独立导入`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "资料解析失败");
    } finally {
      setResumeParseBusy(false);
    }
  }

  async function createPastedSource(title: string, content: string, privacyMode: "redacted" | "original") {
    await fetchJson("/library/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, privacy_mode: privacyMode })
    });
    await Promise.all([refreshCandidateProfile(), refreshData()]);
    setNoticeMessage("文本来源已创建");
  }

  async function updateLibrarySource(sourceId: number, changes: Partial<Pick<LibrarySource, "title" | "privacy_mode" | "enabled">> & { content?: string }) {
    await fetchJson(`/library/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes)
    });
    await refreshCandidateProfile();
  }

  async function downloadLibrarySource(source: LibrarySourceDetail) {
    const response = await fetchWithTimeout(`${apiBase}/library/sources/${source.id}/file`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error("原文件下载失败，请重试");
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = source.original_filename || source.title;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }

  async function deleteLibrarySource(sourceId: number) {
    await fetchJson(`/library/sources/${sourceId}`, { method: "DELETE" });
    await Promise.all([refreshCandidateProfile(), refreshData()]);
    setNoticeMessage("来源及本地原文件已删除");
  }

  async function uploadChatAttachment(file: File): Promise<ChatAttachment> {
    if (!currentConversationId) throw new Error("请先选择一个对话");
    const filename = file.name.toLowerCase();
    const kind = /\.(png|jpe?g|webp)$/.test(filename) ? "job_screenshot" : /\.(pdf|docx|txt|md)$/.test(filename) ? "resume" : null;
    if (!kind) throw new Error("仅支持图片（PNG、JPG、WEBP）或文档（PDF、DOCX、TXT、MD）");
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
      setNoticeMessage(kind === "resume" ? "文档已添加" : "图片已添加");
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
    webSearchMode: WebSearchMode = "auto",
    conversationIdOverride?: number,
    runIdOverride?: string,
    rewindMessageId?: number,
  ) {
    const content = contentOverride.trim();
    const targetConversationId = conversationIdOverride ?? currentConversationId;
    if (!content || chatBusy || !targetConversationId) return;
    setModelUnavailable(null);
    // Editing/retrying must not remove previous messages until the model works.
    if (rewindMessageId !== undefined) await rewindChatToUserMessage(rewindMessageId);
    const { HttpAgent } = await import("@ag-ui/client");
    const conversationId = targetConversationId;
    const executionRunId = runIdOverride ?? createClientId();
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
      const agentError = assistantMessage.payload?.agent?.error;
      if (agentError?.code && /model|provider|authentication|service|rate_limit|timeout/.test(agentError.code)) {
        setModelUnavailable(agentError.message || "模型服务暂不可用，请到模型设置检查配置后重试。");
        setRetryChatDraft({
          content: userMessage.content,
          attachmentIds,
          visionAttachmentIds,
          webSearch,
          webSearchMode,
          rewindMessageId: userMessage.id,
          reason: "send_failed"
        });
      }
      if (status === "cancelled") setNoticeMessage("已停止生成");
    };

    const agent = new HttpAgent({
      url: `${apiBase}/ag-ui`,
      fetch: (url, requestInit) => fetchWithTimeout(url, requestInit, 600_000),
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
          runId: executionRunId,
          tools: [],
          context: [],
          forwardedProps: { conversationId, client: "careerloop-web", attachmentIds, visionAttachmentIds, webSearch, webSearchMode }
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
      const message = error instanceof Error ? error.message : "消息发送失败";
      setErrorMessage(message);
      setModelUnavailable(message);
      setRetryChatDraft({
        content,
        attachmentIds,
        visionAttachmentIds,
        webSearch,
        webSearchMode,
        runId: executionRunId,
        reason: "send_failed"
      });
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
    await sendChatMessage(content, [], [], false, "auto", undefined, undefined, userMessageId);
  }

  async function regenerateChatMessage(userMessageId: number) {
    const sourceMessage = chatMessages.find(
      (message) => message.id === userMessageId && message.role === "user"
    );
    if (!sourceMessage) throw new Error("找不到要重新生成的用户消息");
    await sendChatMessage(sourceMessage.content, [], [], false, "auto", undefined, undefined, userMessageId);
  }

  function handleNextStep() {
    navigateRoute({ section: "settings", page: "profile" });
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
      modelMonitor: refreshModelMonitor,
      modelCapabilities: () => refreshModelCapabilities(false),
    };
    void Promise.all(requiredDataForRoute(appRoute).map((key) => (
      routeDataCacheRef.current.load(key, loaders[key])
    ))).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "读取页面数据失败");
    });
    if (appRoute.section === "dashboard") {
      const timer = window.setTimeout(() => {
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
        profile: { title: "我的知识库", description: "管理来源材料、已确认知识和待确认内容" },
        model: { title: "模型设置", description: "配置推理模型、服务地址和 API Key，并检查连接质量" },
        agent: { title: "Agent 执行记录", description: "查看 Agent 已完成的任务、工具使用和异常原因" }
      }[appRoute.page]
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
      onOpenSettings={() => navigateRoute({ section: "settings", page: "overview" })}
      onLogout={onLogout}
      onPrefetchPage={(page) => void pagePrefetcher.prefetch(page)}
    />
  );

  function selectProductNav(key: ProductNavKey) {
    if (key === "dashboard") navigateRoute({ section: "dashboard" });
    else if (key === "library") navigateRoute({ section: "settings", page: "profile" });
    else if (key === "chat") navigateRoute({ section: "chat", conversationId: currentConversationId ?? undefined });
    else if (key === "settings") navigateRoute({ section: "settings", page: "overview" });
  }

  return (
    <main className={`app-shell has-chat-dock shell-light${activeView === "chat" ? " chat-focused" : ""}`}>
      <AppSidebar
        collapsed={sidebarCollapsed}
        activeView={activeView}
        onToggle={toggleSidebar}
        onGoHome={() => navigateRoute({ section: "dashboard" })}
        onPrefetchPage={(page) => void pagePrefetcher.prefetch(page)}
        settingsPage={appRoute.section === "settings" ? appRoute.page : undefined}
        onSelectNav={selectProductNav}
        identity={identityMenu}
      />

      <section className={`content${activeView === "chat" ? " chat-content is-chat-focus" : ""}${topbarTitle ? "" : " is-titleless"}`}>
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
              resumeText={candidateEditor.resumeText}
              resumeFilename={candidateEditor.resumeFilename}
              profileLoaded={candidateProfileLoaded}
              conversations={conversations}
              pendingFacts={pendingCareerFacts}
              confirmedFactCount={confirmedCareerFactCount}
              sourceCount={careerSourceCount}
              onOpenProfile={() => navigateRoute({ section: "settings", page: "profile" })}

              onOpenChat={(conversationId) => {
                if (conversationId) setCurrentConversationId(conversationId);
                navigateRoute({ section: "chat", conversationId });
              }}
              onOpenOpportunities={() => navigateRoute({ section: "dashboard" })}
              onFactsChanged={() => void refreshCandidateProfile()}
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
                  editor={candidateEditor}
                  sources={librarySources}
                  busy={candidateProfileBusy}
                  sourceBusy={resumeParseBusy}
                  enhancedParse={enhancedResumeParse}
                  pendingFacts={pendingCareerFacts}
                  onChange={(editor: CandidateEditor) => setCandidateEditor(editor)}
                  onEnhancedParseChange={setEnhancedResumeParse}
                  onImportFiles={parseResumeFiles}
                  onCreateText={createPastedSource}
                  onLoadSource={(sourceId) => fetchJson<LibrarySourceDetail>(`/library/sources/${sourceId}`)}
                  onUpdateSource={updateLibrarySource}
                  onDownloadSource={downloadLibrarySource}
                  onDeleteSource={deleteLibrarySource}
                  onReviewFact={async (factId, action) => {
                    await fetchJson(`/library/facts/${factId}/review`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action })
                    });
                    await refreshCandidateProfile();
                  }}
                  onSave={async () => {
                    return saveCandidateProfile();
                  }}
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

      <AssistantSurface page={activeView === "chat"} open={assistantOpen} busy={chatBusy} onClose={() => setAssistantOpen(false)} onExpand={() => { setAssistantOpen(false); navigateRoute({ section: "chat", conversationId: currentConversationId ?? undefined }); }}>

        <Suspense fallback={<PageLoading label="正在加载对话…" />}>
            <ChatWorkspace
              density={activeView === "chat" ? "page" : "dock"}
              focused={activeView === "chat"}
              conversationTitle={currentConversation?.title}
              messages={visibleChatMessages}
              hiddenMessageCount={hiddenMessageCount}
              chatBusy={chatBusy}
              modelUnavailable={modelUnavailable}
              onOpenModelSettings={() => navigateRoute({ section: "settings", page: "model" })}
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
                resumeLabel: hasSavedResume ? (candidateEditor.resumeFilename || "已保存资料") : null,
                analysisLabel: null,
              }}
              onLoadMore={() => setVisibleMessageCount((count) => count + 12)}
              onSelectConversation={(conversationId) => {
                setCurrentConversationId(conversationId);
                navigateRoute({ section: "chat", conversationId });
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
              onRetry={(draft) => sendChatMessage(
                draft.content,
                draft.attachmentIds,
                draft.visionAttachmentIds,
                draft.webSearch,
                draft.webSearchMode,
                undefined,
                draft.runId,
                draft.rewindMessageId
              )}
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
      </AssistantSurface>
    </main>
  );
}

function Bootstrap() {
  const [runtime, setRuntime] = useState<DesktopRuntimeConfig | null>(null);

  useEffect(() => {
    void resolveApiBase()
      .then(setRuntime)
      .catch((error: unknown) => setRuntime({
        startupError: error instanceof Error ? error.message : "无法读取桌面运行配置"
      }));
  }, []);

  if (!runtime) return <PageLoading label="正在启动 CareerLoop…" />;
  if (runtime.startupError || !runtime.apiBase) {
    return (
      <main className="page-loading" role="alert">
        <div className="page-loading-copy">
          <TriangleAlert size={20} />
          <span>{runtime.startupError || "本地服务地址不可用，请重新启动 CareerLoop。"}</span>
        </div>
      </main>
    );
  }
  return (
    <AuthGate apiBase={runtime.apiBase}>
      {(accessToken, onLogout, user, updateSession) => (
        <App apiBase={runtime.apiBase!} accessToken={accessToken} onLogout={onLogout} user={user} updateSession={updateSession} />
      )}
    </AuthGate>
  );
}

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Bootstrap />
    </AppErrorBoundary>
  </React.StrictMode>
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount());
}
