import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpportunityDiscoveryPage } from "./OpportunityDiscoveryPage";

const run = {
  id: 7, mode: "scan", trigger: "manual", strategy_id: 2, status: "completed",
  config: {}, total_count: 1, completed_count: 1, succeeded_count: 1,
  failed_count: 0, waiting_count: 0, error_message: "", created_at: "2026-08-01",
  started_at: "2026-08-01", completed_at: "2026-08-01"
};

const job = {
  id: 9, source_id: null, canonical_url: "https://example.com/job/9",
  company_name: "示例科技", job_title: "AI 产品经理", location: "上海",
  salary_text: "30-45K", description: "一段完整的岗位说明，只应在岗位详情页展示。",
  lifecycle_status: "discovered", posting_status: "active", processing_status: "evaluated",
  assessment: { id: 3, analysis_tier: "local", score: 78, recommendation: "strong", verdict: "pass", triage_dimensions: {}, coverage: 80, confidence: "medium", matched_skills: ["Python"], evidence_gaps: [], hard_conflicts: [], soft_risks: [], reasons: ["已有证据"], status: "current", created_at: "2026-08-01" },
  updated_at: "2026-08-01"
};

function props(page: "index" | "pipeline" | "job" = "index") {
  return {
    apiBase: "http://127.0.0.1:8000",
    accessToken: "test-access-token",
    page,
    discoveredJobId: page === "job" ? 9 : undefined,
    onNavigateHome: vi.fn(), onNavigatePipeline: vi.fn(),
    onNavigateSources: vi.fn(), onNavigateRun: vi.fn(), onNavigateJob: vi.fn(),
    onJobsChanged: vi.fn(),
    onOpenPreparedJob: vi.fn()
  };
}

describe("OpportunityDiscoveryPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/opportunity-runs") ? [run]
        : url.endsWith("/discovered-jobs") ? [job]
          : url.endsWith("/opportunity-sources") ? []
            : url.endsWith("/career-profile") ? { profile: { id: 1 }, active_strategy: { id: 2, name: "AI 产品" }, facts: [], sources: [] }
              : job;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the inbox overview without browser assistant guidance", async () => {
    render(<OpportunityDiscoveryPage {...props()} />);
    await screen.findByText("值得优先查看");
    expect(screen.queryByText("浏览器助手唯一入口")).not.toBeInTheDocument();
    expect(screen.queryByText("请安装或刷新浏览器助手")).not.toBeInTheDocument();
    expect(screen.queryByText("一段完整的岗位说明，只应在岗位详情页展示。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /新建发现任务/ })).not.toBeInTheDocument();
  });

  it("sends the current login token with opportunity requests", async () => {
    render(<OpportunityDiscoveryPage {...props()} />);

    await screen.findByText("值得优先查看");

    const [, options] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer test-access-token");
  });

  it("lets the user decide a pipeline item instead of auto-promoting it", async () => {
    render(<OpportunityDiscoveryPage {...props("pipeline")} />);
    expect(await screen.findByText("示例科技 · AI 产品经理")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "值得推进" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/discovered-jobs/9",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "shortlisted" }) })
    ));
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/promote"),
      expect.anything()
    );
  });

  it("opens the prepared job after promote", async () => {
    const shortlisted = { ...job, lifecycle_status: "shortlisted" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/promote")
        ? { id: 42, latest_evaluation_id: null }
        : url.includes("/assessments") ? [shortlisted.assessment]
          : url.endsWith("/career-profile") ? { profile: { id: 1 }, active_strategy: { id: 2, name: "AI 产品" }, facts: [], sources: [] }
            : url.endsWith("/discovered-jobs") ? [shortlisted]
              : url.includes("/opportunity-runs") ? [run]
                : url.endsWith("/opportunity-sources") ? []
                  : shortlisted;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const value = props("job");
    render(<OpportunityDiscoveryPage {...value} />);
    fireEvent.click(await screen.findByRole("button", { name: /开始求职准备/ }));

    await waitFor(() => expect(value.onJobsChanged).toHaveBeenCalled());
    expect(value.onOpenPreparedJob).toHaveBeenCalledWith(42);
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
    expect(await screen.findByText("已保存到分析")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开分析" }));
    expect(value.onOpenPreparedJob).toHaveBeenCalledTimes(2);
  });

  it("lets a saved job return home when this session has no prepared id", async () => {
    const saved = { ...job, lifecycle_status: "saved" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/assessments") ? [saved.assessment]
        : url.endsWith("/career-profile") ? { profile: { id: 1 }, active_strategy: { id: 2, name: "AI 产品" }, facts: [], sources: [] }
          : url.endsWith("/discovered-jobs") ? [saved]
            : url.includes("/opportunity-runs") ? [run]
              : url.endsWith("/opportunity-sources") ? []
                : saved;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const value = props("job");
    render(<OpportunityDiscoveryPage {...value} />);
    expect(await screen.findByText("已保存到分析")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(value.onNavigateHome).toHaveBeenCalledOnce();
    expect(value.onOpenPreparedJob).not.toHaveBeenCalled();
  });
});
