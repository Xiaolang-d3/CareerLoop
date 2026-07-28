import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentSubscriber, HttpAgent as HttpAgentType } from "@ag-ui/client";
import { createApiClient } from "./api/client";
import { AppSidebar } from "./components/AppSidebar";
import { ChatWorkspace, type AgentRunResult, type AttachmentConfig, type ChatAttachment, type ChatMessage, type ChatRetryDraft } from "./components/ChatWorkspace";
import { DashboardView, WorkbenchView } from "./components/WorkspaceViews";
import {
  bossHomeUrl,
  defaultAgentSettings,
  emptyCandidateEditor,
  emptyProfile,
  pageMeta
} from "./constants";
import type {
  AgentCapabilities,
  AgentSettings,
  CandidateProfileBundle,
  Conversation,
  ResumeProfileSuggestion,
  ViewKey,
  WorkflowStatus
} from "./types";
import {
  Bot,
  CheckCircle2,
  Database,
  FileText,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Save,
  ShieldCheck,
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
    const savedView = window.localStorage.getItem("bosscopilot-view");
    if (savedView === "profile" || savedView === "agent") return "settings";
    if (savedView === "tools") return "dashboard";
    return savedView && ["workbench", "dashboard", "chat", "settings"].includes(savedView)
      ? savedView as ViewKey
      : "workbench";
  });
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
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [attachmentConfig, setAttachmentConfig] = useState<AttachmentConfig | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileDraft, setProfileDraft] = useState(emptyProfile);
  const [candidateEditor, setCandidateEditor] = useState(emptyCandidateEditor);
  const [candidateProfileBusy, setCandidateProfileBusy] = useState(false);
  const [resumeParseBusy, setResumeParseBusy] = useState(false);
  const [chatAttachmentBusy, setChatAttachmentBusy] = useState(false);
  const [enhancedResumeParse, setEnhancedResumeParse] = useState(false);
  const [privacyFindings, setPrivacyFindings] = useState<Array<{ entity_type: string; preview: string }>>([]);
  const [resumeProfileSuggestion, setResumeProfileSuggestion] = useState<ResumeProfileSuggestion | null>(null);
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

  const hasProfile = (workflow?.counts.profiles ?? 0) > 0;
  const workbenchProfileReady = hasProfile && Boolean(candidateEditor.resumeText.trim());
  const hiddenMessageCount = Math.max(0, chatMessages.length - visibleMessageCount);
  const visibleChatMessages = chatMessages.slice(-visibleMessageCount);
  const latestAgent = [...chatMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.payload?.agent)?.payload?.agent;
  const waitingForUser = latestAgent?.status === "waiting_user";
  const nextStep = !hasProfile
    ? { title: "先保存当前简历", detail: "上传简历截图并检查 OCR 文本，保存后即可开始分析。", action: "打开设置", kind: "settings" as const }
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
    setAgentSettings({ ...next, api_key: "" });
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
      setAgentSettings({ ...saved, api_key: "" });
      await refreshCapabilities();
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
    const bundle = await fetchJson<CandidateProfileBundle>("/candidate-profile");
    setResumeProfileSuggestion(null);
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
      setProfileExpanded(false);
      setNoticeMessage("个人资料已保存在本地，Agent 后续分析会读取这些信息。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存个人资料失败");
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
        results.push(await fetchJson<ParsedResume>("/candidate-profile/resume/parse", {
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

  async function sendChatMessage(
    contentOverride: string,
    attachmentIds: string[] = [],
    visionAttachmentIds: string[] = [],
    webSearch = false,
  ) {
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

  function handleNextStep() {
    if (nextStep.kind === "settings") {
      setActiveView("settings");
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
        capabilities={capabilities}
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
            <h1>{activeView === "chat" && currentConversation ? currentConversation.title : pageMeta[activeView].title}</h1>
          </div>
          <div className="topbar-actions">
            {activeView !== "chat" ? (
              <button className="icon-button" onClick={() => void refreshData(true)} disabled={refreshBusy} title="刷新数据" aria-label="刷新当前页面数据">
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
              <div><h2>告诉 Agent 你在找什么</h2></div>
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

        {activeView === "dashboard" ? (
          <DashboardView
            workflow={workflow}
            conversations={conversations}
            onOpenConversation={(conversationId) => {
              setCurrentConversationId(conversationId);
              setActiveView("chat");
            }}
          />
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
        ) : null}

        {activeView === "workbench" ? (
          <section className="profile-workspace" id="candidate-profile-section">
            <header className="flow-step-heading profile-flow-heading">
              <span className="flow-step-number">1</span>
              <div>
                <h2>完善人物资料</h2>
                <p>填写基本求职信息并上传简历，后续结果会以此为依据。</p>
              </div>
              <div className="flow-step-actions">
                <span className={`flow-step-status ${workbenchProfileReady ? "complete" : ""}`}>
                  {workbenchProfileReady ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
                  {workbenchProfileReady ? "已完成" : "待完成"}
                </span>
                {workbenchProfileReady ? (
                  <button className="profile-edit-toggle" onClick={() => setProfileExpanded((value) => !value)}>
                    {profileExpanded ? "收起" : "编辑"}
                  </button>
                ) : null}
              </div>
            </header>
            {!workbenchProfileReady || profileExpanded ? (
              <>
            <div className="profile-editor-card">
              <div className="profile-card-heading">
                <span className="profile-card-icon"><UserRound size={19} /></span>
                <div><h2>人物画像</h2><p>这些信息会用于岗位匹配和沟通准备。</p></div>
              </div>
              <div className="candidate-form">
                <label><span>称呼 <em className="required-mark">必填</em></span><input required value={candidateEditor.name} placeholder="例如：小林" onChange={(event) => setCandidateEditor({ ...candidateEditor, name: event.target.value })} /></label>
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

            <div className="resume-upload-card">
              <div className="profile-card-heading">
                <span className="profile-card-icon"><Upload size={19} /></span>
                <div><h2>上传简历 <em className="required-mark">岗位功能必填</em></h2><p>选择文件并在本机解析。</p></div>
              </div>
              <label className={`resume-upload ${resumeParseBusy ? "busy" : ""}`}>
                {resumeParseBusy ? <LoaderCircle className="spinning" size={23} /> : <Upload size={23} />}
                <strong>{resumeParseBusy ? "正在本地解析…" : candidateEditor.resumeFilename || "上传简历截图"}</strong>
                <span>支持多张 PNG、JPG、WEBP 截图，也兼容 PDF、DOCX、TXT</span>
                <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md" disabled={resumeParseBusy} onChange={(event) => { void parseResumeFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
              </label>
              <div className="resume-options">
                <label><input type="checkbox" checked={enhancedResumeParse} onChange={(event) => setEnhancedResumeParse(event.target.checked)} /><span>增强解析</span><small>适合复杂排版或扫描版，首次可能较慢</small></label>
                <button onClick={() => void scanResumePrivacy()} disabled={resumeParseBusy || !candidateEditor.resumeText}><ShieldCheck size={14} />隐私检查</button>
              </div>
              {privacyFindings.length ? (
                <div className="privacy-result">
                  <ShieldCheck size={16} /><div><strong>检测到 {privacyFindings.length} 处敏感信息</strong><span>{privacyFindings.slice(0, 3).map((item) => item.preview).join("、")}；默认向 Agent 提供脱敏版本。</span></div>
                </div>
              ) : null}
            </div>

            <div className="resume-editor-card resume-text-card">
              <div className="profile-card-heading">
                <span className="profile-card-icon"><FileText size={19} /></span>
                <div><h2>编辑简历内容</h2><p>检查解析结果，也可以直接粘贴或修改文本。</p></div>
              </div>
              <div className="resume-preview-heading">
                <span>简历文本</span>
                <small>{candidateEditor.resumeText.length.toLocaleString()} 字符</small>
              </div>
              <textarea className="resume-preview" value={candidateEditor.resumeText} placeholder="上传简历或直接粘贴简历文本。内容只会在点击保存后进入人物画像。" onChange={(event) => { setCandidateEditor({ ...candidateEditor, resumeText: event.target.value, resumeRedactedText: "" }); setPrivacyFindings([]); setResumeProfileSuggestion(null); }} />
              {resumeProfileSuggestion && (resumeProfileSuggestion.name || resumeProfileSuggestion.target_roles.length || resumeProfileSuggestion.target_cities.length || resumeProfileSuggestion.skills.length) ? (
                <div className="profile-fill-suggestion">
                  <WandSparkles size={17} />
                  <div>
                    <strong>识别到可填充的画像内容</strong>
                    <span>{[
                      resumeProfileSuggestion.name ? `称呼：${resumeProfileSuggestion.name}` : "",
                      resumeProfileSuggestion.target_roles.length ? `目标岗位：${resumeProfileSuggestion.target_roles.join("、")}` : "",
                      resumeProfileSuggestion.target_cities.length ? `目标城市：${resumeProfileSuggestion.target_cities.join("、")}` : "",
                      resumeProfileSuggestion.skills.length ? `技能：${resumeProfileSuggestion.skills.join("、")}` : ""
                    ].filter(Boolean).join("；")}</span>
                    <small>只补充空字段，并合并新技能，不会覆盖已填写内容。</small>
                  </div>
                  <button type="button" onClick={fillProfileFromResume}>一键填充</button>
                </div>
              ) : null}
              <label className="agent-privacy-choice"><input type="checkbox" checked={candidateEditor.privacyMode === "original"} onChange={(event) => setCandidateEditor({ ...candidateEditor, privacyMode: event.target.checked ? "original" : "redacted" })} /><span>允许 Agent 使用简历原文</span><small>关闭时，手机号、邮箱和身份证号不会进入模型上下文</small></label>
              {candidateEditor.resumeText ? <button className="clear-resume-button" onClick={() => { setCandidateEditor({ ...candidateEditor, resumeText: "", resumeFilename: "", resumeRedactedText: "" }); setPrivacyFindings([]); setResumeProfileSuggestion(null); }}><Trash2 size={13} />清除简历内容</button> : null}
            </div>

            <div className="profile-save-bar">
              <span>
                {(!candidateEditor.name.trim() || !candidateEditor.resumeText.trim()) ? <TriangleAlert size={15} /> : <ShieldCheck size={15} />}
                {!candidateEditor.name.trim()
                  ? "请先填写称呼"
                  : !candidateEditor.resumeText.trim()
                    ? "请上传简历或粘贴简历文本"
                    : "资料保存在本地，不会自动发送给招聘平台"}
              </span>
              <button className="primary-button" onClick={() => void saveCandidateProfile()} disabled={candidateProfileBusy || resumeParseBusy || !candidateEditor.name.trim() || !candidateEditor.resumeText.trim()}>
                {candidateProfileBusy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}
                {candidateProfileBusy ? "保存中…" : "保存资料"}
              </button>
            </div>
              </>
            ) : null}
          </section>
        ) : null}

        {activeView === "workbench" ? (
          <WorkbenchView
            hasProfile={workbenchProfileReady}
            chatBusy={chatBusy}
            webResearchEnabled={Boolean(capabilities?.web_research?.enabled)}
            onRunTask={(content) => {
              setActiveView("chat");
              void sendChatMessage(content);
            }}
          />
        ) : null}

        {activeView === "settings" ? (
          <section className="model-settings-page">
            <section className="settings-card model-settings-card persona-settings">
              <div className="settings-card-heading">
                <span><Bot size={18} /></span>
                <div><h3>模型连接</h3><p>使用 OpenAI Chat Completions 兼容接口。</p></div>
              </div>
              <label>
                <span>模型名称</span>
                <input list="model-options" value={agentSettings.model_name} placeholder="输入或选择模型" onChange={(event) => setAgentSettings({ ...agentSettings, model_name: event.target.value })} />
                <datalist id="model-options">
                  <option value="gpt-5.5" />
                  <option value="gpt-5.4" />
                  <option value="gpt-4.1" />
                </datalist>
              </label>
              <label>
                <span>Base URL</span>
                <input value={agentSettings.model_base_url} placeholder="https://api.openai.com/v1" onChange={(event) => setAgentSettings({ ...agentSettings, model_base_url: event.target.value })} />
                <small>留空使用 OpenAI 默认地址；也可填写兼容服务地址。</small>
              </label>
              <label>
                <span>API Key</span>
                <input type="password" autoComplete="new-password" value={agentSettings.api_key} placeholder={agentSettings.api_key_configured ? "已配置，留空则继续使用" : "请输入 API Key"} onChange={(event) => setAgentSettings({ ...agentSettings, api_key: event.target.value })} />
                <small>{agentSettings.api_key_configured ? "当前已有可用密钥，系统不会显示原文。" : "密钥仅保存在本机后端。"}</small>
              </label>
              <button className="primary-button model-save-button" disabled={agentSettingsBusy || !agentSettings.model_name.trim()} onClick={() => void saveAgentPreferences()}>
                {agentSettingsBusy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}
                {agentSettingsBusy ? "保存中…" : "保存模型设置"}
              </button>
            </section>
          </section>
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
