import { useEffect, useRef, useState } from "react";
import type { AgentSubscriber, HttpAgent as HttpAgentType } from "@ag-ui/client";
import { createApiClient, fetchWithTimeout } from "../../api/client";
import { createClientId } from "../../api/clientId";
import { interruptedRunRetryDraft, type DurableAgentRunSummary } from "../../durable-agent-run";
import type { AgentRunResult, ChatAttachment, ChatMessage, ChatRetryDraft, WebSearchMode } from "../../features/chat/types";
import type { RefObject } from "react";

type Options = { apiBase: string; accessToken: string; fetchJson: ReturnType<typeof createApiClient>; currentConversationId: number | null; currentConversationIdRef: RefObject<number | null>; modelProfileId?: string | null; setErrorMessage: (message: string) => void; setNoticeMessage: (message: string) => void; refreshConversations: () => Promise<unknown>; onLibraryChanged: () => Promise<void> };

export function useChatRun({ apiBase, accessToken, fetchJson, currentConversationId, currentConversationIdRef, modelProfileId, setErrorMessage, setNoticeMessage, refreshConversations, onLibraryChanged }: Options) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [chatBusy, setChatBusy] = useState(false);

  const [modelUnavailable, setModelUnavailable] = useState<string | null>(null);

  const [retryChatDraft, setRetryChatDraft] = useState<ChatRetryDraft | null>(null);

  const chatAgentRef = useRef<HttpAgentType | null>(null);

  const [taskCancelBusy, setTaskCancelBusy] = useState(false);

  const [chatAttachmentBusy, setChatAttachmentBusy] = useState(false);

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

  async function uploadChatAttachment(file: File): Promise<ChatAttachment> {
    if (!currentConversationId) throw new Error("请先选择一个对话");
    const filename = file.name.toLowerCase();
    const kind = /\.(png|jpe?g|webp)$/.test(filename) ? "image" : /\.(pdf|docx|txt|md)$/.test(filename) ? "document" : null;
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
      setNoticeMessage(kind === "document" ? "文档已添加" : "图片已添加");
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
    modelProfileIdOverride?: string | null,
  ) {
    const content = contentOverride.trim();
    const targetConversationId = conversationIdOverride ?? currentConversationId;
    const selectedModelProfileId = modelProfileIdOverride === undefined ? modelProfileId ?? null : modelProfileIdOverride;
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
      careerLoop: {
        status: "done" | "failed" | "cancelled" | "waiting_user";
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
      };
    }) => {
      terminalReceived = true;
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
      if (assistantMessage.payload?.agent?.events.some((event) =>
        event.tool_name === "propose_library_knowledge" && event.status === "done"
      )) {
        void onLibraryChanged().catch((error: unknown) => {
          setErrorMessage(error instanceof Error ? error.message : "资料库刷新失败");
        });
      }
      const agentError = assistantMessage.payload?.agent?.error;
      if (agentError?.code && /model|provider|authentication|service|rate_limit|timeout/.test(agentError.code)) {
        setModelUnavailable(agentError.message || "模型服务暂不可用，请到模型设置检查配置后重试。");
        setRetryChatDraft({
          content: userMessage.content,
          modelProfileId: selectedModelProfileId,
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
          forwardedProps: { conversationId, modelProfileId: selectedModelProfileId, client: "careerloop-web", attachmentIds, visionAttachmentIds, webSearch, webSearchMode }
        },
        subscriber
      );
      if (!terminalReceived) throw new Error("AG-UI 消息流意外中断，请重试");

      void Promise.all([refreshConversations()]).catch((error: unknown) => {
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
        modelProfileId: selectedModelProfileId,
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

  async function cancelCurrentTask() {
    setTaskCancelBusy(true);
    setErrorMessage("");
    try {
      await fetchJson(`/agent/tasks/current/cancel?conversation_id=${currentConversationId}`, { method: "POST" });
      await Promise.all([refreshChat(), refreshConversations()]);
      setNoticeMessage("任务已结束");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "结束当前任务失败");
    } finally {
      setTaskCancelBusy(false);
    }
  }
  useEffect(() => () => chatAgentRef.current?.abortRun(), []);
  return { chatMessages, setChatMessages, chatBusy, setChatBusy, modelUnavailable, setModelUnavailable, retryChatDraft, setRetryChatDraft, chatAgentRef, taskCancelBusy, setTaskCancelBusy, chatAttachmentBusy, setChatAttachmentBusy, refreshChat, uploadChatAttachment, removeChatAttachment, sendChatMessage, stopChatGeneration, rewindChatToUserMessage, editChatMessage, regenerateChatMessage, cancelCurrentTask };
}
