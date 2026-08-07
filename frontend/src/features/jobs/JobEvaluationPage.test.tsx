import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvaluation } from "../../types";
import { JobEvaluationPage } from "./JobEvaluationPage";

const sections = "abcdefg".split("").map((key, index) => ({
  id: index + 1, section_key: key, title: ["岗位概要", "匹配与缺口", "职级策略", "薪资与需求", "简历计划", "面试准备", "真实性风险"][index],
  status: "completed", confidence: "medium", content: { summary: `${key.toUpperCase()} 内容` }, limitations: [], evidence_refs: ["JD"]
}));

const evaluation = {
  id: 12, job_id: 4, profile_id: 1, strategy_id: 2, parent_evaluation_id: null, mode: "full",
  status: "completed", current_stage: "completed", include_public_research: 1,
  research_budget: 5, research_query_count: 3, overall_score: 82, coverage: 85,
  confidence: "high", final_decision: "apply", risk_tier: "caution",
  effective_overall_score: 82, effective_coverage: 85, effective_confidence: "high",
  effective_final_decision: "consider", effective_risk_tier: "caution", is_stale: false,
  stale_reasons: [], hard_stops: [], limitations: ["只反映当前证据"], error_message: "",
  sections, requirements: [], effective_requirements: [], dimensions: [],
  effective_dimensions: [{ id: 1, dimension_key: "evidence_match", title: "已确认证据匹配", score: 82, effective_score: 82, weight: 30, weighted_score: 24.6, status: "evaluated", effective_status: "evaluated", confidence: "high", rationale: ["3 条证据"], evidence_refs: ["fact:1"] }],
  risks: [{ id: 1, risk_key: "employment_type", category: "employment", severity: "warning", confidence: "medium", observation: "用工关系需核实", explanation: "确认合同主体", evidence_refs: ["JD"] }],
  effective_risks: [{ id: 1, risk_key: "employment_type", category: "employment", severity: "warning", effective_severity: "warning", effective_status: "active", confidence: "medium", observation: "用工关系需核实", explanation: "确认合同主体", evidence_refs: ["JD"] }],
  created_at: "2026-08-01", completed_at: "2026-08-01"
} as JobEvaluation;

function props(page: "evaluation" | "evaluation_section" = "evaluation") {
  return {
    apiBase: "http://127.0.0.1:8000", page, jobId: 4,
    job: { id: 4, job_title: "AI 产品经理", company_name: "示例科技" } as never,
    sectionKey: page === "evaluation_section" ? "g" as const : undefined,
    onBack: vi.fn(), onOpenSection: vi.fn(), onOpenOverview: vi.fn(), onOpenDeep: vi.fn(),
    onCreateResume: vi.fn(), onCreateInterviewKit: vi.fn()
  };
}

describe("JobEvaluationPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/reviews") && init?.method === "POST") {
        return new Response(JSON.stringify({ ...evaluation, effective_risks: [{ ...evaluation.effective_risks[0], effective_status: "resolved" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const body = url.includes("/sources") ? [] : [evaluation];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps the report home concise and opens an A-G child page", async () => {
    const value = props();
    render(<JobEvaluationPage {...value} />);
    expect(await screen.findByRole("heading", { name: "可以考虑" })).toBeInTheDocument();
    expect(screen.getByText("真实性与用工风险")).toBeInTheDocument();
    expect(screen.getByText("六维透明评分")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /真实性风险/ }));
    expect(value.onOpenSection).toHaveBeenCalledWith("g");
  });

  it("blocks material creation when the report is stale", async () => {
    const staleEvaluation = { ...evaluation, is_stale: true, stale_reasons: ["岗位 JD 已更新"] };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/sources") ? [] : [staleEvaluation];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    render(<JobEvaluationPage {...props()} />);
    expect(await screen.findByText("这份报告已过期")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /创建版本/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /创建重点问答/ })).toBeDisabled();
  });

  it("shows system risk judgment separately and persists the user's review", async () => {
    render(<JobEvaluationPage {...props("evaluation_section")} />);
    expect(await screen.findByText("用工关系需核实")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "标记已解决" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/job-evaluations/12/reviews",
      expect.objectContaining({ method: "POST" })
    ));
    expect(await screen.findByText("你的审核：已解决/不采用")).toBeInTheDocument();
  });
});
