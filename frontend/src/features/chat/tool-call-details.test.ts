import { describe, expect, it } from "vitest";
import { eventDuration, formatExecutionTime, toolCallDetails, type RunEvent } from "./tool-call-details";

const event = (tool: string, data: Record<string, unknown> = {}): RunEvent => ({
  round: 1, tool_call_id: "call-1", tool_name: tool, status: "done", message: "已完成", data
});

describe("tool call display projection", () => {
  it("explains citation failures using bounded diagnostics without rendering repair payloads", () => {
    const failed = { ...event("citation_validator", { validation_reason: "回答缺少来源链接", original_draft_preserved: true,
      repair_error_code: "invalid_format", raw_response: "private-raw-model-output" }), status: "failed", message: "引用修正未返回符合约定的 JSON 补丁" };
    expect(toolCallDetails(failed, false)).toEqual([
      { label: "检查", text: "回答缺少来源链接" },
      { label: "原因", text: "自动补引用返回格式不正确。" },
      { label: "处理", text: "原始草稿已保留，来源引用尚未核验。" }
    ]);
    expect(toolCallDetails(event("citation_validator"), false)).toEqual([
      { text: "引用链接已匹配本轮搜索来源；不代表逐条事实已核验。" }
    ]);
  });

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

  it("distinguishes evidence sources from chunks and an empty result", () => {
    expect(toolCallDetails(event("search_library", {
      source_count: 1, evidence_status: "found",
      excerpts: [{ title: "讨论记录" }, { title: "讨论记录" }], facts: []
    }), false)).toEqual([{ text: "找到 1 份资料的 2 个相关片段、0 条已确认知识：讨论记录" }]);
    expect(toolCallDetails(event("search_library", {
      source_count: 0, evidence_status: "empty", excerpts: [], facts: []
    }), false)).toEqual([{ text: "本次未检索到相关证据。" }]);
    expect(toolCallDetails(event("agent_planner", { plan: {
      expected_output: "有来源的行情摘要", steps: [{ title: "检索招聘报告和公开讨论" }]
    } }), false)).toEqual([{ label: "交付目标", text: "有来源的行情摘要" }, { text: "检索招聘报告和公开讨论" }]);
  });
});
