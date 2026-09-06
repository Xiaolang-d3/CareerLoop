import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTopBar } from "../../components/AppTopBar";
import type { JobProject } from "../../types";
import type { Conversation } from "../../types";
import { HomePage } from "./HomePage";
import { homeActionQueue, homeContinueItems, homeInboxItems, homeJobProgress, homeNextStep, homeProjectReviews, homeSkillTags, inboxFactLabel, isSettingsProfileReady, latestJobAnalysisAt, profileCompleteness, splitHomeTags } from "./home-metrics";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function sampleJob(overrides: Partial<JobProject> = {}): JobProject {
  return {
    id: 7,
    conversation_id: 1,
    job_title: "后端工程师",
    company_name: "示例",
    location: "上海",
    salary_text: "",
    source_url: "",
    description: "负责后端开发",
    notes: "",
    priority: "high",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    latest_evaluation_at: "2026-08-10T08:30:00Z",
    ...overrides
  };
}

function sampleConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 3,
    title: "对照字节后端",
    status: "active",
    summary: "",
    message_count: 4,
    task_status: "active",
    updated_at: "2026-08-14T09:00:00Z",
    last_message_at: "2026-08-14T09:10:00Z",
    ...overrides
  };
}

function renderHome(overrides: Partial<ComponentProps<typeof HomePage>> = {}) {
  const props = {
    displayName: "小林",
    email: "owner@example.com",
    profileName: "张三",
    targetRole: "后端工程师",
    targetCity: "上海",
    resumeText: "一段已保存的简历文本。",
    resumeFilename: "cv.pdf",
    skills: "Python，FastAPI",
    profileLoaded: true,
    jobs: [] as JobProject[],
    jobsLoaded: true,
    onOpenAnalysis: vi.fn(),
    onOpenResume: vi.fn(),
    onOpenInterview: vi.fn(),
    onOpenProfile: vi.fn(),
    onOpenJob: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenOpportunities: vi.fn(),
    ...overrides
  };
  render(<HomePage {...props} />);
  return props;
}

