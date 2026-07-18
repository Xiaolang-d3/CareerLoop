import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentSubscriber, HttpAgent as HttpAgentType } from "@ag-ui/client";
import { createApiClient } from "./api/client";
import { AppSidebar } from "./components/AppSidebar";
import { ChatWorkspace, type AgentRunResult, type AttachmentConfig, type ChatAttachment, type ChatMessage, type ChatRetryDraft } from "./components/ChatWorkspace";
import { ApplicationsView, ReviewView, ToolsView } from "./components/WorkspaceViews";
import {
  bossHomeUrl,
  defaultAgentSettings,
  emptyCandidateEditor,
  emptyJobImport,
  emptyProfile,
  pageMeta,
  toolLabels
} from "./constants";
import type {
  AgentCapabilities,
  AgentSettings,
  Application,
  CandidateProfileBundle,
  Conversation,
  Job,
  ViewKey,
  WorkflowStatus
} from "./types";
import {
  ArrowUpRight,
  Archive,
  BarChart3,
  Bookmark,
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  CircleDot,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  GraduationCap,
  Layers3,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Save,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  UserRound,
  Upload,
  WandSparkles,
  X
} from "lucide-react";
import "./styles.css";

function App() {
  const apiBase = useMemo(() => `${window.location.protocol}//${window.location.hostname}:8000`, []);
  const fetchJson = useMemo(() => createApiClient(apiBase), [apiBase]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem("bosscopilot-sidebar") === "collapsed");
  const [activeView, setActiveView] = useState<ViewKey>(() => {
    const savedView = window.localStorage.getItem("bosscopilot-view") as ViewKey | null;
    return savedView && ["chat", "profile", "jobs", "tools", "agent", "applications", "review"].includes(savedView) ? savedView : "chat";
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const currentConversationIdRef = useRef<number | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(12);
  const [chatBusy, setChatBusy] = useState(false);
  const [retryChatDraft, setRetryChatDraft] = useState<ChatRetryDraft | null>(null);
  const chatAgentRef = useRef<HttpAgentType | null>(null);
  const [taskCancelBusy, setTaskCancelBusy] = useState(false);
  const [jobCleanupBusy, setJobCleanupBusy] = useState(false);
  const [jobImportOpen, setJobImportOpen] = useState(false);
  const [jobImportBusy, setJobImportBusy] = useState(false);
  const [jobScreenshotBusy, setJobScreenshotBusy] = useState(false);
  const [jobImport, setJobImport] = useState(emptyJobImport);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [attachmentConfig, setAttachmentConfig] = useState<AttachmentConfig | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileDraft, setProfileDraft] = useState(emptyProfile);
  const [candidateEditor, setCandidateEditor] = useState(emptyCandidateEditor);
  const [candidateProfileBusy, setCandidateProfileBusy] = useState(false);
  const [resumeParseBusy, setResumeParseBusy] = useState(false);
  const [chatAttachmentBusy, setChatAttachmentBusy] = useState(false);
  const [enhancedResumeParse, setEnhancedResumeParse] = useState(false);
  const [privacyFindings, setPrivacyFindings] = useState<Array<{ entity_type: string; preview: string }>>([]);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(defaultAgentSettings);
  const [agentSettingsBusy, setAgentSettingsBusy] = useState(false);
  const currentConversation = conversations.find((item) => item.id === currentConversationId) ?? null;

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

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

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
  const appliedCount = applications.filter((item) => item.status === "applied").length;
  const queuedCount = applications.filter((item) => item.status === "queued").length;
  const completedNodes = workflow?.nodes.filter((node) => node.status === "done").length ?? 0;
  const hasProfile = (workflow?.counts.profiles ?? 0) > 0;
  const hasJobs = (workflow?.counts.jobs ?? 0) > 0;
  const hiddenMessageCount = Math.max(0, chatMessages.length - visibleMessageCount);
  const visibleChatMessages = chatMessages.slice(-visibleMessageCount);
  const latestAgent = [...chatMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.payload?.agent)?.payload?.agent;
  const waitingForUser = latestAgent?.status === "waiting_user";
  const recentToolEvents = chatMessages
    .flatMap((message) => message.payload?.agent?.events ?? [])
    .slice(-8)
    .reverse();

  const nextStep = !hasProfile
    ? { title: "先建立求职画像", detail: "用 1 分钟告诉我目标岗位、城市和核心技能。", action: "设置画像", kind: "profile" as const }
    : !hasJobs
      ? { title: "导入一个真实岗位", detail: "粘贴岗位文字或上传自己保存的截图，检查后进入本地岗位库。", action: "手动导入", kind: "import" as const }
      : queuedCount > 0
        ? { title: `确认 ${queuedCount} 个待投岗位`, detail: "检查岗位和沟通草稿后，再由你决定是否前往 BOSS。", action: "查看待投", kind: "applications" as const }
        : { title: "继续分析岗位", detail: `岗位库已有 ${jobs.length} 个岗位，可以深挖高匹配机会。`, action: "查看岗位", kind: "jobs" as const };

  async function refreshData(showFeedback = false, conversationId = currentConversationId) {
    if (showFeedback) setRefreshBusy(true);
    try {
      const [nextJobs, nextApplications, nextWorkflow] = await Promise.all([
        fetchJson<Job[]>("/jobs"),
        fetchJson<Application[]>("/applications"),
        fetchJson<WorkflowStatus>(`/workflow/status${conversationId ? `?conversation_id=${conversationId}` : ""}`)
      ]);
      setJobs(nextJobs);
      setApplications(nextApplications);
      setWorkflow(nextWorkflow);
      setSelectedJobId((current) => current ?? nextJobs[0]?.id ?? null);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "数据刷新失败");
    } finally {
      if (showFeedback) setRefreshBusy(false);
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
      setNoticeMessage("已新建独立对话。求职画像和岗位库仍会共享。");
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
    if (!window.confirm(`确定删除对话“${conversation.title}”吗？\n\n只删除该对话和任务记录，不会删除求职画像或岗位库。`)) return;
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
    setAgentSettings(await fetchJson<AgentSettings>("/agent/settings"));
  }

  async function saveAgentPreferences() {
    setAgentSettingsBusy(true);
    setErrorMessage("");
    try {
      const saved = await fetchJson<AgentSettings>("/agent/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentSettings)
      });
      setAgentSettings(saved);
      setNoticeMessage("Agent 人设、记忆和上下文设置已保存在本地，将从下一条消息开始生效。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存 Agent 设置失败");
    } finally {
      setAgentSettingsBusy(false);
    }
  }

  async function resetCurrentContext() {
    if (!currentConversationId || !window.confirm("从当前位置开始新的上下文吗？\n\n历史消息仍然可见，但 Agent 后续不会再读取此前对话。人物画像和岗位库不会删除。")) return;
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
    const bundle = await fetchJson<CandidateProfileBundle>("/candidate-profile");
    if (!bundle.profile) {
      setCandidateEditor(emptyCandidateEditor);
      return;
    }
    setCandidateEditor({
      name: bundle.profile.name || "",
      targetRole: bundle.preferences?.target_roles?.join("，") || "",
      targetCity: bundle.preferences?.target_cities?.join("，") || "",
      salaryMin: bundle.preferences?.salary_min ? String(Math.round(bundle.preferences.salary_min / 1000)) : "",
      salaryMax: bundle.preferences?.salary_max ? String(Math.round(bundle.preferences.salary_max / 1000)) : "",
      skills: bundle.profile.skills?.join("，") || "",
      industries: bundle.preferences?.preferred_industries?.join("，") || "",
      blockedKeywords: bundle.preferences?.blocked_keywords?.join("，") || "",
      blockedCompanies: bundle.preferences?.blocked_companies?.join("，") || "",
      resumeText: bundle.profile.resume_text || "",
      resumeFilename: bundle.profile.resume_filename || "",
      resumeRedactedText: bundle.profile.resume_redacted_text || "",
      privacyMode: bundle.profile.privacy_mode || "redacted"
    });
  }

  async function saveCandidateProfile() {
    if (!candidateEditor.name.trim()) {
      setErrorMessage("请填写称呼");
      return;
    }
    setCandidateProfileBusy(true);
    setErrorMessage("");
    try {
      await fetchJson("/candidate-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: candidateEditor.name.trim(),
          resume_text: candidateEditor.resumeText,
          resume_filename: candidateEditor.resumeFilename,
          resume_redacted_text: candidateEditor.resumeRedactedText,
          privacy_mode: candidateEditor.privacyMode,
          skills: splitList(candidateEditor.skills),
          projects: [],
          target_roles: splitList(candidateEditor.targetRole),
          target_cities: splitList(candidateEditor.targetCity),
          salary_min: candidateEditor.salaryMin ? Number(candidateEditor.salaryMin) * 1000 : null,
          salary_max: candidateEditor.salaryMax ? Number(candidateEditor.salaryMax) * 1000 : null,
          preferred_industries: splitList(candidateEditor.industries),
          blocked_keywords: splitList(candidateEditor.blockedKeywords),
          blocked_companies: splitList(candidateEditor.blockedCompanies)
        })
      });
      await Promise.all([refreshCandidateProfile(), refreshData()]);
      setNoticeMessage("个人资料已保存在本地，Agent 后续分析会读取这些信息。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存个人资料失败");
    } finally {
      setCandidateProfileBusy(false);
    }
  }

  async function parseResumeFile(file: File | undefined) {
    if (!file) return;
    setResumeParseBusy(true);
    setErrorMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", enhancedResumeParse ? "enhanced" : "fast");
      const result = await fetchJson<{ filename: string; text: string; redacted_text: string; privacy_findings: Array<{ entity_type: string; preview: string }>; suggested_skills: string[]; character_count: number; parser: string; warnings: string[] }>("/candidate-profile/resume/parse", {
        method: "POST",
        body: form
      });
      setCandidateEditor((current) => ({
        ...current,
        resumeText: result.text,
        resumeFilename: result.filename,
        resumeRedactedText: result.redacted_text,
        skills: splitList(current.skills).length ? current.skills : result.suggested_skills.join("，")
      }));
      setPrivacyFindings(result.privacy_findings);
      const fallback = result.warnings.length ? ` ${result.warnings.join("；")}。` : "";
      setNoticeMessage(`已用${result.parser === "docling" ? "增强" : "快速"}模式解析“${result.filename}”，提取 ${result.character_count} 个字符。${fallback}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "简历解析失败");
    } finally {
      setResumeParseBusy(false);
    }
  }

  async function scanResumePrivacy() {
    if (!candidateEditor.resumeText.trim()) return;
    setResumeParseBusy(true);
    setErrorMessage("");
    try {
      const result = await fetchJson<{ findings: Array<{ entity_type: string; preview: string }>; redacted_text: string }>("/candidate-profile/privacy/scan", {
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
            ? "岗位截图已在本地识别；如需模型直接看图，可在附件卡片勾选“模型看图”。"
            : "岗位截图已在本地识别；当前未启用图片直传，只会使用本地 OCR 文本。"
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

  async function sendChatMessage(contentOverride: string, attachmentIds: string[] = [], visionAttachmentIds: string[] = []) {
    const content = contentOverride.trim();
    if (!content || chatBusy || !currentConversationId) return;
    const { HttpAgent } = await import("@ag-ui/client");
    const conversationId = currentConversationId;
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
        status: "done" | "failed" | "cancelled";
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
          forwardedProps: { conversationId, client: "bosscopilot-web", attachmentIds, visionAttachmentIds }
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
      setRetryChatDraft({ content, attachmentIds, visionAttachmentIds });
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

  async function saveProfile() {
    const name = profileDraft.name.trim();
    const targetRole = profileDraft.targetRole.trim();
    const targetCity = profileDraft.targetCity.trim();
    if (!name || !targetRole || !targetCity) {
      setErrorMessage("请填写称呼、目标岗位和目标城市");
      return;
    }
    setProfileBusy(true);
    setErrorMessage("");
    try {
      await fetchJson("/candidate-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          resume_text: candidateEditor.resumeText,
          resume_filename: candidateEditor.resumeFilename,
          resume_redacted_text: candidateEditor.resumeRedactedText,
          privacy_mode: candidateEditor.privacyMode,
          skills: splitList(profileDraft.skills),
          projects: [],
          target_roles: [targetRole],
          target_cities: [targetCity],
          salary_min: profileDraft.salaryMin ? Number(profileDraft.salaryMin) * 1000 : null,
          salary_max: null,
          preferred_industries: [],
          blocked_keywords: [],
          blocked_companies: []
        })
      });
      await Promise.all([refreshData(), refreshCandidateProfile()]);
      setProfileOpen(false);
      setProfileDraft(emptyProfile);
      setNoticeMessage("求职画像已保存。下一步可以粘贴岗位内容或上传自己保存的截图。 ");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "求职画像保存失败");
    } finally {
      setProfileBusy(false);
    }
  }

  function openBoss() {
    setErrorMessage("");
    const bossWindow = window.open(bossHomeUrl, "_blank");
    if (!bossWindow) {
      setErrorMessage("浏览器阻止了新窗口，请允许本站打开弹窗，或手动访问 BOSS 官网");
      return;
    }
    bossWindow.opener = null;
    setNoticeMessage("已打开 BOSS 官网。请由你本人浏览和操作，需要分析时可将岗位文字或截图带回 BossCopilot。 ");
  }

  async function extractJobScreenshot(file?: File) {
    if (!file) return;
    setJobScreenshotBusy(true);
    setErrorMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await fetchJson<{ text: string }>("/jobs/screenshot/extract", {
        method: "POST",
        body
      });
      setJobImport((current) => ({ ...current, description: result.text, inputMethod: "screenshot" }));
      setNoticeMessage("已在本地提取截图文字，请检查并补全岗位标题和公司。 ");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "截图文字识别失败");
    } finally {
      setJobScreenshotBusy(false);
    }
  }

  async function saveManualJob() {
    if (!jobImport.title.trim() || !jobImport.company.trim() || !jobImport.description.trim()) {
      setErrorMessage("请填写岗位标题、公司和岗位内容");
      return;
    }
    setJobImportBusy(true);
    setErrorMessage("");
    try {
      const result = await fetchJson<{ job: Job }>("/jobs/manual-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: true,
          input_method: jobImport.inputMethod,
          source_url: jobImport.sourceUrl.trim(),
          title: jobImport.title.trim(),
          company: jobImport.company.trim(),
          location: jobImport.location.trim(),
          salary_text: jobImport.salaryText.trim(),
          experience: jobImport.experience.trim(),
          education: jobImport.education.trim(),
          description: jobImport.description.trim(),
          conversation_id: currentConversationId
        })
      });
      setJobImportOpen(false);
      setJobImport(emptyJobImport);
      setSelectedJobId(result.job.id);
      await refreshData(false);
      setNoticeMessage(`已将「${result.job.title}」保存到本地岗位库。`);
      if (latestAgent?.error?.code === "manual_job_import_required") {
        setActiveView("chat");
        await sendChatMessage(`我已手动导入本地岗位 ID ${result.job.id}，请读取并继续分析`);
      } else {
        setActiveView("jobs");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "岗位导入失败");
    } finally {
      setJobImportBusy(false);
    }
  }

  function handleNextStep() {
    if (nextStep.kind === "profile") {
      setProfileOpen(true);
    } else if (nextStep.kind === "import") {
      setJobImportOpen(true);
    } else {
      setActiveView(nextStep.kind);
    }
  }

  function handleSuggestedAction() {
    if (!waitingForUser) {
      handleNextStep();
      return;
    }
    if (latestAgent?.error?.code === "manual_job_import_required") {
      setJobImportOpen(true);
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

  async function runJobAction(action: "analyze" | "gap" | "shortlist" | "greeting") {
    if (!selectedJob || !currentConversationId) return;
    await fetchJson(`/conversations/${currentConversationId}/jobs/${selectedJob.id}`, { method: "POST" });
    setActiveView("chat");
    const prompts = {
      analyze: `读取并分析岗位「${selectedJob.title} - ${selectedJob.company}」，告诉我匹配理由和风险`,
      gap: `对比我的简历与岗位「${selectedJob.title} - ${selectedJob.company}」，调用简历岗位差距分析，列出已匹配技能、缺口和简历中的真实证据`,
      shortlist: `把岗位「${selectedJob.title} - ${selectedJob.company}」加入我的候选清单`,
      greeting: `为岗位「${selectedJob.title} - ${selectedJob.company}」准备一条真实、简洁的沟通话术并保存为草稿`
    };
    await sendChatMessage(prompts[action]);
  }

  async function deleteSelectedJob() {
    if (!selectedJob) return;
    const confirmed = window.confirm(
      `确定删除“${selectedJob.title} · ${selectedJob.company}”吗？\n\n关联的匹配分析、话术草稿和本地投递记录也会一起删除。`
    );
    if (!confirmed) return;
    setJobCleanupBusy(true);
    setErrorMessage("");
    try {
      await fetchJson(`/jobs/${selectedJob.id}`, { method: "DELETE" });
      setSelectedJobId(null);
      await refreshData();
      setNoticeMessage("岗位及其关联记录已删除。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除岗位失败");
    } finally {
      setJobCleanupBusy(false);
    }
  }

  async function clearAllJobs() {
    if (!jobs.length) return;
    const confirmed = window.confirm(
      `确定清空全部 ${jobs.length} 个岗位吗？\n\n所有关联的匹配分析、话术草稿和本地投递记录也会删除，此操作无法撤销。`
    );
    if (!confirmed) return;
    setJobCleanupBusy(true);
    setErrorMessage("");
    try {
      const result = await fetchJson<{ deleted_count: number }>("/jobs", { method: "DELETE" });
      setSelectedJobId(null);
      await refreshData();
      setNoticeMessage(`已清理 ${result.deleted_count} 个岗位及其关联记录。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "清理岗位失败");
    } finally {
      setJobCleanupBusy(false);
    }
  }

  useEffect(() => {
    async function initialize() {
      const next = await refreshConversations();
      const initialId = next.find((item) => item.status === "active")?.id ?? next[0]?.id ?? null;
      setCurrentConversationId(initialId);
      await Promise.all([refreshCapabilities(), refreshAttachmentConfig(), refreshAgentSettings(), refreshCandidateProfile(), refreshData(false, initialId)]);
    }
    initialize().catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "系统连接失败");
    });
  }, []);

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

  useEffect(() => () => chatAgentRef.current?.abortRun(), []);

  useEffect(() => {
    if (chatMessages.length > 0 || chatBusy) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [chatMessages, chatBusy]);

  return (
    <main className="app-shell">
      <AppSidebar
        collapsed={sidebarCollapsed}
        activeView={activeView}
        conversations={conversations}
        currentConversationId={currentConversationId}
        conversationBusy={conversationBusy}
        jobCount={jobs.length}
        applicationCount={applications.length}
        capabilities={capabilities}
        attachmentConfig={attachmentConfig}
        onToggle={toggleSidebar}
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
        <header className="topbar">
          <div>
            <span className="page-eyebrow">{activeView === "chat" ? "Workspace" : "BossCopilot"}</span>
            <h1>{activeView === "chat" && currentConversation ? currentConversation.title : pageMeta[activeView].title}</h1>
            <p>{pageMeta[activeView].description}</p>
          </div>
          <div className="topbar-actions">
            {activeView !== "chat" ? (
              <button className="icon-button" onClick={() => void refreshData(true)} disabled={refreshBusy} title="刷新数据">
                <RefreshCw className={refreshBusy ? "spinning" : ""} size={18} />
              </button>
            ) : null}
          </div>
        </header>

        {errorMessage ? (
          <div className="feedback-banner error-banner"><TriangleAlert size={16} /><span>{errorMessage}</span><button onClick={() => setErrorMessage("")} aria-label="关闭错误提示"><X size={15} /></button></div>
        ) : null}
        {noticeMessage ? (
          <div className="feedback-banner notice-banner"><CheckCircle2 size={16} /><span>{noticeMessage}</span><button onClick={() => setNoticeMessage("")} aria-label="关闭成功提示"><X size={15} /></button></div>
        ) : null}

        {profileOpen ? (
          <section className="profile-setup" aria-label="设置求职画像">
            <div className="profile-setup-copy">
              <span className="setup-icon"><UserRound size={20} /></span>
              <div><span className="card-kicker">1 分钟设置</span><h2>告诉 Agent 你在找什么</h2><p>先填写最必要的信息，简历和详细偏好可以之后继续补充。</p></div>
            </div>
            <div className="profile-form">
              <label><span>怎么称呼你</span><input value={profileDraft.name} placeholder="例如：小林" onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} /></label>
              <label><span>目标岗位</span><input value={profileDraft.targetRole} placeholder="AI Agent 工程师" onChange={(event) => setProfileDraft({ ...profileDraft, targetRole: event.target.value })} /></label>
              <label><span>目标城市</span><input value={profileDraft.targetCity} placeholder="上海" onChange={(event) => setProfileDraft({ ...profileDraft, targetCity: event.target.value })} /></label>
              <label><span>核心技能</span><input value={profileDraft.skills} placeholder="Python, FastAPI, Agent" onChange={(event) => setProfileDraft({ ...profileDraft, skills: event.target.value })} /></label>
              <label><span>期望月薪下限</span><div className="input-suffix"><input type="number" min="0" value={profileDraft.salaryMin} placeholder="25" onChange={(event) => setProfileDraft({ ...profileDraft, salaryMin: event.target.value })} /><em>K</em></div></label>
            </div>
            <div className="profile-actions"><button className="text-button" onClick={() => setProfileOpen(false)}>稍后设置</button><button className="primary-button" onClick={() => void saveProfile()} disabled={profileBusy}>{profileBusy ? <LoaderCircle className="spinning" size={16} /> : <CheckCircle2 size={16} />} 保存并继续</button></div>
          </section>
        ) : null}

        {jobImportOpen ? (
          <section className="job-import-panel" aria-label="手动导入岗位">
            <div className="job-import-heading">
              <div><span className="card-kicker">用户主动提供</span><h2>导入一个岗位</h2><p>粘贴岗位内容，或上传你自己保存的截图。BossCopilot不会访问招聘网站。</p></div>
              <button className="icon-button" onClick={() => setJobImportOpen(false)} aria-label="关闭岗位导入"><X size={17} /></button>
            </div>
            <div className="job-import-source">
              <label className={`job-screenshot-upload ${jobScreenshotBusy ? "busy" : ""}`}>
                {jobScreenshotBusy ? <LoaderCircle className="spinning" size={20} /> : <Upload size={20} />}
                <span><strong>{jobScreenshotBusy ? "正在本地识别…" : "上传岗位截图"}</strong><small>PNG、JPG、WEBP，最大 10MB；识别后仍需你确认</small></span>
                <input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" disabled={jobScreenshotBusy} onChange={(event) => { void extractJobScreenshot(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
              <span>或者直接粘贴岗位文字</span>
            </div>
            <div className="job-import-grid">
              <label><span>岗位标题 *</span><input value={jobImport.title} placeholder="例如：AI Agent 工程师" onChange={(event) => setJobImport({ ...jobImport, title: event.target.value })} /></label>
              <label><span>公司 *</span><input value={jobImport.company} placeholder="公司名称" onChange={(event) => setJobImport({ ...jobImport, company: event.target.value })} /></label>
              <label><span>岗位链接（可选）</span><input value={jobImport.sourceUrl} placeholder="由你手动复制的来源链接" onChange={(event) => setJobImport({ ...jobImport, sourceUrl: event.target.value })} /></label>
              <label><span>地点</span><input value={jobImport.location} placeholder="上海 浦东新区" onChange={(event) => setJobImport({ ...jobImport, location: event.target.value })} /></label>
              <label><span>薪资</span><input value={jobImport.salaryText} placeholder="25-40K" onChange={(event) => setJobImport({ ...jobImport, salaryText: event.target.value })} /></label>
              <label><span>经验 / 学历</span><div className="job-import-inline"><input value={jobImport.experience} placeholder="3-5年" onChange={(event) => setJobImport({ ...jobImport, experience: event.target.value })} /><input value={jobImport.education} placeholder="本科" onChange={(event) => setJobImport({ ...jobImport, education: event.target.value })} /></div></label>
              <label className="job-import-description"><span>岗位内容 *</span><textarea value={jobImport.description} placeholder="在这里粘贴岗位职责、任职要求等内容。请先移除不希望保存的个人信息。" onChange={(event) => setJobImport({ ...jobImport, description: event.target.value, inputMethod: "paste" })} /></label>
            </div>
            <div className="job-import-actions">
              <span><ShieldCheck size={14} /> 内容只在你确认后保存到本地</span>
              <div><button className="text-button" onClick={() => setJobImportOpen(false)}>取消</button><button className="primary-button" onClick={() => void saveManualJob()} disabled={jobImportBusy || jobScreenshotBusy}>{jobImportBusy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}确认导入</button></div>
            </div>
          </section>
        ) : null}

        {activeView === "chat" ? (
          <ChatWorkspace
            messages={visibleChatMessages}
            hiddenMessageCount={hiddenMessageCount}
            chatBusy={chatBusy}
            currentConversationId={currentConversationId}
            waitingForUser={waitingForUser}
            latestAgent={latestAgent}
            taskCancelBusy={taskCancelBusy}
            retryDraft={retryChatDraft}
            nextStep={nextStep}
            chatEndRef={chatEndRef}
            chatInputRef={chatInputRef}
            onLoadMore={() => setVisibleMessageCount((count) => count + 12)}
            onNextStep={handleNextStep}
            onOpenBoss={() => void openBoss()}
            onImportJob={() => { setActiveView("jobs"); setJobImportOpen(true); }}
            attachmentBusy={chatAttachmentBusy}
            attachmentConfig={attachmentConfig}
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
        ) : null}

        {activeView === "profile" ? (
          <section className="profile-workspace">
            <div className="profile-editor-card">
              <div className="profile-card-heading">
                <span className="profile-card-icon"><UserRound size={19} /></span>
                <div><h2>人物画像</h2><p>这些信息会用于岗位匹配和沟通准备。</p></div>
              </div>
              <div className="candidate-form">
                <label><span>称呼</span><input value={candidateEditor.name} placeholder="例如：小林" onChange={(event) => setCandidateEditor({ ...candidateEditor, name: event.target.value })} /></label>
                <label><span>目标岗位</span><input value={candidateEditor.targetRole} placeholder="AI Agent 工程师" onChange={(event) => setCandidateEditor({ ...candidateEditor, targetRole: event.target.value })} /></label>
                <label><span>目标城市</span><input value={candidateEditor.targetCity} placeholder="上海，杭州" onChange={(event) => setCandidateEditor({ ...candidateEditor, targetCity: event.target.value })} /></label>
                <label className="wide-field"><span>核心技能</span><input value={candidateEditor.skills} placeholder="Python，FastAPI，LLM，Agent" onChange={(event) => setCandidateEditor({ ...candidateEditor, skills: event.target.value })} /></label>
                <label><span>最低月薪（K）</span><input type="number" min="0" value={candidateEditor.salaryMin} placeholder="25" onChange={(event) => setCandidateEditor({ ...candidateEditor, salaryMin: event.target.value })} /></label>
                <label><span>最高月薪（K）</span><input type="number" min="0" value={candidateEditor.salaryMax} placeholder="40" onChange={(event) => setCandidateEditor({ ...candidateEditor, salaryMax: event.target.value })} /></label>
                <label className="wide-field"><span>偏好行业</span><input value={candidateEditor.industries} placeholder="人工智能，企业服务" onChange={(event) => setCandidateEditor({ ...candidateEditor, industries: event.target.value })} /></label>
                <label className="wide-field"><span>屏蔽关键词</span><input value={candidateEditor.blockedKeywords} placeholder="外包，纯销售" onChange={(event) => setCandidateEditor({ ...candidateEditor, blockedKeywords: event.target.value })} /></label>
                <label className="wide-field"><span>不考虑的公司</span><input value={candidateEditor.blockedCompanies} placeholder="使用逗号分隔" onChange={(event) => setCandidateEditor({ ...candidateEditor, blockedCompanies: event.target.value })} /></label>
              </div>
            </div>

            <div className="resume-editor-card">
              <div className="profile-card-heading">
                <span className="profile-card-icon"><FileText size={19} /></span>
                <div><h2>简历</h2><p>文件只在本机解析，保存前可以检查和修改。</p></div>
              </div>
              <label className={`resume-upload ${resumeParseBusy ? "busy" : ""}`}>
                {resumeParseBusy ? <LoaderCircle className="spinning" size={23} /> : <Upload size={23} />}
                <strong>{resumeParseBusy ? "正在本地解析…" : candidateEditor.resumeFilename || "上传简历"}</strong>
                <span>支持 PDF、DOCX、TXT，最大 8MB</span>
                <input type="file" accept=".pdf,.docx,.txt,.md" disabled={resumeParseBusy} onChange={(event) => { void parseResumeFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
              <div className="resume-options">
                <label><input type="checkbox" checked={enhancedResumeParse} onChange={(event) => setEnhancedResumeParse(event.target.checked)} /><span>增强解析</span><small>适合复杂排版或扫描版，首次可能较慢</small></label>
                <button onClick={() => void scanResumePrivacy()} disabled={resumeParseBusy || !candidateEditor.resumeText}><ShieldCheck size={14} />隐私检查</button>
              </div>
              <div className="resume-preview-heading">
                <span>文本预览</span>
                <small>{candidateEditor.resumeText.length.toLocaleString()} 字符</small>
              </div>
              <textarea className="resume-preview" value={candidateEditor.resumeText} placeholder="上传简历或直接粘贴简历文本。内容只会在点击保存后进入人物画像。" onChange={(event) => { setCandidateEditor({ ...candidateEditor, resumeText: event.target.value, resumeRedactedText: "" }); setPrivacyFindings([]); }} />
              {privacyFindings.length ? (
                <div className="privacy-result">
                  <ShieldCheck size={16} /><div><strong>检测到 {privacyFindings.length} 处敏感信息</strong><span>{privacyFindings.slice(0, 3).map((item) => item.preview).join("、")}；默认向 Agent 提供脱敏版本。</span></div>
                </div>
              ) : null}
              <label className="agent-privacy-choice"><input type="checkbox" checked={candidateEditor.privacyMode === "original"} onChange={(event) => setCandidateEditor({ ...candidateEditor, privacyMode: event.target.checked ? "original" : "redacted" })} /><span>允许 Agent 使用简历原文</span><small>关闭时，手机号、邮箱和身份证号不会进入模型上下文</small></label>
              {candidateEditor.resumeText ? <button className="clear-resume-button" onClick={() => { setCandidateEditor({ ...candidateEditor, resumeText: "", resumeFilename: "", resumeRedactedText: "" }); setPrivacyFindings([]); }}><Trash2 size={13} />清除简历内容</button> : null}
            </div>

            <div className="profile-save-bar">
              <span><ShieldCheck size={15} /> 资料保存在本地，不会自动发送给招聘平台</span>
              <button className="primary-button" onClick={() => void saveCandidateProfile()} disabled={candidateProfileBusy || resumeParseBusy}>
                {candidateProfileBusy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}
                {candidateProfileBusy ? "保存中…" : "保存资料"}
              </button>
            </div>
          </section>
        ) : null}

        {activeView === "jobs" ? (
          jobs.length === 0 ? (
            <div className="large-empty">
              <span><Search size={30} /></span><h2>还没有真实岗位</h2>
              <p>粘贴岗位文字或上传你自己保存的截图，确认后进入本地岗位库。</p>
              <button className="primary-button" onClick={() => setJobImportOpen(true)}><Plus size={17} /> 手动导入岗位</button>
            </div>
          ) : (
            <section className="job-workspace">
              <div className="job-list-panel">
                <div className="section-heading"><div><span>机会列表</span><strong>{jobs.length} 个真实岗位</strong></div><div className="job-list-actions"><button className="secondary-button" onClick={() => setJobImportOpen(true)}><Plus size={13} />导入岗位</button><button className="cleanup-button" onClick={() => void clearAllJobs()} disabled={jobCleanupBusy}><Trash2 size={13} />清空岗位</button></div></div>
                <div className="job-list">
                  {jobs.map((job) => (
                    <button className={`job-card ${selectedJob?.id === job.id ? "active" : ""}`} key={job.id} onClick={() => setSelectedJobId(job.id)}>
                      <div className="job-card-top"><strong>{job.title}</strong><em>{job.salary_text || "薪资面议"}</em></div>
                      <span><Building2 size={14} />{job.company}</span>
                      <div className="job-tags">
                        {job.city ? <small><MapPin size={12} />{job.city}{job.district}</small> : null}
                        {job.experience ? <small>{job.experience}</small> : null}
                        {job.education ? <small>{job.education}</small> : null}
                        {!job.description ? <small>摘要</small> : null}
                        {job.status === "shortlisted" ? <small className="shortlisted"><Bookmark size={11} />候选</small> : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {selectedJob ? (
                <article className="job-detail">
                  <div className="job-detail-header">
                    <div><span>{selectedJob.source === "manual" ? "用户主动导入" : selectedJob.source?.toUpperCase() || "本地岗位"} · 可追溯来源</span><h2>{selectedJob.title}</h2><p>{selectedJob.company}</p></div>
                    <strong>{selectedJob.salary_text || "薪资面议"}</strong>
                  </div>
                  <div className="detail-meta">
                    {selectedJob.city ? <span><MapPin size={15} />{selectedJob.city}{selectedJob.district}</span> : null}
                    {selectedJob.experience ? <span><BriefcaseBusiness size={15} />{selectedJob.experience}</span> : null}
                    {selectedJob.education ? <span><GraduationCap size={15} />{selectedJob.education}</span> : null}
                  </div>
                  <section>
                    <h3>岗位描述</h3>
                    {selectedJob.description ? (
                      <p className="job-description">{selectedJob.description}</p>
                    ) : (
                      <div className="job-description-empty">
                        <p>当前记录缺少岗位描述。你可以重新手动导入完整岗位文字或截图。</p>
                        {selectedJob.source_url?.startsWith("http") ? <a href={selectedJob.source_url} target="_blank" rel="noreferrer">打开岗位详情<ExternalLink size={13} /></a> : null}
                      </div>
                    )}
                  </section>
                  <section className="job-assistant-actions">
                    <div><span className="card-kicker">让 Agent 继续</span><h3>从查看到决定，只需一步</h3></div>
                    <div>
                      <button className="secondary-button" onClick={() => runJobAction("analyze")}><WandSparkles size={15} /> 深度分析</button>
                      <button className="secondary-button" onClick={() => runJobAction("gap")}><BarChart3 size={15} /> 简历差距</button>
                      <button className="secondary-button" onClick={() => runJobAction("shortlist")}><Bookmark size={15} /> 加入候选</button>
                      <button className="secondary-button" onClick={() => runJobAction("greeting")}><MessageCircle size={15} /> 准备话术</button>
                    </div>
                  </section>
                  <div className="detail-actions">
                    <span><ShieldCheck size={14} /> 打开原岗位后，由你决定是否发起沟通</span>
                    <div>
                      <button className="delete-job-button" onClick={() => void deleteSelectedJob()} disabled={jobCleanupBusy}><Trash2 size={14} />删除岗位</button>
                      {selectedJob.source_url?.startsWith("http") ? <a className="primary-button" href={selectedJob.source_url} target="_blank" rel="noreferrer">打开来源页 <ExternalLink size={15} /></a> : null}
                    </div>
                  </div>
                </article>
              ) : null}
            </section>
          )
        ) : null}

        {activeView === "tools" ? <ToolsView capabilities={capabilities} attachmentConfig={attachmentConfig} recentToolEvents={recentToolEvents} /> : null}

        {activeView === "agent" ? (
          <section className="agent-settings-page">
            <div className="agent-settings-intro">
              <div><span className="card-kicker">行为与记忆</span><h2>决定 Agent 如何理解你</h2><p>人设影响表达方式；长期记忆决定可以读取哪些本地资料；当前上下文决定每次对话携带多少历史信息。</p></div>
              <span className="settings-local-badge"><Database size={14} />设置保存在本地</span>
            </div>

            <div className="agent-settings-grid">
              <section className="settings-card persona-settings">
                <div className="settings-card-heading"><span><Bot size={18} /></span><div><h3>人设</h3><p>安全边界保持锁定，只调整角色和表达。</p></div></div>
                <label><span>Agent 名称</span><input value={agentSettings.display_name} maxLength={40} onChange={(event) => setAgentSettings({ ...agentSettings, display_name: event.target.value })} /></label>
                <label><span>角色定位</span><textarea value={agentSettings.persona_role} maxLength={300} onChange={(event) => setAgentSettings({ ...agentSettings, persona_role: event.target.value })} /></label>
                <label><span>回答详细程度</span><select value={agentSettings.response_style} onChange={(event) => setAgentSettings({ ...agentSettings, response_style: event.target.value as AgentSettings["response_style"] })}><option value="concise">简洁直接</option><option value="balanced">平衡清晰</option><option value="detailed">详细分析</option></select></label>
                <label><span>补充偏好</span><textarea value={agentSettings.custom_instructions} maxLength={1000} placeholder="例如：优先指出风险；不要使用夸张表达；给建议时附上依据。" onChange={(event) => setAgentSettings({ ...agentSettings, custom_instructions: event.target.value })} /></label>
              </section>

              <section className="settings-card memory-settings">
                <div className="settings-card-heading"><span><Database size={18} /></span><div><h3>长期记忆</h3><p>控制 Agent 可以读取的本地持久资料。</p></div></div>
                <label className="settings-switch"><div><strong>人物画像记忆</strong><small>简历、技能、项目和求职偏好</small></div><input type="checkbox" checked={agentSettings.profile_memory_enabled} onChange={(event) => setAgentSettings({ ...agentSettings, profile_memory_enabled: event.target.checked })} /></label>
                <label className="settings-switch"><div><strong>本地知识记忆</strong><small>脱敏简历、岗位描述和本地资料片段</small></div><input type="checkbox" checked={agentSettings.knowledge_memory_enabled} onChange={(event) => setAgentSettings({ ...agentSettings, knowledge_memory_enabled: event.target.checked })} /></label>
                <label className="settings-switch"><div><strong>对话记忆</strong><small>让 Agent 读取当前对话最近的消息</small></div><input type="checkbox" checked={agentSettings.conversation_memory_enabled} onChange={(event) => setAgentSettings({ ...agentSettings, conversation_memory_enabled: event.target.checked })} /></label>
                <label className={`settings-switch ${!agentSettings.conversation_memory_enabled ? "disabled" : ""}`}><div><strong>早期内容摘要</strong><small>长对话中保留较早任务的本地摘要</small></div><input type="checkbox" disabled={!agentSettings.conversation_memory_enabled} checked={agentSettings.summary_enabled} onChange={(event) => setAgentSettings({ ...agentSettings, summary_enabled: event.target.checked })} /></label>
              </section>

              <section className="settings-card context-settings">
                <div className="settings-card-heading"><span><MessageCircle size={18} /></span><div><h3>当前上下文</h3><p>只影响模型下一次收到的对话历史，不删除界面消息。</p></div></div>
                <div className="context-window-control">
                  <div><strong>最近消息数量</strong><span>{agentSettings.context_message_limit} 条</span></div>
                  <input type="range" min="4" max="30" step="2" disabled={!agentSettings.conversation_memory_enabled} value={agentSettings.context_message_limit} onChange={(event) => setAgentSettings({ ...agentSettings, context_message_limit: Number(event.target.value) })} />
                  <small>数量越大，连续性越好，但模型输入和成本也会增加。</small>
                </div>
                <div className="context-status">
                  <span>当前对话</span><strong>{currentConversation?.title || "尚未选择"}</strong>
                  <small>界面中共 {currentConversation?.message_count ?? chatMessages.length} 条消息 · Agent 最多读取最近 {agentSettings.context_message_limit} 条</small>
                </div>
                <button className="context-reset-button" disabled={!currentConversationId || agentSettingsBusy} onClick={() => void resetCurrentContext()}><RefreshCw size={14} />从当前位置开始新上下文</button>
              </section>

              <section className="settings-card safety-settings">
                <div className="settings-card-heading"><span><ShieldCheck size={18} /></span><div><h3>固定安全边界</h3><p>以下规则不能由人设或记忆设置覆盖。</p></div></div>
                <ul><li>不自动搜索、刷新或批量抓取 BOSS</li><li>不自动发送消息、简历或执行投递</li><li>岗位事实必须来自已确认导入的本地数据</li><li>外部操作始终需要用户确认</li></ul>
              </section>
            </div>

            <div className="agent-settings-save"><span>设置从下一条 Agent 消息开始生效</span><button className="primary-button" disabled={agentSettingsBusy || !agentSettings.display_name.trim() || !agentSettings.persona_role.trim()} onClick={() => void saveAgentPreferences()}>{agentSettingsBusy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}{agentSettingsBusy ? "保存中…" : "保存 Agent 设置"}</button></div>
          </section>
        ) : null}

        {activeView === "applications" ? <ApplicationsView applications={applications} onOpenJobs={() => setActiveView("jobs")} /> : null}

        {activeView === "review" ? <ReviewView jobs={jobs} queuedCount={queuedCount} appliedCount={appliedCount} completedNodes={completedNodes} workflow={workflow} /> : null}
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
