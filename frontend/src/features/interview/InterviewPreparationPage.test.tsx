import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewPreparation } from "../../types";
import { InterviewPreparationPage } from "./InterviewPreparationPage";

const preparation: InterviewPreparation = {
  profile: { id: 1, name: "测试候选人" },
  source_revision: 2,
  stale: false,
  has_resume: true,
  overview: { target_roles: ["AI 产品经理"], summary: "围绕真实经历开始梳理。" },
  selected_project_ids: [],
  job_analysis: null,
  experiences: [{
    id: "experience-1",
    title: "AI 求职助手项目",
    evidence: "使用 FastAPI 和 React 完成简历解析模块。",
    questions: [{ id: "experience-1-contribution", kind: "question", title: "你具体负责什么？", completed: false, note: "" }],
    knowledge: [{ id: "experience-1-skill-fastapi", kind: "knowledge", title: "梳理 FastAPI 的核心概念", completed: false, note: "" }],
    gaps: []
  }],
  unclassified_fragments: [{ id: "fragment-1", text: "具备 Python 与 FastAPI 的项目经验。", decision: "pending" }],
  classified_fragment_count: 0,
  ignored_fragment_count: 1,
  review_items: [],
  general_knowledge: [{ id: "resume-skill-fastapi", kind: "knowledge", title: "梳理 FastAPI 的核心概念、实际用法和选型边界", completed: false, note: "" }],
  interview_records: []
};

