import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSubscriber } from "@ag-ui/client";
import type { createApiClient } from "../../api/client";
import type { ChatMessage } from "./types";
import { useChatRun } from "./useChatRun";

const client = vi.hoisted(() => ({ runAgent: vi.fn(), abortRun: vi.fn() }));
vi.mock("@ag-ui/client", () => ({
  HttpAgent: class {
    runAgent = client.runAgent;
    abortRun = client.abortRun;
  }
}));

function setup() {
  let finish!: () => void;
  client.runAgent.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const currentConversationIdRef = { current: 1 as number | null };
  const setErrorMessage = vi.fn();
  const setNoticeMessage = vi.fn();
  const hook = renderHook(() => useChatRun({
    apiBase: "/test-api", accessToken: "test-only-session",
    fetchJson: vi.fn() as ReturnType<typeof createApiClient>,
    currentConversationId: 1, currentConversationIdRef,
    setErrorMessage, setNoticeMessage,
    refreshConversations: vi.fn().mockResolvedValue([]),
    onLibraryChanged: vi.fn().mockResolvedValue(undefined)
  }));
  return { ...hook, currentConversationIdRef, setErrorMessage, setNoticeMessage, finish: () => finish() };
}

function emit(name: keyof AgentSubscriber, value: Record<string, unknown>) {
  const subscriber = client.runAgent.mock.calls[0][1] as AgentSubscriber;
  const callback = subscriber[name] as (value: Record<string, unknown>) => void;
  callback(value);
}

const userMessage: ChatMessage = { id: 11, role: "user", content: "测试问题", created_at: "2026-10-10T00:00:00Z" };
const assistantMessage: ChatMessage = { id: 12, role: "assistant", content: "测试回答", created_at: "2026-10-10T00:00:01Z" };
const snapshot = { careerLoop: { status: "done", userMessage, assistantMessage } };

beforeEach(() => { client.runAgent.mockReset(); client.abortRun.mockReset(); });
afterEach(cleanup);

