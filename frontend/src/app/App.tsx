import { PageLoading } from "../components/PageLoading";
import { useChatRun } from "../features/chat/useChatRun";
import { useConversations } from "../features/chat/useConversations";
import { useLibrary } from "../features/library/useLibrary";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient, fetchWithTimeout } from "../api/client";
import type { AuthUser } from "../components/AuthGate";
import { AssistantSurface } from "../components/AssistantSurface";
import { AppSidebar, type ProductNavKey } from "../components/AppSidebar";
import { AppIdentityMenu } from "../components/AppIdentityMenu";
import { AppTopBar } from "../components/AppTopBar";
import { ConversationDialog } from "../components/ConversationDialog";
import type { AttachmentConfig, ChatAttachment } from "../features/chat/types";
import { defaultAgentSettings, pageMeta, topbarSectionForPage } from "../constants";
import { createPagePrefetcher } from "../page-prefetch";
import { createRouteDataCache, requiredDataForRoute, type RouteDataKey } from "../route-data";
import { useAsyncPolling } from "../hooks/useAsyncPolling";
import { appRouteHash, initialAppRoute, parseAppHash, routeForSection, type AppRoute } from "../routing";
import { isProductIntroHash } from "./public-routing";
import type { AgentCapabilities, AgentOperationsSnapshot, AgentSettings, Conversation, LibraryEditor, LibrarySourceDetail, ModelCapabilityReport, ModelServiceCheck, ModelServiceMonitor, ViewKey } from "../types";
import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import "../styles/foundations.css";
import "../AppStyles";

const loadChatWorkspace = () => import("../components/ChatWorkspace");

const loadHomePage = () => import("../features/home/HomePage");

const loadSettingsWorkspace = () => import("../features/settings/SettingsWorkspace");

const loadLibraryPage = () => import("../features/library/LibraryPage");

const loadAccountSettingsPage = () => import("../features/settings/AccountSettingsPage");

const ChatWorkspace = lazy(() => loadChatWorkspace().then((module) => ({
  default: module.ChatWorkspace
})));

const HomePage = lazy(() => loadHomePage().then((module) => ({
  default: module.HomePage
})));

const AgentOperationsDashboard = lazy(() => import("../features/settings/AgentOperationsDashboard").then((module) => ({
  default: module.AgentOperationsDashboard
})));

const SettingsWorkspace = lazy(() => loadSettingsWorkspace().then((module) => ({
  default: module.SettingsWorkspace
})));

const SettingsOverview = lazy(() => loadSettingsWorkspace().then((module) => ({
  default: module.SettingsOverview
})));

const LibraryPage = lazy(() => loadLibraryPage().then((module) => ({
  default: module.LibraryPage
})));

const AccountSettingsPage = lazy(() => loadAccountSettingsPage().then((module) => ({
  default: module.AccountSettingsPage
})));

const ModelSettingsPage = lazy(() => import("../features/settings/ModelSettingsPage").then((module) => ({
  default: module.ModelSettingsPage
})));

const pagePrefetcher = createPagePrefetcher({
  chat: loadChatWorkspace,
  library: () => Promise.all([loadSettingsWorkspace(), loadLibraryPage()]),
  account: () => Promise.all([loadSettingsWorkspace(), loadAccountSettingsPage()]),
  dashboard: loadHomePage,
  settings: loadSettingsWorkspace
});

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

