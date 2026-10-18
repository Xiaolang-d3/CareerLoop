import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeCurationCard } from "./HomeCurationCard";
import type { HomeCuration } from "./types";

const now = new Date("2026-10-18T08:00:00Z");
function curation(patch: Partial<HomeCuration> = {}): HomeCuration {
  return {
    status: "ready", window_hours: 72, date: "2026-10-18", generated_at: "2026-10-18T07:00:00Z", model_name: "text-model", error: "", warnings: [],
    items: [{ id: "one", title: "确定性资讯", summary: "官方更新摘要", why_it_matters: "减少迁移时的兼容风险", url: "https://example.test/release", source: "官方博客", published_at: "2026-10-17T09:00:00Z", event_date: "2026-10-17", confidence: "high", evidence: "发布说明列出兼容性变更" }],
    ...patch
  };
}
function setup(value = curation()) {
  const props = { curation: value, loading: false, now, onRegenerate: vi.fn(), onOpenInterest: vi.fn() };
  return { ...props, ...render(<HomeCurationCard {...props} />) };
}
afterEach(cleanup);

describe("HomeCurationCard", () => {
  it.each([
    ["no_recent_candidates", "本次未找到时间范围内可核实的候选资讯"],
    ["editorial_filter", "本次候选未达到推荐标准"],
    ["validation_filter", "本次候选未通过日期、去重或依据检查"]
  ])("explains an empty %s edition with actual counts", (empty_reason, message) => {
    setup(curation({ status: "empty", items: [], empty_reason, diagnostics: { raw_candidates: 8, recent_candidates: 4, verified_candidates: 3, proposed_items: 0, selected_items: 0 } }));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText("已核实 3 条候选 · 入选 0 条")).toBeInTheDocument();
    expect(screen.getByText("近3天")).toBeInTheDocument();
  });
  it.each(["generating", "stale", "error"] as const)("preserves previous dated items while %s", (status) => {
    setup(curation({ status, date: "2026-10-17", error: status === "error" ? "模型连接失败" : "", warnings: ["部分来源无法核对"] }));
    expect(screen.getByRole("link", { name: "确定性资讯" })).toBeInTheDocument();
    expect(screen.getByText("上次精选：2026-10-17（非今日结果）")).toBeInTheDocument();
    expect(screen.getByText("部分来源无法核对")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新筛选" }).hasAttribute("disabled")).toBe(status === "generating");
    if (status === "generating") expect(screen.getByRole("status")).toHaveTextContent("正在筛选今日资讯，保留上次内容供阅读");
    if (status === "error") expect(screen.getByRole("alert")).toHaveTextContent("模型连接失败");
  });

  it("shows an initial skeleton without hiding previous items during loading", () => {
    const props = { loading: true, now, onRegenerate: vi.fn(), onOpenInterest: vi.fn() };
    const view = render(<HomeCurationCard {...props} />);
    expect(screen.getByRole("status", { name: "资讯精选加载中" })).toBeInTheDocument();
    view.rerender(<HomeCurationCard {...props} curation={curation()} />);
    expect(screen.getByRole("link", { name: "确定性资讯" })).toBeInTheDocument();
  });

  it("never turns unsafe model URLs into links", () => {
    const value = curation();
    value.items[0].url = "javascript:alert(1)";
    setup(value);
    expect(screen.getByRole("heading", { name: "确定性资讯" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it.each([
    ["disabled", "还没有启用每日资讯精选"],
    ["unconfigured", "请选择资讯精选使用的文本模型"],
    ["empty", "本次筛选未选出推荐内容"],
    ["error", "搜索服务不可用"]
  ] as const)("explains %s honestly without automatically regenerating", (status, message) => {
    const page = setup(curation({ status, items: [], error: status === "error" ? message : "" }));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(page.onRegenerate).not.toHaveBeenCalled();
    if (status === "disabled" || status === "unconfigured") {
      expect(screen.queryByRole("button", { name: "重新筛选" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "兴趣设置" }));
      expect(page.onOpenInterest).toHaveBeenCalledOnce();
      expect(page.onRegenerate).not.toHaveBeenCalled();
    } else {
      expect(Boolean(screen.queryByRole("alert"))).toBe(status === "error");
      fireEvent.click(screen.getByRole("button", { name: "重新筛选" }));
      expect(page.onRegenerate).toHaveBeenCalledOnce();
      expect(screen.getByText(/重新筛选会产生新的搜索和模型请求/)).toBeInTheDocument();
    }
  });
  it("renders why, source, exact publication/event dates and inspectable evidence with safe original links", () => {
    setup();
    expect(screen.getByRole("region", { name: /今日值得看/ })).toBeInTheDocument();
    expect(screen.getByText("减少迁移时的兼容风险")).toBeInTheDocument();
    expect(screen.getByText("官方博客")).toBeInTheDocument();
    expect(screen.getByText("由 text-model 筛选")).toBeInTheDocument();
    expect(screen.getByText("2026-10-18T07:00:00Z")).toHaveAttribute("datetime", "2026-10-18T07:00:00Z");
    expect(screen.getByText("2026-10-17T09:00:00Z")).toHaveAttribute("datetime", "2026-10-17T09:00:00Z");
    expect(screen.getByText("2026-10-17", { exact: true })).toHaveAttribute("datetime", "2026-10-17");
    expect(screen.getByRole("link", { name: "确定性资讯" })).toHaveAttribute("href", "https://example.test/release");
    expect(screen.getByRole("link", { name: "确定性资讯" })).toHaveAttribute("rel", "noreferrer");
    fireEvent.click(screen.getByText("可信度与依据"));
    expect(screen.getByText(/可信度：高/)).toBeVisible();
    expect(screen.getByText("发布说明列出兼容性变更")).toBeVisible();
  });
});
