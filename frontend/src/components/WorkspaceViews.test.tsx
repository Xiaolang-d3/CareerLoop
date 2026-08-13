import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function renderDashboard(status: WorkflowStatus | null, onNextStep = vi.fn()) {
  return render(
    <DashboardView
      workflow={status}
      conversations={[]}
      jobs={[]}
      nextStep={{
        title: "先建立职业画像",
        detail: "导入简历或填写关键经历。",
        action: "创建个人资料"
      }}
      onNextStep={onNextStep}
      onOpenConversation={vi.fn()}
    />
  );
}

function renderDashboardWithConversations(conversations: React.ComponentProps<typeof DashboardView>["conversations"]) {
  return render(
    <DashboardView
      workflow={null}
      conversations={conversations}
      jobs={[]}
      nextStep={{
        title: "先建立职业画像",
        detail: "导入简历或填写关键经历。",
        action: "创建个人资料"
      }}
      onNextStep={vi.fn()}
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
    expect(screen.getByRole("heading", { name: "先建立职业画像" })).toBeInTheDocument();
  });

  it("turns the suggested next step into a direct action", () => {
    const onNextStep = vi.fn();
    renderDashboard(null, onNextStep);

    fireEvent.click(screen.getByRole("button", { name: "创建个人资料" }));

    expect(onNextStep).toHaveBeenCalledOnce();
  });

  it("does not present an empty auto-created conversation as recent progress", () => {
    renderDashboardWithConversations([{
      id: 1,
      title: "历史对话",
      status: "active",
      summary: "",
      message_count: 0,
      task_status: "active",
      updated_at: "2026-08-13T00:00:00Z"
    }]);

    expect(screen.queryByRole("button", { name: /历史对话/ })).not.toBeInTheDocument();
    expect(screen.getByText("0 条记录")).toBeInTheDocument();
    expect(screen.getByText("完成第一次岗位分析后，任务记录会显示在这里。")).toBeInTheDocument();
  });
});
