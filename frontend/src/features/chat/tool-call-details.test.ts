import { describe, expect, it } from "vitest";
import { eventDuration, formatExecutionTime, toolCallDetails, type RunEvent } from "./tool-call-details";

const event = (tool: string, data: Record<string, unknown> = {}): RunEvent => ({
  round: 1, tool_call_id: "call-1", tool_name: tool, status: "done", message: "已完成", data
});

describe("tool call display projection", () => {
  it("uses seconds consistently and prefers the final measured duration", () => {
    expect([0, 800, 1200, 61500, 389000].map(formatExecutionTime)).toEqual(["0s", "0.8s", "1.2s", "61.5s", "389s"]);
    const timed = { ...event("search_library"), started_at: "2026-10-15T00:00:00Z", completed_at: "2026-10-15T00:00:03Z", duration_ms: 2800 };
    expect(eventDuration(timed, false, 0)).toBe(2800);
    expect(eventDuration({ ...timed, duration_ms: undefined }, false, 0)).toBe(3000);
    expect(eventDuration(event("search_library"), false, Date.now())).toBeNull();
    expect(eventDuration({ ...timed, started_at: "invalid", duration_ms: -1 }, false, 0)).toBeNull();
  });

  it("summarizes library metadata without showing cached document or fact bodies", () => {
    const details = toolCallDetails(event("get_library_context", {
      sources: [{ title: "研究笔记" }], confirmed_facts: [{ statement: "private-fact" }], document: "private-document"
    }), false);
    expect(details).toEqual([{ text: "已读取 1 份资料、1 条已确认知识：研究笔记" }]);
    expect(toolCallDetails(event("get_library_context", { disabled: true }), false)).toEqual([{ text: "知识库读取已关闭。" }]);
    expect(toolCallDetails(event("get_library_context"), false)).toEqual([]);
  });

  it("keeps local search input and result titles while leaving full excerpts out", () => {
    expect(toolCallDetails(event("search_library", {
      arguments: { query: "任务恢复" }, excerpts: [{ title: "研究笔记", content: "private-excerpt" }], facts: [{ statement: "private-fact" }]
    }), false)).toEqual([{ label: "检索", text: "任务恢复" }, { text: "找到 2 条相关资料：研究笔记" }]);
    expect(toolCallDetails(event("search_public_web", { query: "未命中", sources: [], source_count: 0 }), false)).toEqual([
      { label: "检索", text: "未命中" }, { text: "找到 0 条公开来源。" }
    ]);
  });

  it("projects plan steps and pending statements without dumping internal fields", () => {
    expect(toolCallDetails(event("agent_planner", { plan: { goal: "internal", steps: [{ title: "读取资料", tool_name: "get_library_context" }, { title: "核对来源" }] } }), false))
      .toEqual([{ text: "读取资料 → 核对来源" }]);
    expect(toolCallDetails(event("propose_library_knowledge", { proposals: [{ statement: "每周整理笔记", id: "private-id" }] }), false))
      .toEqual([{ text: "每周整理笔记" }]);
  });
});
