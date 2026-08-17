import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterviewKit } from "../../types";
import { InterviewQaEmpty, InterviewQaWorkspace } from "./InterviewQaWorkspace";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

function sampleKit(overrides: Partial<InterviewKit> = {}): InterviewKit {
  return {
    id: 31,
    job_id: 7,
    profile_id: 1,
    evaluation_id: 3,
    interview_type: "general",
    title: "示例 · 综合面试",
    status: "draft",
    task_count: 1,
    completed_task_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    notes: "",
    tasks: [],
    content: {
      method: "evidence",
      interview_type: "general",
      positioning: { headline: "后端", verified_strengths: ["Python"], evidence_gaps: ["量化"] },
      self_intro: "我是后端工程师。",
      self_intro_user_edited: false,
      questions: [
        {
          id: "q1",
          question: "讲一个你做过的后端项目",
          reason: "验证项目经历",
          answer_direction: "用 STAR 讲接口与调度",
          evidence: ["负责接口与任务调度"],
          status: "matched"
        },
        {
          id: "q2",
          question: "如何排查线上故障？",
          reason: "看排查节奏",
          answer_direction: "先止血再定位",
          evidence: [],
          status: "partial"
        }
      ],
      star_stories: [{
        id: "s1",
        title: "任务调度",
        source_excerpt: "负责接口与任务调度",
        situation: "服务需要调度",
        task: "完成治理",
        action: "推进测试",
        result: "稳定上线"
      }],
      reverse_questions: ["团队接下来最看重什么？"],
      limitations: ["不要虚构经历"]
    },
    ...overrides
  };
}

describe("InterviewQaWorkspace", () => {
  it("lets a candidate draft an answer, reveal the reference, and mark the question practiced", () => {
    render(
      <InterviewQaWorkspace
        job={null}
        kits={[sampleKit()]}
        kit={sampleKit()}
        busy={false}
        onCreateKit={vi.fn()}
        onSelectKit={vi.fn()}
        onUpdateKit={vi.fn()}
      />
    );

    expect(screen.getByText("0/2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("回答：讲一个你做过的后端项目"), {
      target: { value: "我负责过调度。" }
    });
    expect(screen.queryByText("用 STAR 讲接口与调度")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看参考讲法" }));
    expect(screen.getByText("用 STAR 讲接口与调度")).toBeInTheDocument();
    expect(screen.getByText("任务调度")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "标记已练" }));
    expect(screen.getByText("1/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    expect(screen.getByRole("heading", { name: "如何排查线上故障？" })).toBeInTheDocument();
  });

  it("groups the question bank by interview category", () => {
    render(
      <InterviewQaWorkspace
        job={null}
        kits={[sampleKit()]}
        kit={sampleKit({
          content: {
            ...sampleKit().content,
            questions: [
              {
                id: "q1",
                question: "请用一分钟介绍你自己",
                reason: "开场",
                answer_direction: "先说方向",
                evidence: [],
                status: "partial",
                category: "intro"
              },
              {
                id: "q2",
                question: "讲一个你做过的后端项目",
                reason: "验证项目经历",
                answer_direction: "用 STAR 讲接口与调度",
                evidence: ["负责接口与任务调度"],
                status: "matched",
                category: "project"
              }
            ]
          }
        })}
        busy={false}
        onCreateKit={vi.fn()}
        onSelectKit={vi.fn()}
        onUpdateKit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "全部题目" }));
    expect(screen.getByRole("heading", { name: "开场" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目经历" })).toBeInTheDocument();
    expect(screen.getByText("简历里有原文")).toBeInTheDocument();
    expect(screen.getByText("部分对得上")).toBeInTheDocument();
  });

  it("lets a candidate generate from a saved resume without picking a job", () => {
    const onGenerate = vi.fn();
    render(
      <InterviewQaEmpty
        canGenerate
        generateLabel="按简历生成"
        busy={false}
        onGenerate={onGenerate}
      />
    );

    expect(screen.getByRole("heading", { name: "从一个具体问题开始。" })).toBeInTheDocument();
    expect(screen.getByText("按已保存简历出题。生成预测问题、STAR 讲法和追问；导入岗位后可以再出一版。")).toBeInTheDocument();
    expect(screen.getByLabelText("题目来源")).toHaveTextContent("按简历准备");
    expect(screen.getByText("题目来自你的简历块，不是虚构岗位。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "按简历生成" }));
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "去简历分析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "去分析这份岗位" })).not.toBeInTheDocument();
  });

  it("keeps the analyzed-job generate path", () => {
    const onGenerate = vi.fn();
    render(
      <InterviewQaEmpty
        canGenerate
        generateLabel="生成面试问答"
        busy={false}
        hasAnalysis
        onGenerate={onGenerate}
      />
    );

    expect(screen.getByText("按已保存简历出题。这份岗位已有分析，生成时会把岗位要求一并考虑进去。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成面试问答" }));
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it("starts a resume-block drill from a project chip", () => {
    const onGenerate = vi.fn();
    render(
      <InterviewQaEmpty
        canGenerate
        generateLabel="按简历生成"
        busy={false}
        resumeText={"项目经历\n任务调度系统\n负责接口与任务调度\n\n相关技能\nPython"}
        onGenerate={onGenerate}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "任务调度系统" }));
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("careerloop.interview-drill-focus")).toContain("任务调度系统");
  });

  it("continues an unfinished kit and an existing conversation", () => {
    const onContinueKit = vi.fn();
    const onContinueConversation = vi.fn();
    render(
      <InterviewQaEmpty
        canGenerate
        generateLabel="按简历生成"
        busy={false}
        kits={[{
          id: 31,
          job_id: 7,
          profile_id: 1,
          evaluation_id: null,
          interview_type: "general",
          title: "按简历准备 · 综合面试",
          status: "draft",
          task_count: 2,
          completed_task_count: 0,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        }]}
        conversations={[{
          id: 4,
          title: "追问任务调度",
          status: "active",
          summary: "",
          message_count: 3,
          updated_at: "2026-01-02T00:00:00Z",
          last_message_at: "2026-01-02T00:00:00Z"
        }]}
        onGenerate={vi.fn()}
        onContinueKit={onContinueKit}
        onContinueConversation={onContinueConversation}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /继续上次练习/ }));
    expect(onContinueKit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /继续上次对话/ }));
    expect(onContinueConversation).toHaveBeenCalledWith(4);
  });

  it("reopens an unfinished drill on the next unpracticed question", () => {
    localStorage.setItem("careerloop.interview-practice.31", JSON.stringify({
      answers: { q1: "我负责调度。" },
      practiced: ["q1"],
      currentId: "q1"
    }));

    render(
      <InterviewQaWorkspace
        job={null}
        kits={[sampleKit()]}
        kit={sampleKit()}
        busy={false}
        onCreateKit={vi.fn()}
        onSelectKit={vi.fn()}
        onUpdateKit={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "如何排查线上故障？" })).toBeInTheDocument();
    expect(screen.getByText("接着第 2 题，先写自己的讲法。")).toBeInTheDocument();
    expect(screen.getByLabelText("题目来源")).toHaveTextContent("按简历准备");
  });
});
