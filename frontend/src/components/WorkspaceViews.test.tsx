import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardView } from "./WorkspaceViews";
import type { WorkflowStatus } from "../types";

// 该 setup 未开启自动清理（src/test/setup.ts 只引入 jest-dom），多次 render 会叠加 DOM。
afterEach(cleanup);

const emptyCounts: WorkflowStatus["counts"] = {
  profiles: 0,
  jd_analyses: 0,
  resume_evidence_searches: 0,
  tailored_resume_generations: 0,
  interview_advice_generations: 0,
  company_researches: 0
};

function workflow(overrides: Partial<WorkflowStatus> = {}): WorkflowStatus {
  return {
    status: "in_progress",
    counts: emptyCounts,
    stage_counts: {},
    nodes: [],
    ...overrides
  };
}

function renderDashboard(status: WorkflowStatus | null) {
  return render(
    <DashboardView
      workflow={status}
      conversations={[]}
      jobs={[]}
      onOpenConversation={vi.fn()}
    />
  );
}

describe("DashboardView 求职流程阶段", () => {
  it("renders each stage with its title and status label", () => {
    renderDashboard(
      workflow({
        stage_counts: { job_evaluation: 2 },
        nodes: [
          { id: "candidate_knowledge", title: "候选人画像与知识", status: "running", detail: "已进入该阶段，尚未产出结果" },
          { id: "job_evaluation", title: "岗位评估与决策", status: "done", detail: "已完成 2 次操作" },
          { id: "outcome_tracking", title: "结果与复盘", status: "pending", detail: "", hint: "记录投递结果与面试复盘" }
        ]
      })
    );

    const panel = screen.getByRole("region", { name: "求职流程阶段" });
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("1/3 个阶段完成")).toBeInTheDocument();

    expect(screen.getByText("候选人画像与知识")).toBeInTheDocument();
    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(screen.getByText("岗位评估与决策")).toBeInTheDocument();
    expect(screen.getByText("已完成 2 次操作")).toBeInTheDocument();
  });

  it("falls back to the stage hint when detail is empty", () => {
    renderDashboard(
      workflow({
        nodes: [
          { id: "outcome_tracking", title: "结果与复盘", status: "pending", detail: "", hint: "记录投递结果与面试复盘" }
        ]
      })
    );

    expect(screen.getByText("记录投递结果与面试复盘")).toBeInTheDocument();
    expect(screen.getByText("未开始")).toBeInTheDocument();
  });

  it("hides the stage panel when no nodes are available", () => {
    renderDashboard(workflow());
    expect(screen.queryByRole("region", { name: "求职流程阶段" })).not.toBeInTheDocument();
  });

  it("prefers stage_counts for the metric cards", () => {
    renderDashboard(
      workflow({
        stage_counts: { job_evaluation: 7, material_preparation: 3, interview_preparation: 1 },
        nodes: []
      })
    );

    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("falls back to legacy counts when stage_counts is absent", () => {
    renderDashboard({
      status: "in_progress",
      counts: { ...emptyCounts, jd_analyses: 5 },
      nodes: []
    });

    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders without a workflow snapshot", () => {
    renderDashboard(null);
    expect(screen.getByRole("heading", { name: "综合控制台" })).toBeInTheDocument();
  });
});