export function App({
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
  const currentConversationIdRef = useRef<number | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(12);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const { conversations, setConversations, currentConversationId, setCurrentConversationId, conversationBusy, setConversationBusy, conversationDialog, setConversationDialog, refreshConversations, createNewConversation, archiveConversation, renameConversation, removeConversation } = useConversations({ fetchJson, setActiveView, setErrorMessage, setNoticeMessage });
  const { libraryEditor, librarySources, libraryFolders, organizeLibrarySource, createLibraryFolder, loadLibraryOriginal, searchLibrarySources, confirmedKnowledgeCount, sourceCount, pendingKnowledge, libraryLoaded, libraryBusy, sourceImportBusy, enhancedDocumentParse, setLibraryEditor, setEnhancedDocumentParse, refreshLibrary, saveLibraryMetadata, importLibraryFiles, createPastedSource, updateLibrarySource, downloadLibrarySource, deleteLibrarySource } = useLibrary({ fetchJson, apiBase, accessToken, setErrorMessage, setNoticeMessage });
  const [libraryAttachments, setLibraryAttachments] = useState<{ conversationId: number; attachments: ChatAttachment[] } | null>(null);
  const { chatMessages, setChatMessages, chatBusy, setChatBusy, modelUnavailable, setModelUnavailable, retryChatDraft, setRetryChatDraft, chatAgentRef, taskCancelBusy, setTaskCancelBusy, chatAttachmentBusy, setChatAttachmentBusy, refreshChat, uploadChatAttachment, removeChatAttachment, sendChatMessage, stopChatGeneration, rewindChatToUserMessage, editChatMessage, regenerateChatMessage, cancelCurrentTask } = useChatRun({ apiBase, accessToken, fetchJson, currentConversationId, currentConversationIdRef, setErrorMessage, setNoticeMessage, refreshConversations, onLibraryChanged: refreshLibrary });
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [attachmentConfig, setAttachmentConfig] = useState<AttachmentConfig | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
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
      if (isProductIntroHash(window.location.hash)) return;
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

  const hasLibrarySources = librarySources.some((source) => source.enabled && !source.trashed_at && source.parse_status === "ready");
  const libraryReady = libraryLoaded
    ? hasLibrarySources
    : null;
  const hiddenMessageCount = Math.max(0, chatMessages.length - visibleMessageCount);
  const visibleChatMessages = chatMessages.slice(-visibleMessageCount);
  const latestAgent = [...chatMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.payload?.agent)?.payload?.agent;
  const waitingForUser = latestAgent?.status === "waiting_user";

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
    if (!currentConversationId || !window.confirm("从当前位置开始新的上下文吗？\n\n历史消息仍然可见，但 Agent 后续不会再读取此前对话。资料库内容会保留。")) return;
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

  function handleNextStep() {
    navigateRoute({ section: "settings", page: "library" });
  }

  function handleSuggestedAction() {
    if (!waitingForUser) {
      handleNextStep();
      return;
    }
    void sendChatMessage("检查刚才的失败原因，告诉我最简单的恢复步骤");
  }

  useEffect(() => {
    async function initializeDatabase() {
      const database = await fetchJson<{
        status: "uninitialized" | "requires_rebuild" | "ready";
        reason?: string;
      }>("/system/database-status");
      if (database.status === "requires_rebuild") {
        const confirmed = window.confirm(
          "当前数据库格式无法自动升级。\n\n继续前会自动生成带时间戳的完整备份；备份可用于恢复原数据库。是否现在备份并重建？"
        );
        if (!confirmed) {
          throw new Error("已取消数据库重建。当前旧数据库保持不变，确认后才能进入灯灯。");
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
      library: refreshLibrary,
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
        void routeDataCacheRef.current.load("library", loaders.library);
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
    ]).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "切换对话失败");
    });
  }, [currentConversationId]);

  useEffect(() => {
    if (chatMessages.length > 0 || chatBusy) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [chatMessages, chatBusy]);

  const routePageMeta = appRoute.section === "settings"
    ? {
      overview: pageMeta.settings,
      account: { title: "账号与安全", description: "管理跟随登录账号的昵称、头像和密码" },
      library: { title: "文件库", description: "整理文件、阅读原件，选取资料用于对话" },
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
    document.title = `${documentPageTitle}｜灯灯`;
  }, [documentPageTitle]);

  const identityMenu = (
    <AppIdentityMenu
      userEmail={userEmail}
      accountName={user.display_name}
      avatarUrl={avatarUrl}
      activeView={activeView}
      settingsPage={appRoute.section === "settings" ? appRoute.page : undefined}
      onOpenProfile={() => navigateRoute({ section: "settings", page: "library" })}
      onOpenAccount={() => navigateRoute({ section: "settings", page: "account" })}
      onOpenSettings={() => navigateRoute({ section: "settings", page: "overview" })}
      onLogout={onLogout}
      onPrefetchPage={(page) => void pagePrefetcher.prefetch(page)}
    />
  );

  function selectProductNav(key: ProductNavKey) {
    if (key === "dashboard") navigateRoute({ section: "dashboard" });
    else if (key === "library") navigateRoute({ section: "settings", page: "library" });
    else if (key === "chat") navigateRoute({ section: "chat", conversationId: currentConversationId ?? undefined });
    else if (key === "settings") navigateRoute({ section: "settings", page: "overview" });
  }

  async function useLibraryForChat(sourceIds: number[]) {
    const result = await fetchJson<{ conversation: Conversation; attachments: ChatAttachment[] }>("/library/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_ids: sourceIds }) });
    await refreshConversations();
    setLibraryAttachments({ conversationId: result.conversation.id, attachments: result.attachments });
    setCurrentConversationId(result.conversation.id);
    navigateRoute({ section: "chat", conversationId: result.conversation.id });
    setNoticeMessage(`${result.attachments.length} 个文件已加入新对话，输入问题后发送`);
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

      <section className={`content${activeView === "chat" ? " chat-content is-chat-focus" : ""}${appRoute.section === "settings" && appRoute.page === "library" ? " library-content" : ""}${topbarTitle ? "" : " is-titleless"}`}>
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
              displayName={user.display_name}
              email={userEmail}
              libraryName={libraryEditor.name}
              sourceTitle={librarySources.find(source => !source.trashed_at)?.title}
              libraryLoaded={libraryLoaded}
              conversations={conversations}
              pendingFacts={pendingKnowledge}
              confirmedFactCount={confirmedKnowledgeCount}
              sourceCount={sourceCount}
              enabledSourceCount={librarySources.filter((source) => source.enabled && !source.trashed_at && source.parse_status === "ready").length}
              onOpenProfile={() => navigateRoute({ section: "settings", page: "library" })}

              onOpenChat={(conversationId) => {
                if (conversationId) setCurrentConversationId(conversationId);
                navigateRoute({ section: "chat", conversationId });
              }}
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
                  library={libraryEditor}
                  libraryReady={libraryReady}
                  sourceTitle={librarySources.find(source => !source.trashed_at)?.title}
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
              {appRoute.page === "library" ? (
                <LibraryPage
                  editor={libraryEditor}
                  sources={librarySources}
                  folders={libraryFolders}
                  onOrganizeSource={organizeLibrarySource}
                  onCreateFolder={createLibraryFolder}
                  onLoadOriginal={loadLibraryOriginal}
                  onSearchSources={searchLibrarySources}
                  onUseForChat={useLibraryForChat}
                  busy={libraryBusy}
                  sourceBusy={sourceImportBusy}
                  enhancedParse={enhancedDocumentParse}
                  pendingFacts={pendingKnowledge}
                  onChange={(editor: LibraryEditor) => setLibraryEditor(editor)}
                  onEnhancedParseChange={setEnhancedDocumentParse}
                  onImportFiles={importLibraryFiles}
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
                    await refreshLibrary();
                  }}
                  onSave={async () => {
                    return saveLibraryMetadata();
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
            libraryAttachments={libraryAttachments}
            onLibraryAttachmentsConsumed={() => setLibraryAttachments(null)}
            conversations={conversations}
            conversationBusy={conversationBusy}
            waitingForUser={waitingForUser}
            latestAgent={latestAgent}
            taskCancelBusy={taskCancelBusy}
            retryDraft={retryChatDraft}
            chatEndRef={chatEndRef}
            chatInputRef={chatInputRef}
            sessionContext={{
              sourceLabel: hasLibrarySources ? (librarySources.find((source) => source.enabled && !source.trashed_at && source.parse_status === "ready")?.title || "已保存资料") : null,
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
            onOpenLibrary={() => {
              navigateRoute({ section: "settings", page: "library" });
              const startedAt = Date.now();
              const tryScroll = () => {
                const target = document.getElementById("library-sources");
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