describe("home-metrics", () => {
  it("counts filled profile fields without inventing a score", () => {
    expect(splitHomeTags("Python，FastAPI, React")).toEqual(["Python", "FastAPI", "React"]);
    expect(homeSkillTags(
      "Python，FastAPI，熟练掌握 LangChain、RAG 检索增强、Prompt 工程、多模态 AI 开发，具备 LLM 模型接入、微调优化、结构化输出约束能力。"
    )).toEqual(expect.arrayContaining(["Python", "FastAPI", "LangChain", "Prompt 工程"]));
    expect(homeSkillTags(
      "Python，FastAPI，熟练掌握 LangChain、RAG 检索增强、Prompt 工程、多模态 AI 开发"
    ).some((tag) => tag.includes("熟练掌握"))).toBe(false);
    expect(inboxFactLabel({ statement: "具备 Redis 相关经验", value: { name: "Redis" } })).toBe("Redis");
    expect(inboxFactLabel({ statement: "具备 Redis 相关经验", value: { name: "具备 Redis 相关经验" } })).toBe("Redis");
    expect(inboxFactLabel({ statement: "具备 实时语音链路 相关经验" })).toBe("实时语音链路");
    expect(homeInboxItems([
      { id: 1, statement: "具备 Redis 相关经验", category: "skill", value: { name: "Redis" } },
      { id: 2, statement: "具备 FastAPI 相关经验", category: "skill", value: { name: "FastAPI" } },
      {
        id: 3,
        statement: "具备 擅长实时语音链路、分布式服务架构、缓存优化与任务调度。 相关经验",
        category: "skill",
        value: { name: "擅长实时语音链路、分布式服务架构、缓存优化与任务调度。" }
      },
      {
        id: 4,
        statement: "接口性能提升 30%",
        category: "achievement",
        sourceKind: "resume_parser",
        evidence: [{ excerpt: "负责支付网关，接口性能提升 30%。" }]
      }
    ], {
      resumeText: "专业技能\nPython、Redis、FastAPI\n负责支付网关，接口性能提升 30%。",
      knownSkills: ["Python", "Redis", "FastAPI"]
    })).toEqual([
      expect.objectContaining({
        id: 4,
        title: "接口性能提升 30%",
        consequence: "确认后会把这条成果写入画像，并参与岗位评分",
        source: "负责支付网关，接口性能提升 30%。",
        sourceLabel: "简历原句"
      })
    ]);
    expect(profileCompleteness({
      name: "张三",
      targetRole: "后端工程师",
      targetCity: "上海",
      skills: "Python",
      resumeText: "一段简历"
    })).toBe(100);
    expect(profileCompleteness({ name: "张三" })).toBe(20);
    expect(isSettingsProfileReady({
      name: "张三",
      resumeText: "一段简历"
    })).toBe(true);
    expect(isSettingsProfileReady({ name: "张三" })).toBe(false);
  });

  it("picks the latest real analysis timestamp", () => {
    expect(latestJobAnalysisAt([
      sampleJob({ latest_evaluation_at: "2026-08-01T00:00:00Z" }),
      sampleJob({ id: 8, latest_evaluation_at: "2026-08-12T12:00:00Z" }),
      sampleJob({ id: 9, latest_evaluation_at: null })
    ])).toBe("2026-08-12T12:00:00Z");
    expect(latestJobAnalysisAt([])).toBeNull();
  });

  it("picks one next step from resume and analysis state", () => {
    expect(homeNextStep({
      profileLoaded: false,
      hasResume: false,
      completeness: null,
      lastAnalysis: null
    }).label).toBe("完善资料库");
    expect(homeNextStep({
      profileLoaded: true,
      hasResume: false,
      completeness: 20,
      lastAnalysis: null
    }).label).toBe("先保存简历");
    expect(homeNextStep({
      profileLoaded: true,
      hasResume: true,
      completeness: 100,
      lastAnalysis: null
    }).label).toBe("查看资料库");
    expect(homeNextStep({
      profileLoaded: true,
      hasResume: true,
      completeness: 100,
      lastAnalysis: "2026-08-12T12:00:00Z"
    }).label).toBe("查看资料库");
  });

  it("orders the home queue by resume, review, then an unevaluated job", () => {
    const queue = homeActionQueue({
      profileLoaded: true,
      hasResume: true,
      completeness: 100,
      lastAnalysis: "2026-08-12T12:00:00Z",
      pendingFactCount: 2,
      jobs: [sampleJob({ latest_evaluation_at: null })],
      conversations: [sampleConversation()]
    });
    expect(queue.map((item) => item.kind)).toEqual(["review", "analysis", "chat", "resume", "interview"]);
    expect(queue[1].label).toBe("评估 示例 · 后端工程师");
    expect(homeJobProgress([
      sampleJob(),
      sampleJob({ id: 8, latest_evaluation_at: null, priority: "medium" }),
      sampleJob({ id: 9, job_title: "按简历准备", latest_evaluation_at: null })
    ])).toEqual({
      total: 2,
      analyzed: 1,
      unevaluated: 1,
      highPriority: 1,
      nextUnevaluated: expect.objectContaining({ id: 8 })
    });
  });

  it("lists unfinished jobs and chats without repeating the primary next step", () => {
    const items = homeContinueItems({
      jobs: [sampleJob({ conversation_id: 3 })],
      conversations: [sampleConversation(), sampleConversation({ id: 4, title: "今天的准备" })],
      excludeJobId: 7,
      excludeConversationId: 3
    });
    expect(items.map((item) => item.title)).toEqual(["今天的准备"]);
  });

  it("turns project fields into a three-stage review chain", () => {
    expect(homeProjectReviews([{
      id: "project-1",
      title: "智能会议总结",
      evidence: "智能会议总结\n- 基于 LangChain 搭建统一 LLM 接入网关。",
      fields: [
        { label: "个人职责", value: "负责统一 LLM 接入网关" },
        { label: "技术方案", value: "LangChain + 多厂商模型路由" },
        { label: "结果", value: "新模型接入周期由 3 天缩短至 4 小时" }
      ],
      gaps: [{ completed: false }]
    }])).toEqual([{
      id: "project-1",
      title: "智能会议总结",
      gapCount: 1,
      lanes: [
        { key: "input", index: 1, label: "职责", value: "负责统一 LLM 接入网关", empty: false },
        { key: "process", index: 2, label: "方案", value: "LangChain + 多厂商模型路由", empty: false },
        { key: "output", index: 3, label: "结果", value: "新模型接入周期由 3 天缩短至 4 小时", empty: false }
      ]
    }]);
    expect(homeProjectReviews([{
      id: "project-2",
      title: "AI 求职助手项目",
      evidence: "AI 求职助手项目\n- 使用 FastAPI 和 React 完成简历解析模块。\n- 将人工整理时间降低 35%。"
    }])[0].lanes.map((lane) => lane.value)).toEqual([
      "使用 FastAPI 和 React 完成简历解析模块。",
      "",
      "将人工整理时间降低 35%。"
    ]);
  });
});

