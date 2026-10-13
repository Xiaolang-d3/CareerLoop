import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunProcess } from "./MessagePresentation";
import type { AgentRunResult } from "./types";

type RunEvent = AgentRunResult["events"][number];

function event(toolCallId: string, message: string, options: Partial<RunEvent> = {}): RunEvent {
  return { round: 1, tool_call_id: toolCallId, tool_name: "agent_thinking", status: "done", message, ...options };
}

function run(options: Partial<AgentRunResult> = {}): AgentRunResult {
  return { provider: "test", platform: "local", rounds: 1, status: "done", events: [], ...options };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RunProcess", () => {
  it("shows one expanded process while waiting for the model", () => {
    render(<RunProcess streaming />);
    const process = screen.getByRole("region", { name: "思考与执行过程" });
    const toggle = within(process).getByRole("button", { name: "收起思考与执行过程" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(process).getByRole("status")).toHaveTextContent("正在整理要点");
    expect(within(process).getByText("等待模型响应…")).toBeVisible();
    expect(toggle).not.toHaveTextContent("已用时");
  });

  it("does not repeat the current activity in the expanded body", () => {
    const agent = run({ events: [event("search", "正在检索公开资料", { tool_name: "search_public_web", status: "running" })] });
    render(<RunProcess streaming agent={agent} />);
    expect(screen.getAllByText("正在检索公开资料")).toHaveLength(1);
  });

  it("keeps the activity heading separate from one specific tool task", () => {
    const agent = run({ events: [event("search", "正在检索：Python 异步任务", { tool_name: "search_public_web", status: "running" })] });
    render(<RunProcess streaming agent={agent} />);
    expect(screen.getAllByText("正在检索公开资料")).toHaveLength(1);
    expect(screen.getAllByText("正在检索：Python 异步任务")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "收起思考与执行过程" })).not.toHaveTextContent("Python 异步任务");
  });

  it("preserves chronological process paragraphs and tool summaries without clipping them", () => {
    const longThought = `先核对资料的来源。${"补充说明。".repeat(40)}\n再比较各来源的结论。`;
    const agent = run({ events: [
      event("route", "已识别为资料研究，需要先规划并限制可用工具"),
      event("thought-1", longThought),
      event("read", "已读取项目资料", { tool_name: "get_library_context" }),
      event("thought-2", "已确认来源，继续整理答案。")
    ] });
    const view = render(<RunProcess streaming agent={agent} />);
    const paragraphs = view.container.querySelectorAll(".run-process-thought");
    const tool = screen.getByText("已读取项目资料");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe(longThought);
    expect(paragraphs[0].compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tool.compareDocumentPosition(paragraphs[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/已识别为/)).not.toBeInTheDocument();
  });

  it("updates a repeated call in its original position and preserves distinct calls with the same text", () => {
    const agent = run({ events: [
      event("search-1", "正在搜索资料", { tool_name: "search_public_web", status: "running" }),
      event("thought", "现在核对来源的可信度。"),
      event("search-1", "已读取公开资料", { tool_name: "search_public_web", status: "done" }),
      event("read-1", "已读取项目资料", { tool_name: "get_library_context" }),
      event("read-2", "已读取项目资料", { tool_name: "get_library_context" })
    ] });
    render(<RunProcess agent={agent} streaming={false} />);
    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
    const completed = screen.getByText("已读取公开资料");
    const thought = screen.getByText("现在核对来源的可信度。");
    expect(screen.queryByText("正在搜索资料")).not.toBeInTheDocument();
    expect(completed.compareDocumentPosition(thought) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("已读取项目资料")).toHaveLength(2);
  });

  it("keeps the user's collapsed choice while live events update", () => {
    const agent = run({ events: [event("thought", "先核对资料。", { status: "running" })] });
    const view = render(<RunProcess agent={agent} streaming />);
    fireEvent.click(screen.getByRole("button", { name: "收起思考与执行过程" }));
    view.rerender(<RunProcess agent={{ ...agent, events: [event("thought", "先核对资料，再整理结论。", { status: "running" })] }} streaming />);
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("先核对资料，再整理结论。")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
    expect(screen.getByText("先核对资料，再整理结论。")).toBeVisible();
  });

  it("collapses when the run ends, freezes its duration and keeps its process available", () => {
    const agent = run({ events: [event("thought", "先核对资料。", { status: "running" })] });
    const view = render(<RunProcess agent={agent} streaming />);
    view.rerender(<RunProcess agent={{ ...agent, duration_ms: 389_000 }} streaming={false} />);
    const process = screen.getByRole("region", { name: "思考与执行过程" });
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("用时 6m 29s");
    expect(screen.getByText("先核对资料。")).not.toBeVisible();
    expect(process.querySelector(".spinning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
    expect(screen.getByText("先核对资料。")).toBeVisible();
  });

  it.each([
    ["failed", "生成失败"],
    ["cancelled", "已停止"],
    ["waiting_user", "等待确认"]
  ] as const)("shows %s as a single terminal outcome without a spinner", (status, label) => {
    const agent = run({ status, duration_ms: 8_000, events: [event("search", "正在检索资料", { tool_name: "search_library", status: "running" })] });
    const view = render(<RunProcess agent={agent} streaming={false} />);
    const toggle = screen.getByRole("button", { name: "展开思考与执行过程" });
    expect(toggle).toHaveTextContent("用时 8s");
    expect(within(toggle).getAllByText(label)).toHaveLength(1);
    expect(view.container.querySelector(".spinning")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("检索资料")).toBeVisible();
  });

  it("does not report a completed answer as failed because one tool failed", () => {
    const agent = run({ duration_ms: 12_000, events: [event("search", "本次检索没有结果，已改用已有资料。", { tool_name: "search_library", status: "failed" })] });
    render(<RunProcess agent={agent} streaming={false} />);
    expect(screen.queryByText("生成失败")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
    expect(screen.getByText("本次检索没有结果，已改用已有资料。")).toBeVisible();
    expect(screen.queryByText("生成失败")).not.toBeInTheDocument();
  });

  it("does not invent elapsed time for historical messages without run timing", () => {
    const agent = run({ events: [event("thought", "已核对资料来源。")] });
    render(<RunProcess agent={agent} streaming={false} />);
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("思考与执行过程");
    expect(screen.queryByText(/用时/)).not.toBeInTheDocument();
  });

  it("uses persisted duration for a historical run rather than time since opening it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T03:00:00Z"));
    render(<RunProcess agent={run({ duration_ms: 61_500 })} streaming={false} />);
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("用时 1m 1s");
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("用时 1m 1s");
  });

  it("uses the run's start time without resetting elapsed time when the activity changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T03:00:11Z"));
    const agent = run({ started_at: "2026-10-11T03:00:00Z", events: [event("search", "正在查阅公开资料", { tool_name: "search_public_web", status: "running" })] });
    const view = render(<RunProcess agent={agent} streaming />);
    expect(screen.getByText("已用时 11s")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_000));
    view.rerender(<RunProcess agent={{ ...agent, events: [event("search", "已完成查阅", { tool_name: "search_public_web" })] }} streaming content="回答正在生成" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在生成回复");
    expect(screen.getByText("已用时 15s")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText("已用时 17s")).toBeInTheDocument();
  });

  it("shows the stop request in the same process header", () => {
    const view = render(<RunProcess streaming stopping />);
    const process = screen.getByRole("region", { name: "思考与执行过程" });
    expect(within(process).getByRole("status")).toHaveTextContent("正在停止生成");
    expect(screen.getAllByText("正在停止生成")).toHaveLength(1);
    view.rerender(<RunProcess agent={run({ status: "cancelled", duration_ms: 3_000 })} streaming={false} />);
    expect(process.querySelector(".spinning")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("已停止");
  });
});