describe("InterviewPreparationPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ ...preparation, experiences: [{ ...preparation.experiences[0], knowledge: [{ ...preparation.experiences[0].knowledge[0], completed: true }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(preparation), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("guides a first-time user to create a profile instead of showing a load failure", () => {
    const onOpenProfile = vi.fn();
    render(<InterviewPreparationPage
      apiBase="http://localhost:8000"
      accessToken="token"
      initialData={{ ...preparation, has_profile: false, has_resume: false, experiences: [] }}
      onOpenProfile={onOpenProfile}
    />);

    expect(screen.getByRole("heading", { name: "先建立候选人画像" })).toBeInTheDocument();
    expect(screen.queryByText("暂时无法加载面试准备")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建个人资料" }));
    expect(onOpenProfile).toHaveBeenCalledOnce();
  });

  it("shows a project-analysis workspace before deep AI analysis is available", async () => {
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" onOpenProfile={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "项目深度解析" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "经历候选" })).toBeInTheDocument();
    expect(screen.getByText(/还有 1 条待归类内容/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认为项目" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "深度 AI 解析" })).not.toBeInTheDocument();
  });

  it("deduplicates the initial load in development strict mode", async () => {
    render(<StrictMode><InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" onOpenProfile={vi.fn()} /></StrictMode>);

    await screen.findByRole("heading", { name: "项目深度解析" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses preparation data provided by the app shell", async () => {
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" initialData={preparation} onOpenProfile={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "项目深度解析" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not automatically analyze the same resume revision twice", async () => {
    const onAutoAnalysisStarted = vi.fn();
    const bulkPreparation: InterviewPreparation = {
      ...preparation,
      unclassified_fragments: Array.from({ length: 10 }, (_, index) => ({
        id: `fragment-${index}`,
        text: `待归类片段 ${index}`,
        decision: "pending" as const
      })),
      resume_analysis: { status: "idle" }
    };
    render(<InterviewPreparationPage
      apiBase="http://localhost:8000"
      accessToken="token"
      initialData={bulkPreparation}
      autoAnalysisAttemptedRevision={bulkPreparation.source_revision}
      onAutoAnalysisStarted={onAutoAnalysisStarted}
      onOpenProfile={vi.fn()}
    />);

    await screen.findByRole("heading", { name: "项目深度解析" });
    await waitFor(() => expect(onAutoAnalysisStarted).not.toHaveBeenCalled());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the project overview anchored to one resume candidate and exposes its evidence", async () => {
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" onOpenProfile={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "AI 求职助手项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "证据核验" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "证据核验" }));
    expect(screen.getByText("使用 FastAPI 和 React 完成简历解析模块。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "面试练习" }));
    expect(screen.getByRole("heading", { name: "高概率问题" })).toBeInTheDocument();
    expect(screen.getByText("梳理 FastAPI 的核心概念")).toBeInTheDocument();
  });

  it("opens practice content when a project deep link requests a focus", async () => {
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" focus="questions" onOpenProfile={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "高概率问题" })).toBeInTheDocument();
  });

  it("saves a user's completion state", async () => {
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "AI 求职助手项目" });
    fireEvent.click(screen.getByRole("button", { name: "面试练习" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "梳理 FastAPI 的核心概念" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/interview-preparation/nodes/experience-1-skill-fastapi",
      expect.objectContaining({ method: "PATCH" })
    ));
  });

  it("saves a text answer instead of treating practice as a timed simulation", async () => {
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "AI 求职助手项目" });
    fireEvent.click(screen.getByRole("button", { name: "面试练习" }));
    expect(screen.queryByRole("button", { name: "保存回答" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "你具体负责什么？ 的回答" }), { target: { value: "我负责简历解析 API 与前端交付。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存回答" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/interview-preparation/nodes/experience-1-contribution",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ note: "我负责简历解析 API 与前端交付。" }) })
    ));
  });

  it("turns selected projects and a JD into rewrite material and feedback practice", async () => {
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "AI 求职助手项目" });
    vi.mocked(fetch).mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ ...preparation, selected_project_ids: ["experience-1"] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(_input).endsWith("/jd-analysis")) {
        return new Response(JSON.stringify({
          ...preparation,
          selected_project_ids: ["experience-1"],
          job_analysis: {
            job_description: "负责 AI 应用后端服务与稳定性建设，熟悉 FastAPI 和 React。",
            summary: { fit: "具备核心开发经历", matched: ["FastAPI 服务开发"], gaps: ["补充稳定性取舍"] },
            projects: [{ id: "experience-1", rewrite: "使用 FastAPI 和 React 完成简历解析模块。", questions: [{ id: "experience-1-jd-question-1", question: "你如何设计简历解析模块？", focus: "系统设计与取舍" }] }]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(_input).endsWith("/feedback")) {
        return new Response(JSON.stringify({ feedback: { strengths: ["说明了范围"], gaps: ["补充取舍"], next_attempt: "说明具体决策。" } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(preparation), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "用于本次投递" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "目标 JD" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "目标 JD" }), { target: { value: "负责 AI 应用后端服务与稳定性建设，熟悉 FastAPI 和 React。" } });
    fireEvent.click(screen.getByRole("button", { name: "生成改写与问题" }));
    expect(await screen.findByText("匹配判断：具备核心开发经历")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "投递改写" }));
    expect(screen.getByRole("textbox", { name: "项目改写" })).toHaveValue("使用 FastAPI 和 React 完成简历解析模块。");
    fireEvent.click(screen.getByRole("button", { name: "面试练习" }));
    fireEvent.change(screen.getByRole("textbox", { name: "你如何设计简历解析模块？ 的回答" }), { target: { value: "我先设计解析接口，再处理前端展示和失败回退。" } });
    fireEvent.click(screen.getByRole("button", { name: "获取反馈" }));
    expect(await screen.findByText("说明了范围")).toBeInTheDocument();
  });

  it("shows the JD analysis stage while the model is working", async () => {
    let resolveAnalysis: ((response: Response) => void) | undefined;
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "AI 求职助手项目" });
    vi.mocked(fetch).mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ ...preparation, selected_project_ids: ["experience-1"] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(_input).endsWith("/jd-analysis")) {
        return new Promise<Response>((resolve) => { resolveAnalysis = resolve; });
      }
      return new Response(JSON.stringify(preparation), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "用于本次投递" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "目标 JD" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "目标 JD" }), { target: { value: "负责 AI 应用后端服务与稳定性建设，熟悉 FastAPI 和 React。" } });
    fireEvent.click(screen.getByRole("button", { name: "生成改写与问题" }));
    expect(await screen.findByText("核对项目证据")).toBeInTheDocument();

    resolveAnalysis?.(new Response(JSON.stringify({ ...preparation, selected_project_ids: ["experience-1"], job_analysis: { job_description: "负责 AI 应用后端服务与稳定性建设，熟悉 FastAPI 和 React。", summary: { fit: "具备核心开发经历", matched: [], gaps: [] }, projects: [] } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await screen.findByText("分析完成，可查看缺口、改写和问题。")).toBeInTheDocument();
  });

  it("updates the route context when a question is opened", async () => {
    const onNavigate = vi.fn();
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" onOpenProfile={vi.fn()} onNavigate={onNavigate} />);

    await screen.findByRole("heading", { name: "AI 求职助手项目" });
    fireEvent.click(screen.getByRole("button", { name: "面试练习" }));
    fireEvent.focus(screen.getByRole("textbox", { name: "你具体负责什么？ 的回答" }));

    expect(onNavigate).toHaveBeenCalledWith({
      area: "projects",
      experienceId: "experience-1",
      focus: "questions",
      nodeId: "experience-1-contribution"
    });
  });

  it("keeps knowledge review useful when no project was identified", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...preparation, experiences: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" area="knowledge" onOpenProfile={vi.fn()} />);

    expect(await screen.findByText("简历中的技能")).toBeInTheDocument();
    expect(screen.getByText("梳理 FastAPI 的核心概念、实际用法和选型边界")).toBeInTheDocument();
  });

  it("records a real interview or practice reflection without requiring a job", async () => {
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" area="records" onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "记录一次复盘" });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "Agent 系统设计练习" } });
    fireEvent.change(screen.getByLabelText("问题、原回答与复盘"), { target: { value: "补充工具调用的权限边界与审计思路。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/interview-preparation/records",
      expect.objectContaining({ method: "POST" })
    ));
  });

  it("keeps a reflection draft when saving it fails", async () => {
    vi.mocked(fetch).mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (String(_input).endsWith("/interview-preparation/records") && init?.method === "POST") {
        return new Response(JSON.stringify({ detail: "网络暂时不可用" }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(preparation), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    render(<InterviewPreparationPage apiBase="http://localhost:8000" accessToken="token" area="records" onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "记录一次复盘" });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "Agent 系统设计练习" } });
    fireEvent.change(screen.getByLabelText("问题、原回答与复盘"), { target: { value: "补充工具调用的权限边界与审计思路。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));

    expect(await screen.findByText("网络暂时不可用")).toBeInTheDocument();
    expect(screen.getByLabelText("主题")).toHaveValue("Agent 系统设计练习");
    expect(screen.getByLabelText("问题、原回答与复盘")).toHaveValue("补充工具调用的权限边界与审计思路。");
  });
});
