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
  it("shows a profile greeting and honest metrics without analysis data", () => {
    renderHome();

    expect(screen.getByRole("heading", { name: "你好，张三" })).toBeInTheDocument();
    expect(screen.getByText("当前资料方向：后端工程师 · 上海")).toBeInTheDocument();
    expect(screen.getByText("核对已保存的信息，并继续用于分析或内容生成。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看资料库" })).toBeInTheDocument();
    expect(screen.getByText("工作台")).toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.getByText("cv.pdf")).toBeInTheDocument();
    expect(screen.getByText("资料库")).toBeInTheDocument();
    expect(screen.getByText("已核对")).toBeInTheDocument();
    expect(screen.queryByText("岗位推进")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "查看资料库" })).toHaveLength(1);
    expect(screen.queryByLabelText("接下来还可以")).not.toBeInTheDocument();
    expect(screen.getByLabelText("最近工作")).toBeInTheDocument();
    expect(screen.queryByText("资料完整度")).not.toBeInTheDocument();
    expect(screen.queryByText("Python")).not.toBeInTheDocument();
    expect(screen.queryByText("FastAPI")).not.toBeInTheDocument();
    expect(screen.queryByText("求职流程阶段")).not.toBeInTheDocument();
    expect(screen.queryByText("最近任务")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("技能标签")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("项目证据")).not.toBeInTheDocument();
  });

  it("keeps detailed skill information in the library instead of crowding the home page", () => {
    renderHome({
      skills: "Python，FastAPI，熟练掌握 LangChain、RAG 检索增强、Prompt 工程、多模态 AI 开发，具备 LLM 模型接入、微调优化、结构化输出约束能力。"
    });

    expect(screen.queryByLabelText("技能标签")).not.toBeInTheDocument();
    expect(screen.queryByText("LangChain")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /资料库/ }).length).toBeGreaterThan(0);
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

    expect(screen.getByRole("heading", { name: "你好，小林" })).toBeInTheDocument();
    expect(screen.getByText("资料读取后，这里会给出下一步。")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("资料尚未读取").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("资料读取后会显示完整度。")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("正在加载")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("技能标签")).not.toBeInTheDocument();
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
    expect(screen.queryByRole("heading", { level: 1, name: "首页" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("h1")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "账号菜单" }).closest(".app-topbar")).toBe(bar);
    expect(screen.getByRole("heading", { name: "你好，张三" }).closest(".app-topbar")).toBeNull();
  });

  it("does not show a weekly report", () => {
    renderHome({ apiBase: "http://localhost:8000", accessToken: "token" });
    expect(screen.queryByText("本周求职进展")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("求职周报")).not.toBeInTheDocument();
  });

  it("keeps one primary action and removes job-specific shortcut clusters", () => {
    const props = renderHome({ jobs: [sampleJob()] });

    fireEvent.click(screen.getByRole("button", { name: "查看资料库" }));

    expect(screen.queryByRole("button", { name: /机会中心/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /项目解析/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /岗位推进/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("项目证据")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /继续分析/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /定制简历/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /面试准备/ })).not.toBeInTheDocument();
    expect(props.onOpenProfile).toHaveBeenCalledOnce();
  });

  it("sends the evidence snapshot to the ledger and the resume snapshot to the studio", () => {
    const props = renderHome({ jobs: [sampleJob()] });
    const snapshot = screen.getByLabelText("内容概览");

    fireEvent.click(within(snapshot).getByRole("button", { name: /资料库/ }));
    fireEvent.click(within(snapshot).getByRole("button", { name: /工作台/ }));

    expect(props.onOpenProfile).toHaveBeenCalledOnce();
    expect(props.onOpenResume).toHaveBeenCalledOnce();
    expect(props.onOpenAnalysis).not.toHaveBeenCalled();
    expect(props.onOpenOpportunities).not.toHaveBeenCalled();
  });

  it("prioritizes the active conversation and sends pending review work to the library", () => {
    const props = renderHome({
      jobs: [sampleJob({ latest_evaluation_at: null })],
      conversations: [sampleConversation()],
      pendingFacts: [{ id: 21, statement: "主导过检索评测", category: "project" }]
    });

    expect(screen.getByRole("button", { name: "继续上次对话" })).toBeInTheDocument();
    expect(screen.getByLabelText("最近工作")).toHaveTextContent("示例 · 后端工程师");
    expect(screen.queryByLabelText("待确认")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "继续上次对话" }));
    fireEvent.click(within(screen.getByLabelText("内容概览")).getByRole("button", { name: /资料库/ }));

    expect(props.onOpenChat).toHaveBeenCalledWith(3);
    expect(props.onOpenProfile).toHaveBeenCalledOnce();
  });

  it("summarizes pending items without rendering a review inbox on the home page", () => {
    const props = renderHome({
      skills: "Python",
      resumeText: "专业技能 Python、Redis\n实时语音链路项目\n负责支付网关，接口性能提升 30%。",
      pendingFacts: [
        { id: 21, statement: "具备 Redis 相关经验", category: "skill", value: { name: "Redis" }, sourceKind: "resume_parser" },
        { id: 22, statement: "实时语音链路", category: "skill", value: { name: "实时语音链路" } },
        { id: 23, statement: "接口性能提升 30%", category: "achievement", evidence: [{ excerpt: "负责支付网关，接口性能提升 30%。" }] },
        { id: 24, statement: "分布式服务架构", category: "skill", value: { name: "分布式服务架构" } }
      ]
    });

    expect(screen.getByRole("button", { name: "确认 4 条待审知识" })).toBeInTheDocument();
    expect(screen.queryByLabelText("待确认")).not.toBeInTheDocument();
    expect(screen.getByLabelText("内容概览")).toHaveTextContent("4 条待确认");

    fireEvent.click(screen.getByRole("button", { name: "确认 4 条待审知识" }));
    expect(props.onOpenProfile).toHaveBeenCalledOnce();
  });

  it("hides the inbox when leftover items are chips or garbled skill wrappers", () => {
    renderHome({
      skills: "Python，Redis，FastAPI",
      resumeText: "专业技能\nPython、Redis、FastAPI\n擅长实时语音链路、分布式服务架构、缓存优化与任务调度。",
      pendingFacts: [
        { id: 1, statement: "具备 Redis 相关经验", category: "skill", value: { name: "Redis" } },
        { id: 2, statement: "具备 FastAPI 相关经验", category: "skill", value: { name: "FastAPI" } },
        {
          id: 3,
          statement: "具备 擅长实时语音链路、分布式服务架构、缓存优化与任务调度。 相关经验",
          category: "skill",
          value: { name: "擅长实时语音链路、分布式服务架构、缓存优化与任务调度。" }
        }
      ]
    });

    expect(screen.queryByLabelText("待确认")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /待审知识/ })).not.toBeInTheDocument();
  });

  it("keeps project evidence in the library instead of the home page", () => {
    const props = renderHome({
      projects: [{
        id: "project-1",
        title: "智能会议总结",
        evidence: "智能会议总结\n- 基于 LangChain 搭建统一 LLM 接入网关。",
        fields: [
          { label: "个人职责", value: "负责统一 LLM 接入网关" },
          { label: "技术方案", value: "LangChain + 多厂商模型路由" },
          { label: "结果", value: "新模型接入周期由 3 天缩短至 4 小时" }
        ],
        gaps: [{ completed: false }]
      }],
      onOpenProject: vi.fn()
    });

    expect(screen.queryByLabelText("项目证据")).not.toBeInTheDocument();
    expect(screen.queryByText("智能会议总结")).not.toBeInTheDocument();
    expect(props.onOpenProject).not.toHaveBeenCalled();
  });

  it("does not fetch project evidence while rendering the home page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/interview-preparation")) {
        return new Response(JSON.stringify({
          experiences: [{
            id: "project-9",
            title: "实时语音链路",
            evidence: "麦克风采集后做 Opus 编码并流式上行。",
            fields: [
              { label: "个人职责", value: "音频采集与分片上行" },
              { label: "技术方案", value: "Ogg/Opus 编码与流控重连" },
              { label: "结果", value: "首字时延控制在 800ms 内" }
            ],
            gaps: []
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }));

    renderHome({
      apiBase: "http://localhost:8000",
      accessToken: "token",
      onOpenProject: vi.fn()
    });

    await Promise.resolve();
    expect(screen.queryByLabelText("项目证据")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