describe("useChatRun stream reconciliation", () => {
  it("creates one assistant placeholder immediately and uses server timing before any token", async () => {
    const { result, finish } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.sendChatMessage(userMessage.content); });
    await waitFor(() => expect(client.runAgent).toHaveBeenCalledOnce());
    expect(result.current.chatMessages.map((message) => message.role)).toEqual(["user", "assistant"]);
    const placeholder = result.current.chatMessages[1];
    expect(placeholder.content).toBe("");
    expect(placeholder.payload?.agent?.started_at).toBeUndefined();
    expect(placeholder.payload?.agent?.duration_ms).toBeUndefined();
    const runId = client.runAgent.mock.calls[0][0].runId as string;
    const startedAt = "2026-10-11T00:00:00.125+00:00";
    const timedAnswer: ChatMessage = { ...assistantMessage, payload: { agent: {
      provider: "test", platform: "local", rounds: 1, status: "done", events: [],
      started_at: startedAt, completed_at: "2026-10-11T00:06:29.125+00:00", duration_ms: 389000,
    } } };
    act(() => {
      emit("onCustomEvent", { event: { name: "careerloop.user_message", value: userMessage } });
      emit("onCustomEvent", { event: { name: "careerloop.run_timing", value: { run_id: runId, started_at: startedAt } } });
      emit("onCustomEvent", { event: { name: "careerloop.user_message", value: userMessage } });
    });
    expect(result.current.chatMessages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.current.chatMessages[1].id).toBe(placeholder.id);
    expect(result.current.chatMessages[1].payload?.agent?.started_at).toBe(startedAt);
    act(() => {
      emit("onStateSnapshotEvent", { event: { snapshot: { careerLoop: { status: "done", userMessage, assistantMessage: timedAnswer } } } });
      emit("onCustomEvent", { event: { name: "careerloop.run_timing", value: { run_id: runId, started_at: "2026-10-11T01:00:00Z" } } });
    });
    expect(result.current.chatMessages).toEqual([userMessage, timedAnswer]);
    expect(result.current.chatMessages[1].payload?.agent?.duration_ms).toBe(389000);
    await act(async () => { finish(); await pending; });
  });

  it("ignores malformed or unrelated timing metadata without inventing a duration", async () => {
    const { result, finish } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.sendChatMessage(userMessage.content); });
    await waitFor(() => expect(client.runAgent).toHaveBeenCalledOnce());
    const runId = client.runAgent.mock.calls[0][0].runId as string;
    act(() => {
      emit("onCustomEvent", { event: { name: "careerloop.run_timing", value: { run_id: "other-run", started_at: "2026-10-11T00:00:00Z" } } });
      emit("onCustomEvent", { event: { name: "careerloop.run_timing", value: { run_id: runId, started_at: "invalid" } } });
    });
    expect(result.current.chatMessages[1].payload?.agent?.started_at).toBeUndefined();
    expect(result.current.chatMessages[1].payload?.agent?.duration_ms).toBeUndefined();
    await act(async () => { emit("onStateSnapshotEvent", { event: { snapshot } }); finish(); await pending; });
  });

  it("keeps the first appearance order when later completion events update earlier activities", async () => {
    const { result, finish } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.sendChatMessage(userMessage.content); });
    await waitFor(() => expect(client.runAgent).toHaveBeenCalledOnce());
    act(() => {
      for (const event of [
        { tool_call_id: "first", tool_name: "read_library", status: "running", message: "读取资料" },
        { tool_call_id: "second", tool_name: "search_public_web", status: "running", message: "搜索网页" },
        { tool_call_id: "first", tool_name: "read_library", status: "done", message: "资料已读取" },
      ]) emit("onCustomEvent", { event: { name: "careerloop.agent_event", value: { ...event, round: 1 } } });
    });
    const events = result.current.chatMessages[1].payload?.agent?.events;
    expect(events?.map((event) => event.tool_call_id)).toEqual(["first", "second"]);
    expect(events?.[0]).toMatchObject({ status: "done", message: "资料已读取" });
    await act(async () => { emit("onStateSnapshotEvent", { event: { snapshot } }); finish(); await pending; });
  });

  it("merges standard reasoning and the matching CareerLoop event into one activity", async () => {
    const { result, finish } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.sendChatMessage(userMessage.content); });
    await waitFor(() => expect(client.runAgent).toHaveBeenCalledOnce());
    act(() => {
      emit("onReasoningMessageStartEvent", { event: { messageId: "reasoning:think-1" } });
      emit("onReasoningMessageContentEvent", { event: { messageId: "reasoning:think-1", delta: "检查资料" }, reasoningMessageBuffer: "" });
      emit("onReasoningMessageEndEvent", { event: { messageId: "reasoning:think-1" }, reasoningMessageBuffer: "检查资料" });
      emit("onCustomEvent", { event: { name: "careerloop.agent_event", value: {
        round: 1, tool_call_id: "think-1", tool_name: "agent_thinking", status: "done", message: "检查资料", data: { route: "library_qa" }
      } } });
    });
    const events = result.current.chatMessages.find((message) => message.role === "assistant")?.payload?.agent?.events;
    expect(events).toEqual([expect.objectContaining({ tool_call_id: "think-1", message: "检查资料", round: 1, data: { route: "library_qa" } })]);
    await act(async () => { emit("onStateSnapshotEvent", { event: { snapshot } }); finish(); await pending; });
  });

  it("keeps one final answer when snapshots repeat and late stream events arrive", async () => {
    const { result, finish } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.sendChatMessage(userMessage.content); });
    await waitFor(() => expect(client.runAgent).toHaveBeenCalledOnce());
    act(() => {
      emit("onCustomEvent", { event: { name: "careerloop.user_message", value: userMessage } });
      emit("onTextMessageStartEvent", { event: { messageId: "answer-1" } });
      emit("onTextMessageContentEvent", { event: { messageId: "answer-1", delta: assistantMessage.content } });
      emit("onStateSnapshotEvent", { event: { snapshot } });
      emit("onStateSnapshotEvent", { event: { snapshot } });
      emit("onTextMessageContentEvent", { event: { messageId: "answer-1", delta: assistantMessage.content } });
      emit("onReasoningMessageStartEvent", { event: { messageId: "reasoning:late" } });
      emit("onCustomEvent", { event: { name: "careerloop.user_message", value: userMessage } });
    });
    expect(result.current.chatMessages).toEqual([userMessage, assistantMessage]);
    await act(async () => { finish(); await pending; });
  });

  it("ignores events from a conversation that the user has left", async () => {
    const { result, currentConversationIdRef, finish } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.sendChatMessage(userMessage.content); });
    await waitFor(() => expect(client.runAgent).toHaveBeenCalledOnce());
    act(() => { currentConversationIdRef.current = 2; result.current.setChatMessages([]); });
    act(() => {
      emit("onTextMessageContentEvent", { event: { messageId: "answer-1", delta: assistantMessage.content } });
      emit("onReasoningMessageStartEvent", { event: { messageId: "reasoning:stale" } });
      emit("onStateSnapshotEvent", { event: { snapshot } });
    });
    expect(result.current.chatMessages).toEqual([]);
    await act(async () => { finish(); await pending; });
  });

  it("reports a failed send through the retained-draft prompt without a duplicate global error", async () => {
    const { result, setErrorMessage } = setup();
    client.runAgent.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));
    await act(() => result.current.sendChatMessage(userMessage.content));
    expect(result.current.modelUnavailable).toBe("HTTP 500: Internal Server Error");
    expect(result.current.retryChatDraft?.content).toBe(userMessage.content);
    expect(setErrorMessage.mock.calls.filter(([message]) => message)).toEqual([]);
  });

  it("keeps cancellation in the persisted answer without a duplicate global notice", async () => {
    const { result, setNoticeMessage } = setup();
    const cancelledMessage: ChatMessage = { ...assistantMessage, payload: { agent: {
      provider: "test", platform: "local", rounds: 1, status: "cancelled", events: [],
      started_at: "2026-10-11T00:00:00.000+00:00", duration_ms: 1500,
    } } };
    client.runAgent.mockImplementationOnce(async () => {
      emit("onStateSnapshotEvent", { event: { snapshot: { careerLoop: {
        status: "cancelled", userMessage, assistantMessage: cancelledMessage,
      } } } });
    });
    await act(() => result.current.sendChatMessage(userMessage.content));
    expect(result.current.chatMessages).toEqual([userMessage, cancelledMessage]);
    expect(result.current.chatMessages[1].payload?.agent?.status).toBe("cancelled");
    expect(setNoticeMessage.mock.calls.filter(([message]) => message)).toEqual([]);
  });

  it("keeps the persisted failed turn and its retry target when the SDK also reports an error", async () => {
    const { result, setErrorMessage } = setup();
    const failedMessage: ChatMessage = { ...assistantMessage, payload: { agent: {
      provider: "test", platform: "local", rounds: 1, status: "failed", events: [],
      error: { code: "model_service_error", message: "服务暂时不可用", retryable: true }
    } } };
    client.runAgent.mockImplementationOnce(async () => {
      emit("onStateSnapshotEvent", { event: { snapshot: { careerLoop: { status: "failed", userMessage, assistantMessage: failedMessage } } } });
      emit("onRunErrorEvent", { event: { message: "服务暂时不可用" } });
      throw new Error("服务暂时不可用");
    });
    await act(() => result.current.sendChatMessage(userMessage.content));
    expect(result.current.chatMessages).toEqual([userMessage, failedMessage]);
    expect(result.current.retryChatDraft).toMatchObject({ content: userMessage.content, rewindMessageId: userMessage.id });
    expect(result.current.retryChatDraft?.runId).toBeUndefined();
    expect(setErrorMessage.mock.calls.filter(([message]) => message)).toEqual([]);
  });
});