describe("HomePage", () => {
  it("shows a greeting, quick actions, and honest knowledge overview", () => {
    renderHome();

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/张三/);
    expect(screen.getByText("当前资料方向：后端工程师 · 上海")).toBeInTheDocument();
    expect(screen.getByLabelText("快捷操作")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加内容/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /向我提问/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /整理知识/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /生成内容/ })).toBeInTheDocument();
    expect(screen.getByLabelText("我的知识概览")).toBeInTheDocument();
    expect(screen.getByLabelText("最近添加")).toBeInTheDocument();
    expect(screen.getByLabelText("最近对话")).toBeInTheDocument();
    expect(screen.getByLabelText("正在进行的任务")).toBeInTheDocument();
    expect(screen.getByLabelText("今日灵感")).toBeInTheDocument();
    expect(screen.queryByText("岗位推进")).not.toBeInTheDocument();
    expect(screen.queryByText("机会中心")).not.toBeInTheDocument();
  });

  it("keeps detailed skill information in the library instead of crowding the home page", () => {
    renderHome({
      skills: "Python，FastAPI，熟练掌握 LangChain、RAG 检索增强、Prompt 工程、多模态 AI 开发，具备 LLM 模型接入、微调优化、结构化输出约束能力。"
    });
    expect(screen.queryByLabelText("技能标签")).not.toBeInTheDocument();
    expect(screen.queryByText("LangChain")).not.toBeInTheDocument();
    expect(screen.getByLabelText("我的知识概览")).toBeInTheDocument();
  });

  it("uses a calm empty state when profile and jobs are not ready yet", () => {
    renderHome({
      profileName: "",
      targetRole: "",
      targetCity: "",
      resumeText: "",
      skills: "",
      profileLoaded: false,
      jobsLoaded: false,
      jobs: []
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/小林/);
    expect(screen.getByText("资料读取后，这里会给出下一步。")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("资料尚未读取").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the global top bar above the home greeting", () => {
    const props = {
      displayName: "小林",
      email: "owner@example.com",
      profileName: "张三",
      targetRole: "后端工程师",
      targetCity: "上海",
      resumeText: "一段已保存的简历文本。",
      resumeFilename: "cv.pdf",
      skills: "Python，FastAPI",
      profileLoaded: true,
      jobs: [] as JobProject[],
      jobsLoaded: true,
      onOpenAnalysis: vi.fn(),
      onOpenResume: vi.fn(),
      onOpenInterview: vi.fn(),
      onOpenProfile: vi.fn()
    };
    render(
      <section className="content">
        <AppTopBar userEmail={props.email} onOpenProfile={props.onOpenProfile} onLogout={vi.fn()} />
        <HomePage {...props} />
      </section>
    );
    const bar = document.querySelector("header.app-topbar");
    expect(bar).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/张三/);
    expect(screen.getByRole("heading", { level: 2 }).closest(".app-topbar")).toBeNull();
  });

  it("does not show a weekly report", () => {
    renderHome({ apiBase: "http://localhost:8000", accessToken: "token" });
    expect(screen.queryByText("本周求职进展")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("求职周报")).not.toBeInTheDocument();
  });

  it("wires quick actions to library, chat, organize, and workspace", () => {
    const props = renderHome({ onOpenOrganize: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /添加内容/ }));
    fireEvent.click(screen.getByRole("button", { name: /向我提问/ }));
    fireEvent.click(screen.getByRole("button", { name: /整理知识/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成内容/ }));
    expect(props.onOpenProfile).toHaveBeenCalled();
    expect(props.onOpenChat).toHaveBeenCalled();
    expect(props.onOpenOrganize).toHaveBeenCalled();
    expect(props.onOpenResume).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /机会中心/ })).not.toBeInTheDocument();
  });

  it("sends knowledge overview cards to library or workspace", () => {
    const props = renderHome({ jobs: [sampleJob()] });
    const snapshot = screen.getByLabelText("内容概览");
    fireEvent.click(within(snapshot).getByRole("button", { name: /知识条目/ }));
    fireEvent.click(within(snapshot).getByRole("button", { name: /文件/ }));
    expect(props.onOpenProfile).toHaveBeenCalled();
    expect(props.onOpenResume).toHaveBeenCalled();
    expect(props.onOpenOpportunities).not.toHaveBeenCalled();
  });

  it("lists recent chats and active tasks when present", () => {
    const props = renderHome({
      conversations: [
        sampleConversation(),
        sampleConversation({ id: 9, title: "整理本周笔记", task_status: "active", summary: "进行中" })
      ]
    });
    expect(screen.getByLabelText("最近对话")).toHaveTextContent("对照字节后端");
    expect(screen.getByLabelText("正在进行的任务")).toHaveTextContent("整理本周笔记");
    fireEvent.click(within(screen.getByLabelText("正在进行的任务")).getByRole("button", { name: /整理本周笔记/ }));
    expect(props.onOpenChat).toHaveBeenCalledWith(9);
  });
});
