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

  it("shows the current activity in the header and its expandable record", () => {
    const agent = run({ events: [event("search", "正在检索公开资料", { tool_name: "search_public_web", status: "running" })] });
    render(<RunProcess streaming agent={agent} />);
    expect(screen.getAllByText("正在检索公开资料")).toHaveLength(2);
  });

  it("shows the specific tool task in the current execution header", () => {
    const agent = run({ events: [event("search", "正在检索：Python 异步任务", { tool_name: "search_public_web", status: "running" })] });
    render(<RunProcess streaming agent={agent} />);
    expect(screen.getAllByText("正在检索：Python 异步任务")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "收起思考与执行过程" })).toHaveTextContent("Python 异步任务");
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
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("用时 389s");
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
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("用时 61.5s");
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("用时 61.5s");
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


describe("execution record interaction", () => {
  it("does not show a routine follow hint on initial expansion or reopening", () => {
    const view = render(<RunProcess streaming agent={run({ events: [event("read", "已读取资料", { tool_name: "get_library_context" })] })} />);
    expect(screen.getByRole("region", { name: "执行记录，可滚动查看" })).toBeVisible();
    expect(view.container.querySelector(".run-process-followbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "收起思考与执行过程" }));
    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
    expect(view.container.querySelector(".run-process-followbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开已读取资料的执行说明" }));
    expect(screen.getByText("已暂停跟随")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "回到最新" }));
    expect(view.container.querySelector(".run-process-followbar")).toBeNull();
  });

  it("preserves history position, counts only new calls and resumes following on request", () => {
    const a = event("a", "已读取资料", { tool_name: "get_library_context", data: { sources: [] } });
    const view = render(<RunProcess streaming agent={run({ events: [a] })} />);
    const records = screen.getByRole("region", { name: "执行记录，可滚动查看" });
    let height = 600;
    Object.defineProperties(records, { scrollHeight: { get: () => height }, clientHeight: { value: 200 } });
    const b = event("b", "正在检索 A", { tool_name: "search_public_web", status: "running", data: { arguments: { query: "A" } } });
    view.rerender(<RunProcess streaming agent={run({ events: [a, b] })} />);
    expect(records.scrollTop).toBe(600);
    records.scrollTop = 90;
    fireEvent.scroll(records);
    expect(screen.getByText("已暂停跟随")).toBeVisible();
    const c = event("c", "已核对引用", { tool_name: "citation_validator" });
    height = 800;
    view.rerender(<RunProcess streaming agent={run({ events: [a, b, c] })} />);
    expect(records.scrollTop).toBe(90);
    expect(screen.getByText("有 1 条新记录")).toBeVisible();
    view.rerender(<RunProcess streaming agent={run({ events: [a, { ...b, status: "done" }, c] })} />);
    expect(screen.getByText("有 1 条新记录")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "回到最新（1）" }));
    expect(records.scrollTop).toBe(800);
    expect(screen.queryByRole("button", { name: /回到最新/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开已读取资料的执行说明" }));
    height = 900;
    const d = event("d", "正在生成回答", { tool_name: "model_provider", status: "running" });
    view.rerender(<RunProcess streaming agent={run({ events: [a, b, c, d] })} />);
    expect(records.scrollTop).toBe(800);
    expect(screen.getByRole("button", { name: "收起已读取资料的执行说明" })).toHaveAttribute("aria-expanded", "true");
    records.scrollTop = 700;
    fireEvent.scroll(records);
    expect(screen.queryByText("已暂停跟随")).not.toBeInTheDocument();
    expect(screen.queryByText("跟随最新 · 可向上滚动查看")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起思考与执行过程" }));
    view.rerender(<RunProcess streaming agent={run({ events: [a, b, c, { ...d, message: "正在生成最终回答" }] })} />);
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("正在生成最终回答");
    expect(records).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
    expect(records.scrollTop).toBe(900);
  });

  it("opens only the selected call and updates its result without exposing raw payloads", () => {
    const a = event("a", "正在检索甲", { tool_name: "search_public_web", status: "running", data: { arguments: { query: "甲", api_key: "secret-key" }, debug: "private-debug" } });
    const b = event("b", "已检索乙", { tool_name: "search_public_web", data: { query: "乙", sources: [{ title: "乙来源", url: "https://example.com/b", content: "private-body" }] } });
    const view = render(<RunProcess streaming agent={run({ events: [a, b] })} />);
    fireEvent.click(screen.getByRole("button", { name: "展开正在检索甲的执行说明" }));
    expect(screen.getByText("检索：甲")).toBeVisible();
    expect(screen.getByText("正在等待返回结果。")).toBeVisible();
    expect(screen.queryByText("检索：乙")).not.toBeInTheDocument();
    const done = { ...a, status: "done", message: "已检索甲", data: { sources: [{ title: "甲来源", url: "https://example.com/a" }] } };
    view.rerender(<RunProcess streaming agent={run({ events: [a, done, b] })} />);
    expect(screen.getByRole("button", { name: "收起已检索甲的执行说明" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("检索：甲")).toBeVisible();
    expect(screen.getByText("找到 1 条公开来源：甲来源")).toBeVisible();
    expect(view.container.textContent).not.toMatch(/secret-key|private-debug|private-body|https:\/\/example|api_key/);
    expect(screen.queryByText("详情")).not.toBeInTheDocument();
  });

  it("ticks from the real node start, freezes recorded seconds and removes shimmer at completion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T00:00:00.800Z"));
    const a = event("a", "正在读取资料", { tool_name: "get_library_context", status: "running", started_at: "2026-10-15T00:00:00Z" });
    const view = render(<RunProcess streaming agent={run({ events: [a] })} />);
    expect(screen.getByText("已用 0.8s")).toBeVisible();
    expect(view.container.querySelectorAll(".is-current-execution")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("已用 2.8s")).toBeVisible();
    view.rerender(<RunProcess streaming={false} agent={run({ duration_ms: 2800, events: [{ ...a, status: "done", message: "已读取资料", duration_ms: 2800 }] })} />);
    expect(view.container.querySelector(".is-current-execution")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
    expect(screen.getByText("2.8s")).toBeVisible();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("2.8s")).toBeVisible();
  });

  it("keeps failed tools inspectable when the answer already contains their error", () => {
    const error = "检索服务连接超时";
    render(<RunProcess streaming={false} content={error} agent={run({ status: "failed", error: { code: "timeout", message: error, retryable: true }, events: [event("a", error, { tool_name: "search_public_web", status: "failed", duration_ms: 4200 })] })} />);
    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
    expect(screen.getByText("4.2s")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "展开检索公开资料失败的执行说明" }));
    expect(screen.getByText(`原因：${error}`)).toBeVisible();
  });

  it("shows the selected call's failure reason and missing history without borrowing the run error", () => {
    const a = event("a", "搜索连接超时", { tool_name: "search_public_web", status: "failed" });
    const b = event("b", "已读取资料", { tool_name: "get_library_context" });
    render(<RunProcess streaming agent={run({ error: { code: "other", message: "另一处错误", retryable: false }, events: [a, b] })} />);
    fireEvent.click(screen.getByRole("button", { name: "展开搜索连接超时的执行说明" }));
    expect(screen.getByText("原因：搜索连接超时")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "展开已读取资料的执行说明" }));
    expect(screen.getByText("这次调用未保留更多说明。")).toBeVisible();
    expect(screen.getAllByText("未记录")).toHaveLength(2);
    expect(screen.queryByText("另一处错误")).not.toBeInTheDocument();
  });
});
