import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterviewKit, JobProject, QuickMatchResult, ResumeVersion } from "../types";
import { AppTopBar } from "./AppTopBar";
import { WorkbenchView } from "./WorkspaceViews";

afterEach(cleanup);

function resumeOnlyResult(): QuickMatchResult {
  return {
    job: { title: "", company_name: "", description_character_count: 0 },
    persistence: "not_saved_as_job",
    analysis: {
      mode: "resume_only",
      required_skills: [],
      matched_skills: ["Python"],
      missing_skills: [],
      evidence: [],
      skill_coverage: null,
      confidence: "limited",
      limitations: ["未提供具体岗位，以下是对已保存简历本身的分析"],
      resume: {
        character_count: 80,
        skills: ["Python"],
        headline: { verdict: "能看出你会 Python。", evidence: "使用 Python 完成内部工具。", remember: "使用 Python 完成内部工具", skip: "" },
        strengths: [{ label: "Python", evidence: "使用 Python 完成内部工具。" }],
        structure: { found: ["项目经历"], missing: [] },
        projects: [],
        gaps: [],
        next_actions: [{ title: "补上项目结果", detail: "", evidence: "", kind: "rewrite", patch: { original: "负责接口联调。", suggested: "负责接口联调，【待补充：可核对的结果】。" } }]
      }
    }
  };
}

function jobMatchResult(): QuickMatchResult {
  return {
    ...resumeOnlyResult(),
    job: { title: "后端工程师", company_name: "示例", description_character_count: 40 },
    analysis: {
      ...resumeOnlyResult().analysis,
      mode: "job_match",
      missing_skills: ["Kubernetes"],
      skill_coverage: 50
    }
  };
}

function sampleResumeVersion(overrides: Partial<ResumeVersion> = {}): ResumeVersion {
  return {
    id: 11,
    job_id: null,
    profile_id: 1,
    evaluation_id: null,
    title: "小程 V1",
    status: "draft",
    template_id: "classic",
    style_id: "navy",
    layout: { spacing: 100, one_page: false },
    change_count: 1,
    change_counts: { pending: 1, accepted: 0, rejected: 0 },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    base_content: "负责 AI 产品从 0 到 1。",
    rendered_content: "负责 AI 产品从 0 到 1。",
    changes: [{
      id: 21,
      version_id: 11,
      change_type: "summary",
      section_key: "body",
      before_text: "负责 AI 产品从 0 到 1。",
      after_text: "负责 AI 产品从 0 到 1。",
      rationale: "",
      evidence: [],
      decision: "pending",
      user_edited: 0,
      sort_order: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z"
    }],
    ...overrides
  };
}

function sampleInterviewKit(overrides: Partial<InterviewKit> = {}): InterviewKit {
  return {
    id: 31,
    job_id: 7,
    profile_id: 1,
    evaluation_id: 3,
    interview_type: "general",
    title: "示例 · 后端工程师 · 综合面试 V1",
    status: "draft",
    task_count: 2,
    completed_task_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    notes: "",
    tasks: [{
      id: 41,
      kit_id: 31,
      category: "prep",
      title: "练习自我介绍",
      completed: 0,
      sort_order: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z"
    }],
    content: {
      method: "evidence",
      interview_type: "general",
      positioning: { headline: "后端工程师", verified_strengths: ["Python"], evidence_gaps: ["缺少量化结果"] },
      self_intro: "我是后端工程师。",
      self_intro_user_edited: false,
      questions: [{
        id: "q1",
        question: "讲一个你做过的后端项目",
        reason: "验证项目经历",
        answer_direction: "用 STAR 讲接口与调度",
        evidence: ["负责接口与任务调度"],
        status: "matched"
      }],
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
    priority: "medium",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    latest_evaluation_id: 3,
    ...overrides
  };
}

function workbenchProps(
  overrides: Partial<ComponentProps<typeof WorkbenchView>> = {}
): ComponentProps<typeof WorkbenchView> {
  return {
    viewMode: "index",
    hasProfile: true,
    resumeFilename: "cv.pdf",
    resumeText: "负责 AI 产品从 0 到 1。",
    profileName: "张三",
    resumeLoading: false,
    chatBusy: false,
    jobBusy: false,
    jobImportBusy: false,
    analysis: null,
    analysisBusy: false,
    resumeVersions: [],
    resumeVersion: null,
    resumeBusy: false,
    interviewKits: [],
    interviewKit: null,
    interviewRounds: [],
    jobTimeline: [],
    interviewBusy: false,
    jobs: [],
    selectedJobId: null,
    onSelectJob: vi.fn(),
    onNavigateIndex: vi.fn(),
    onNavigateNew: vi.fn(),
    onNavigateDetail: vi.fn(),
    onNavigateResume: vi.fn(),
    onNavigateInterview: vi.fn(),
    onNavigateEvaluation: vi.fn(),
    onCreateComparison: vi.fn(),
    onQuickMatch: vi.fn(async () => resumeOnlyResult()),
    onSaveJob: vi.fn(),
    onPreviewJobText: vi.fn(),
    onPreviewJobScreenshot: vi.fn(),
    onDeleteJob: vi.fn(),
    onCreateResumeVersion: vi.fn(),
    onSelectResumeVersion: vi.fn(),
    onUpdateResumeChange: vi.fn(),
    onUpdateResumeVersion: vi.fn(),
    onExportResume: vi.fn(),
    onCreateInterviewKit: vi.fn(),
    onSelectInterviewKit: vi.fn(),
    onUpdateInterviewKit: vi.fn(),
    onToggleInterviewTask: vi.fn(),
    onCreateInterviewRound: vi.fn(),
    onUpdateInterviewRound: vi.fn(),
    onAddTimelineNote: vi.fn(),
    onOpenProfile: vi.fn(),
    conversations: [],
    onOpenChat: vi.fn(),
    ...overrides
  };
}

function renderWorkbench(
  overrides: Partial<ComponentProps<typeof WorkbenchView>> = {}
) {
  return render(<WorkbenchView {...workbenchProps(overrides)} />);
}

describe("WorkbenchView 匹配分析工作台", () => {
  it("shows a resume analysis bench without requiring a job", () => {
    renderWorkbench();

    expect(screen.getByRole("heading", { name: "分析这份简历" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("粘贴岗位职责、任职要求…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传截图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对照分析" })).not.toBeInTheDocument();
    expect(screen.getByText(/已保存简历 · 张三 · .+字/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "cv.pdf" })).not.toBeInTheDocument();
    expect(screen.queryByRole("blockquote")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对照岗位" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看简历" })).toBeInTheDocument();
    const modules = screen.getByRole("navigation", { name: "求职模块" });
    expect(modules.closest(".topbar")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "匹配分析" })).not.toBeInTheDocument();
    expect(modules.closest(".resume-module-shell")).toHaveClass("is-analysis");
    expect(within(modules).getByRole("button", { name: "匹配分析" })).toHaveAttribute("aria-current", "page");
    expect(within(modules).getByRole("button", { name: "定制简历" })).toBeInTheDocument();
    expect(within(modules).getByRole("button", { name: "面试问答" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "分析步骤" })).not.toBeInTheDocument();
    expect(screen.queryByText("未开始")).not.toBeInTheDocument();
    expect(screen.queryByText("要对照某份岗位吗？")).not.toBeInTheDocument();
    expect(screen.queryByText(/有模型时再润色/)).not.toBeInTheDocument();
  });

  it("shows the saved resume identity without a filename hero", () => {
    renderWorkbench({
      resumeFilename: "简历原文",
      resumeText: "陈露鑫\n\n负责后端接口与任务调度。",
      profileName: "小程"
    });

    expect(screen.getByRole("heading", { name: "分析这份简历" })).toBeInTheDocument();
    expect(screen.getByText(/已保存简历 · 陈露鑫 · .+字/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "简历原文" })).not.toBeInTheDocument();
    expect(screen.queryByText(/小程 ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("blockquote")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对照岗位" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看简历" })).toBeInTheDocument();
  });

  it("skips showing resume body copy on the match bench", () => {
    renderWorkbench({
      resumeFilename: "简历原文",
      resumeText: "陈露鑫\n\n教育经历\n复旦大学｜计算机科学与技术",
      profileName: "小程"
    });

    expect(screen.getByText(/已保存简历 · 陈露鑫 · .+字/)).toBeInTheDocument();
    expect(screen.queryByText("教育经历")).not.toBeInTheDocument();
    expect(screen.queryByText("复旦大学｜计算机科学与技术")).not.toBeInTheDocument();
    expect(screen.queryByRole("blockquote")).not.toBeInTheDocument();
  });

  it("does not isolate a name-only resume as a preview box", () => {
    renderWorkbench({
      resumeFilename: "简历原文",
      resumeText: "陈露鑫",
      profileName: "小程"
    });

    expect(screen.getByRole("heading", { name: "分析这份简历" })).toBeInTheDocument();
    expect(screen.getByText(/已保存简历 · 陈露鑫 · .+字/)).toBeInTheDocument();
    expect(screen.queryByText(/小程 ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("blockquote")).not.toBeInTheDocument();
  });

  it("keeps the global top bar above the workbench module tabs", () => {
    render(
      <section className="content">
        <AppTopBar userEmail="owner@example.com" onOpenProfile={vi.fn()} onLogout={vi.fn()} />
        <WorkbenchView {...workbenchProps()} />
      </section>
    );

    const bar = document.querySelector("header.app-topbar");
    const modules = screen.getByRole("navigation", { name: "求职模块" });
    expect(bar).toBeTruthy();
    expect(screen.getByRole("button", { name: "账号菜单" }).closest(".app-topbar")).toBe(bar);
    expect(modules.closest(".app-topbar")).toBeNull();
    expect(modules.closest(".topbar")).toBeTruthy();
    expect(modules.parentElement).toHaveClass("ui-section-copy");
    expect(modules.parentElement?.parentElement).toHaveClass("ui-section-header");
  });

  it("hides the resume preview after the saved resume text is cleared", () => {
    renderWorkbench({
      hasProfile: true,
      resumeFilename: "",
      resumeText: "",
      profileName: "陈露鑫"
    });

    expect(screen.getByText("还没有可用简历")).toBeInTheDocument();
    expect(screen.queryByText("陈露鑫")).not.toBeInTheDocument();
    expect(screen.queryByRole("blockquote")).not.toBeInTheDocument();
    expect(document.querySelector(".resume-source-preview")).not.toBeInTheDocument();
    expect(document.querySelector(".resume-source-excerpt")).not.toBeInTheDocument();
    expect(document.querySelector(".resume-source-card")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "去求职资料" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始分析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对照岗位" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("粘贴岗位职责、任职要求…")).not.toBeInTheDocument();
  });

  it("does not show a phone number on the match bench", () => {
    renderWorkbench({
      resumeFilename: "简历原文",
      resumeText: "陈露鑫\n求职方向：后端工程师\n13800138000\n负责接口与任务调度。",
      profileName: "小程"
    });

    expect(screen.getByText(/已保存简历 · 陈露鑫 · .+字/).textContent).not.toMatch(/13800138000/);
    expect(screen.queryByText("13800138000")).not.toBeInTheDocument();
  });

  it("shows live thinking while analysis runs and collapses when done", async () => {
    let release!: (value: QuickMatchResult) => void;
    const pending = new Promise<QuickMatchResult>((resolve) => {
      release = resolve;
    });
    const onQuickMatch = vi.fn((
      _payload: unknown,
      onEvent?: (event: {
        type: string;
        key?: string;
        title?: string;
        status?: string;
        text?: string;
        source?: string;
      }) => void
    ) => {
      onEvent?.({ type: "step", key: "direction", title: "方向匹配", status: "running", source: "local" });
      onEvent?.({ type: "thought", key: "direction", text: "在简历里找带数字的结果句" });
      return pending;
    });
    renderWorkbench({ onQuickMatch });

    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));

    const thinking = await screen.findByRole("region", { name: "思考过程" });
    expect(thinking).toHaveClass("streaming");
    expect(thinking).toHaveClass("expanded");
    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(within(thinking).getAllByText("在简历里找带数字的结果句").length).toBeGreaterThan(0);
    expect(within(thinking).getByText("正在核对方向匹配")).toBeInTheDocument();

    release(resumeOnlyResult());

    expect(await screen.findByRole("region", { name: "匹配分析结果" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "分析步骤" })).not.toBeInTheDocument();
    expect(screen.queryByText("进行中")).not.toBeInTheDocument();
  });

  it("reveals job paste only after choosing to compare against a job", () => {
    renderWorkbench();

    fireEvent.click(screen.getByRole("button", { name: "对照岗位" }));

    expect(screen.getByPlaceholderText("粘贴岗位职责、任职要求…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传截图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对照分析" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "收起岗位" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "收起岗位" }));

    expect(screen.queryByPlaceholderText("粘贴岗位职责、任职要求…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对照岗位" })).toBeInTheDocument();
  });

  it("keeps optional job comparison after a resume-only analysis", async () => {
    renderWorkbench();

    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));

    expect(await screen.findByRole("region", { name: "匹配分析结果" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "分析步骤" })).not.toBeInTheDocument();
    expect(screen.queryByText("要对照某份岗位吗？")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("粘贴岗位职责、任职要求…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对照岗位" })).toBeInTheDocument();
  });

  it("does not prompt for a job after a job-match analysis", async () => {
    renderWorkbench({ onQuickMatch: vi.fn(async () => jobMatchResult()) });

    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));

    expect(await screen.findByRole("region", { name: "匹配分析结果" })).toBeInTheDocument();
    expect(screen.queryByText("要对照某份岗位吗？")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对照具体岗位（选填）" })).not.toBeInTheDocument();
  });

  it("loads a recent job into the bench without leaving the workbench", () => {
    const onNavigateEvaluation = vi.fn();
    const onNavigateDetail = vi.fn();
    renderWorkbench({
      jobs: [sampleJob()],
      onNavigateEvaluation,
      onNavigateDetail
    });

    fireEvent.click(screen.getByRole("button", { name: /后端工程师/ }));

    expect(screen.getByPlaceholderText("粘贴岗位职责、任职要求…")).toHaveValue("负责后端开发");
    expect(screen.getByRole("button", { name: "对照分析" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "收起岗位" })).toBeInTheDocument();
    expect(onNavigateEvaluation).not.toHaveBeenCalled();
    expect(onNavigateDetail).not.toHaveBeenCalled();
  });

  it("opens the resume studio without requiring a job", () => {
    const onNavigateResume = vi.fn();
    renderWorkbench({
      jobs: [sampleJob()],
      onNavigateResume
    });

    fireEvent.click(within(screen.getByRole("navigation", { name: "求职模块" })).getByRole("button", { name: "定制简历" }));
    expect(onNavigateResume).toHaveBeenCalledWith(undefined);
  });

  it("opens the interview Q&A page from the module tab", () => {
    const onNavigateInterview = vi.fn();
    renderWorkbench({
      jobs: [sampleJob()],
      onNavigateInterview
    });

    fireEvent.click(within(screen.getByRole("navigation", { name: "求职模块" })).getByRole("button", { name: "面试问答" }));
    expect(onNavigateInterview).toHaveBeenCalledWith(undefined);
  });

  it("reopens interview Q&A from the saved resume-prep job", () => {
    const onNavigateInterview = vi.fn();
    const prepJob = sampleJob({ id: 9, job_title: "按简历准备", latest_evaluation_id: null });
    renderWorkbench({
      jobs: [sampleJob(), prepJob],
      onNavigateInterview
    });

    fireEvent.click(within(screen.getByRole("navigation", { name: "求职模块" })).getByRole("button", { name: "面试问答" }));
    expect(onNavigateInterview).toHaveBeenCalledWith(prepJob.id);
  });

  it("opens the tailored resume page from the analysis report", async () => {
    const onNavigateResume = vi.fn();
    renderWorkbench({ onNavigateResume });

    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
    expect(await screen.findByRole("region", { name: "匹配分析结果" })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("region", { name: "匹配分析结果" })).getByRole("button", { name: "定制简历" }));
    expect(onNavigateResume).toHaveBeenCalledWith(undefined);
  });

  it("writes a rewrite into the saved resume and refreshes the report", async () => {
    const onApplyResumeRewrite = vi.fn(async () => ({
      ...resumeOnlyResult(),
      analysis: {
        ...resumeOnlyResult().analysis,
        resume: {
          ...resumeOnlyResult().analysis.resume!,
          next_actions: [{ title: "把经历写具体", detail: "", evidence: "" }]
        }
      }
    }));
    renderWorkbench({ onApplyResumeRewrite });

    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
    expect(await screen.findByRole("region", { name: "匹配分析结果" })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("region", { name: "匹配分析结果" })).getAllByRole("button", { name: "采纳改写" })[0]);

    expect(onApplyResumeRewrite).toHaveBeenCalledWith({
      original: "负责接口联调。",
      suggested: "负责接口联调，【待补充：可核对的结果】。",
      job_description: "",
      job_title: "",
      company_name: ""
    });
    expect(await screen.findByText(/已写入简历并重新分析/)).toBeInTheDocument();
    expect(screen.getByText("把经历写具体")).toBeInTheDocument();
    expect(screen.queryByText("补上项目结果")).not.toBeInTheDocument();
  });

  it("shows the resume studio from a saved resume without a job analysis", () => {
    renderWorkbench({
      viewMode: "resume",
      selectedJobId: null,
      jobs: []
    });

    expect(screen.queryByRole("button", { name: "返回匹配分析" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("对照岗位")).not.toBeInTheDocument();
    const modules = screen.getByRole("navigation", { name: "求职模块" });
    expect(modules.closest(".topbar")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "匹配分析" })).not.toBeInTheDocument();
    expect(modules.closest(".resume-module-shell")).toHaveClass("is-studio");
    expect(within(modules).getByRole("button", { name: "定制简历" })).toHaveAttribute("aria-current", "page");
    expect(within(modules).getByRole("button", { name: "面试问答" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "定制简历" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "内容" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "模板" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "排版" })).toBeInTheDocument();
    expect(screen.getAllByText("个人信息").length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "定位模块" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "定位到个人概述" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "添加模块" })).toBeInTheDocument();
    expect(screen.getByLabelText("编辑个人概述")).toHaveValue("负责 AI 产品从 0 到 1。");
    expect(screen.getByText("实时预览")).toBeInTheDocument();
    expect(screen.getByLabelText("简历预览效果")).toHaveClass("style-navy");
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "排版" }));
    expect(screen.getByLabelText("简历间距")).toHaveValue("100");
    expect(screen.getByLabelText("一页模式")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "选择类型：专业单栏" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "选择类型：技术紧凑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择类型：极简单栏" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "模板" }));
    expect(screen.getByRole("button", { name: "选择模板：藏青商务" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "选择模板：松绿稳重" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择模板：墨黑衬线" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择模板：酒红专业" })).toBeInTheDocument();
    expect(screen.queryByText("还没有简历版本")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建第一个版本" })).not.toBeInTheDocument();
    expect(screen.queryByText("还没有对照过岗位")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对照岗位生成一版" })).not.toBeInTheDocument();
  });

  it("keeps job-tailored generation optional after a job has been analyzed", () => {
    renderWorkbench({
      viewMode: "resume",
      selectedJobId: 7,
      jobs: [sampleJob()]
    });

    expect(screen.getByRole("tab", { name: "内容" })).toHaveAttribute("aria-selected", "true");
    const studio = screen.getByRole("complementary", { name: "定制简历" });
    expect(within(studio).getByRole("button", { name: "导出" })).toBeInTheDocument();
    expect(within(studio).getByRole("button", { name: "对照岗位生成一版" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建版本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回匹配分析" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("对照岗位")).not.toBeInTheDocument();
  });

  it("still shows the studio when a job exists but has not been analyzed", () => {
    renderWorkbench({
      viewMode: "resume",
      selectedJobId: 7,
      jobs: [sampleJob({ latest_evaluation_id: null })]
    });

    expect(screen.getByRole("tab", { name: "内容" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("complementary", { name: "定制简历" })).getByRole("button", { name: "导出" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建版本" })).not.toBeInTheDocument();
    expect(screen.queryByText("还不能生成定制简历")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对照岗位生成一版" })).not.toBeInTheDocument();
  });

  it("creates a baseline version from the saved resume", () => {
    const onCreateResumeVersion = vi.fn();
    renderWorkbench({
      viewMode: "resume",
      onCreateResumeVersion
    });

    fireEvent.change(screen.getByLabelText("编辑个人概述"), { target: { value: "负责 AI 产品从 0 到 1。\n补充一句。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(onCreateResumeVersion).toHaveBeenCalledWith();
  });

  it("asks for an export format only after export is clicked", () => {
    const version = sampleResumeVersion();
    const onExportResume = vi.fn();
    renderWorkbench({
      viewMode: "resume",
      resumeVersions: [version],
      resumeVersion: version,
      onExportResume
    });

    expect(screen.queryByLabelText("简历版本")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "标记最终版" })).not.toBeInTheDocument();
    expect(screen.queryByText("草稿")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "DOCX" })).not.toBeInTheDocument();
    const studio = screen.getByRole("complementary", { name: "定制简历" });
    expect(within(studio).getByRole("button", { name: "导出" })).toBeInTheDocument();
    fireEvent.click(within(studio).getByRole("button", { name: "导出" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "PDF" }));
    expect(onExportResume).toHaveBeenCalledWith(version.id, "pdf");
  });

  it("saves dirty studio edits before exporting", async () => {
    const version = sampleResumeVersion();
    const onUpdateResumeChange = vi.fn();
    const onExportResume = vi.fn();
    renderWorkbench({
      viewMode: "resume",
      resumeVersions: [version],
      resumeVersion: version,
      onUpdateResumeChange,
      onExportResume
    });

    fireEvent.change(screen.getByLabelText("编辑个人概述"), { target: { value: "补充一句再导出。" } });
    expect(screen.getByText("未保存")).toBeInTheDocument();
    const studio = screen.getByRole("complementary", { name: "定制简历" });
    fireEvent.click(within(studio).getByRole("button", { name: "导出" }));
    expect(screen.getByText("会先保存未保存的修改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "PDF" }));

    await waitFor(() => {
      expect(onUpdateResumeChange).toHaveBeenCalled();
    });
    expect(onExportResume).toHaveBeenCalledWith(version.id, "pdf");
    expect(onUpdateResumeChange.mock.invocationCallOrder[0]).toBeLessThan(
      onExportResume.mock.invocationCallOrder[0]
    );
  });

  it("tightens spacing and can lock the preview to one page", () => {
    renderWorkbench({ viewMode: "resume" });

    fireEvent.click(screen.getByRole("tab", { name: "排版" }));
    fireEvent.change(screen.getByLabelText("简历间距"), { target: { value: "75" } });
    expect(screen.getByLabelText("简历预览效果")).toHaveStyle({ "--resume-page-pad": "27px" });
    fireEvent.click(screen.getByLabelText("一页模式"));
    expect(screen.getByLabelText("一页模式")).toBeChecked();
    expect(screen.getByLabelText("简历预览效果")).toHaveClass("is-one-page");
    expect(screen.getByText("一页")).toBeInTheDocument();
  });

  it("applies a template from the studio sidebar", () => {
    const onCreateResumeVersion = vi.fn();
    renderWorkbench({
      viewMode: "resume",
      onCreateResumeVersion
    });

    fireEvent.click(screen.getByRole("tab", { name: "排版" }));
    fireEvent.click(screen.getByRole("button", { name: "选择类型：技术紧凑" }));
    expect(onCreateResumeVersion).toHaveBeenCalledWith();
    expect(screen.getByRole("button", { name: "选择类型：技术紧凑" })).toHaveAttribute("aria-pressed", "true");
  });

  it("applies a visual template style from the studio sidebar", () => {
    const onCreateResumeVersion = vi.fn();
    renderWorkbench({
      viewMode: "resume",
      onCreateResumeVersion
    });

    fireEvent.click(screen.getByRole("tab", { name: "模板" }));
    fireEvent.click(screen.getByRole("button", { name: "选择模板：酒红专业" }));
    expect(onCreateResumeVersion).toHaveBeenCalledWith();
    expect(screen.getByRole("button", { name: "选择模板：酒红专业" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("简历预览效果")).toHaveClass("style-wine");
  });

  it("renders the compact template as a two-column layout", () => {
    renderWorkbench({
      viewMode: "resume",
      resumeText: `陈露鑫｜后端工程师

工作经历
示例科技｜后端工程师
负责接口与任务调度

核心技能
Python、FastAPI、PostgreSQL

教育经历
复旦大学｜计算机科学与技术`
    });

    fireEvent.click(screen.getByRole("tab", { name: "排版" }));
    fireEvent.click(screen.getByRole("button", { name: "选择类型：技术紧凑" }));
    const preview = screen.getByLabelText("简历预览效果");
    expect(within(preview).getByLabelText("简历侧栏")).toBeInTheDocument();
    expect(within(preview).getByText("技能")).toBeInTheDocument();
    expect(within(preview).getByText("工作与实习经历")).toBeInTheDocument();
    expect(within(preview).getByText("Python")).toBeInTheDocument();
  });

  it("flips a long resume one preview sheet at a time", () => {
    const entries = Array.from({ length: 8 }, (_, index) => (
      `示例科技｜后端工程师｜202${index}.01 - 202${index}.12\n负责接口与任务调度，完成服务治理与监控。\n推动单元测试与持续集成。\n协作产品完成需求拆解与上线。`
    )).join("\n\n");
    renderWorkbench({
      viewMode: "resume",
      resumeText: `陈露鑫｜后端工程师\n\n工作经历\n${entries}\n\n项目经历\n${entries}`
    });

    const papers = document.querySelectorAll(".resume-studio-canvas .resume-paper:not(.resume-paper-measure)");
    expect(papers).toHaveLength(1);
    const next = screen.getByRole("button", { name: "下一页" });
    const previous = screen.getByRole("button", { name: "上一页" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    const badge = screen.getByText(/^\d+ \/ \d+$/, { selector: ".resume-page-badge" });
    expect(badge.textContent).toMatch(/^1 \/ [2-9]\d*$/);
    fireEvent.click(next);
    expect(screen.getByText(/^2 \/ [2-9]\d*$/, { selector: ".resume-page-badge" })).toBeInTheDocument();
    expect(previous).toBeEnabled();
    fireEvent.click(previous);
    expect(screen.getByText(/^1 \/ [2-9]\d*$/, { selector: ".resume-page-badge" })).toBeInTheDocument();
    expect(previous).toBeDisabled();
  });

  it("keeps one-page mode on a single scaled sheet", () => {
    const entries = Array.from({ length: 8 }, (_, index) => (
      `示例科技｜后端工程师｜202${index}.01 - 202${index}.12\n负责接口与任务调度，完成服务治理与监控。\n推动单元测试与持续集成。\n协作产品完成需求拆解与上线。`
    )).join("\n\n");
    renderWorkbench({
      viewMode: "resume",
      resumeText: `陈露鑫｜后端工程师\n\n工作经历\n${entries}\n\n项目经历\n${entries}`
    });

    fireEvent.click(screen.getByRole("tab", { name: "排版" }));
    fireEvent.click(screen.getByLabelText("一页模式"));
    expect(screen.getByText("一页")).toBeInTheDocument();
    expect(screen.getByLabelText("简历预览效果")).toHaveClass("is-one-page");
    expect(document.querySelectorAll(".resume-studio-canvas .resume-paper")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "下一页" })).not.toBeInTheDocument();
  });

  it("lets the saved resume be edited in the preview pane", () => {
    renderWorkbench({ viewMode: "resume" });

    expect(screen.getByLabelText("编辑个人概述")).toHaveValue("负责 AI 产品从 0 到 1。");
    fireEvent.change(screen.getByLabelText("编辑个人概述"), { target: { value: "负责 AI 产品从 0 到 1。\n补充一句。" } });
    expect(within(screen.getByLabelText("简历预览效果")).getByText("补充一句。")).toBeInTheDocument();
  });

  it("edits work and project modules from the studio sidebar", () => {
    renderWorkbench({
      viewMode: "resume",
      resumeText: `陈露鑫｜后端工程师

工作经历
示例科技｜后端工程师

项目经历
CareerLoop 求职助手`
    });

    fireEvent.click(screen.getByRole("button", { name: "展开工作经历" }));
    fireEvent.click(screen.getByRole("button", { name: "展开项目经历" }));
    fireEvent.change(screen.getByLabelText("编辑工作经历 第 1 条"), { target: { value: "新公司｜后端工程师" } });
    fireEvent.change(screen.getByLabelText("编辑项目经历 项目一"), { target: { value: "新项目助手" } });
    const preview = screen.getByLabelText("简历预览效果");
    expect(within(preview).getByText("新公司｜后端工程师")).toBeInTheDocument();
    expect(within(preview).getByText("新项目助手")).toBeInTheDocument();
  });

  it("can add, remove, and reorder resume modules", () => {
    renderWorkbench({
      viewMode: "resume",
      resumeText: `陈露鑫｜后端工程师

工作经历
示例科技｜后端工程师

项目经历
CareerLoop 求职助手`
    });

    expect(screen.getByRole("heading", { name: "添加模块" })).toBeInTheDocument();
    expect(screen.getAllByText("个人信息").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "移除个人信息" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加实习经历" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加在校经历" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加荣誉证书" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加个人优势" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除项目经历" }));
    expect(screen.queryByLabelText("编辑项目经历 项目一")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("简历预览效果")).queryByText("CareerLoop 求职助手")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加项目经历" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加相关技能" }));
    fireEvent.change(screen.getByLabelText("编辑相关技能"), { target: { value: "Python、FastAPI" } });
    expect(within(screen.getByLabelText("简历预览效果")).getByText("Python")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加自定义模块" }));
    fireEvent.change(screen.getByLabelText("模块标题"), { target: { value: "开源贡献" } });
    fireEvent.change(screen.getByLabelText("编辑开源贡献"), { target: { value: "维护内部工具" } });
    expect(within(screen.getByLabelText("简历预览效果")).getByText("开源贡献")).toBeInTheDocument();
    expect(within(screen.getByLabelText("简历预览效果")).getByText("维护内部工具")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下移工作经历" }));
    fireEvent.click(screen.getByRole("button", { name: "展开工作经历" }));
    const editors = screen.getAllByLabelText(/^编辑/);
    expect(editors.map((node) => node.getAttribute("aria-label"))).toEqual([
      "编辑个人概述",
      "编辑相关技能",
      "编辑工作经历 第 1 条",
      "编辑开源贡献"
    ]);
  });

  it("collapses resume modules to a one-line summary", () => {
    renderWorkbench({
      viewMode: "resume",
      resumeText: `陈露鑫｜后端工程师

工作经历
示例科技｜后端工程师

项目经历
CareerLoop 求职助手`
    });

    expect(screen.queryByLabelText("编辑工作经历 第 1 条")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("编辑项目经历 项目一")).not.toBeInTheDocument();
    const modules = screen.getByRole("list", { name: "已添加模块" });
    expect(within(modules).getByText("示例科技｜后端工程师")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开工作经历" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开项目经历" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开工作经历" }));
    expect(screen.getByLabelText("编辑工作经历 第 1 条")).toBeInTheDocument();
    expect(screen.queryByLabelText("编辑项目经历 项目一")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全部收起" }));
    expect(screen.queryByLabelText("编辑工作经历 第 1 条")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("编辑项目经历 项目一")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全部展开" }));
    expect(screen.getByLabelText("编辑工作经历 第 1 条")).toBeInTheDocument();
    expect(screen.getByLabelText("编辑项目经历 项目一")).toBeInTheDocument();
  });

  it("keeps an expanded module after switching template and layout tabs", () => {
    renderWorkbench({
      viewMode: "resume",
      resumeText: `陈露鑫｜后端工程师

工作经历
示例科技｜后端工程师`
    });

    fireEvent.click(screen.getByRole("button", { name: "展开工作经历" }));
    expect(screen.getByLabelText("编辑工作经历 第 1 条")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "模板" }));
    expect(document.getElementById("resume-studio-panel-modules")).toHaveAttribute("hidden");
    expect(screen.getByLabelText("编辑工作经历 第 1 条")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "排版" }));
    fireEvent.click(screen.getByRole("tab", { name: "内容" }));
    expect(document.getElementById("resume-studio-panel-modules")).not.toHaveAttribute("hidden");
    expect(screen.getByLabelText("编辑工作经历 第 1 条")).toBeInTheDocument();
  });

  it("jumps to a collapsed module from the locator chips", () => {
    renderWorkbench({
      viewMode: "resume",
      resumeText: `陈露鑫｜后端工程师

工作经历
示例科技｜后端工程师
负责接口与任务调度，并把结果写清楚。`
    });

    expect(screen.queryByLabelText("编辑工作经历 第 1 条")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "定位到工作经历" }));
    expect(screen.getByLabelText("编辑工作经历 第 1 条")).toBeInTheDocument();
    expect(screen.getByText("正在看：工作经历")).toBeInTheDocument();
  });

  it("shows unsaved status and highlights the preview section being edited", () => {
    renderWorkbench({ viewMode: "resume" });

    fireEvent.change(screen.getByLabelText("编辑个人概述"), { target: { value: "负责 AI 产品从 0 到 1。\n补充一句。" } });
    expect(screen.getByText("未保存")).toBeInTheDocument();
    expect(screen.getByText("预览已更新")).toBeInTheDocument();
    fireEvent.focus(screen.getByLabelText("编辑个人概述"));
    expect(screen.getByText("正在看：个人概述")).toBeInTheDocument();
    expect(document.querySelector('[data-resume-section="summary"]')).toHaveClass("is-preview-focus");
  });

  it("edits individual project entries in the studio sidebar", () => {
    renderWorkbench({
      viewMode: "resume",
      resumeText: `陈露鑫｜后端工程师

项目经历
CareerLoop 求职助手`
    });

    fireEvent.click(screen.getByRole("button", { name: "展开项目经历" }));
    expect(screen.getByText("项目一")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("编辑项目经历 项目一"), { target: { value: "新项目助手" } });
    expect(within(screen.getByLabelText("简历预览效果")).getByText("新项目助手")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加项目" }));
    expect(screen.getByText("项目二")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("编辑项目经历 项目二"), { target: { value: "第二个项目" } });
    const preview = screen.getByLabelText("简历预览效果");
    expect(within(preview).getByText("新项目助手")).toBeInTheDocument();
    expect(within(preview).getByText("第二个项目")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加实习经历" }));
    expect(screen.getByText("留空时导出会跳过这个模块")).toBeInTheDocument();
  });

  it("warns that an empty module is skipped on export", () => {
    renderWorkbench({ viewMode: "resume" });

    fireEvent.click(screen.getByRole("button", { name: "添加相关技能" }));
    expect(screen.getByText("留空时导出会跳过这个模块")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("编辑相关技能"), { target: { value: "Python、FastAPI" } });
    expect(screen.queryByText("留空时导出会跳过这个模块")).not.toBeInTheDocument();
  });

  it("can optionally tailor a version to an analyzed job", () => {
    const onCreateResumeVersion = vi.fn();
    const job = sampleJob();
    renderWorkbench({
      viewMode: "resume",
      selectedJobId: job.id,
      jobs: [job],
      onCreateResumeVersion
    });

    fireEvent.click(screen.getByRole("button", { name: "对照岗位生成一版" }));
    expect(onCreateResumeVersion).toHaveBeenCalledWith(job);
  });

  it("returns to analysis from the resume module tab", () => {
    const onNavigateIndex = vi.fn();
    renderWorkbench({
      viewMode: "resume",
      onNavigateIndex
    });

    fireEvent.click(within(screen.getByRole("navigation", { name: "求职模块" })).getByRole("button", { name: "匹配分析" }));
    expect(onNavigateIndex).toHaveBeenCalledOnce();
  });

  it("asks to save a resume before generating interview Q&A", () => {
    const onOpenProfile = vi.fn();
    renderWorkbench({
      viewMode: "interview",
      resumeFilename: "",
      resumeText: "",
      onOpenProfile
    });

    expect(screen.getByText("还没有保存简历")).toBeInTheDocument();
    expect(screen.getByText("先在求职资料里上传并保存简历，再生成面试问答。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "去求职资料" }));
    expect(onOpenProfile).toHaveBeenCalled();
    expect(screen.queryByRole("heading", { level: 1, name: "匹配分析" })).not.toBeInTheDocument();
    const modules = screen.getByRole("navigation", { name: "求职模块" });
    expect(modules.closest(".resume-module-shell")).toHaveClass("is-interview");
    expect(within(modules).getByRole("button", { name: "面试问答" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByLabelText("对照岗位")).not.toBeInTheDocument();
  });

  it("creates interview Q&A from a saved resume and selected job", () => {
    const onCreateInterviewKit = vi.fn();
    const job = sampleJob();
    renderWorkbench({
      viewMode: "interview",
      selectedJobId: job.id,
      jobs: [job],
      onCreateInterviewKit
    });

    expect(screen.getByRole("heading", { name: "从一个具体问题开始。" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成面试问答" }));
    expect(onCreateInterviewKit).toHaveBeenCalledWith(job, "general");
  });

  it("can generate interview Q&A for a selected job that has not been analyzed", () => {
    const onCreateInterviewKit = vi.fn();
    const job = sampleJob({ latest_evaluation_id: null });
    renderWorkbench({
      viewMode: "interview",
      selectedJobId: job.id,
      jobs: [job],
      onCreateInterviewKit
    });

    expect(screen.getByText("按已保存简历出题。生成预测问题、STAR 讲法和追问；导入岗位后可以再出一版。")).toBeInTheDocument();
    expect(screen.queryByLabelText("对照岗位")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "去匹配分析" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "按简历生成" }));
    expect(onCreateInterviewKit).toHaveBeenCalledWith(job, "general");
  });

  it("can generate interview Q&A from a saved resume when there are no jobs", async () => {
    const created = sampleJob({ latest_evaluation_id: null, job_title: "按简历准备" });
    const onSaveJob = vi.fn().mockResolvedValue(created);
    const onCreateInterviewKit = vi.fn();
    const onNavigateInterview = vi.fn();
    renderWorkbench({
      viewMode: "interview",
      jobs: [],
      selectedJobId: null,
      onSaveJob,
      onCreateInterviewKit,
      onNavigateInterview
    });

    expect(screen.getByText("按已保存简历出题。生成预测问题、STAR 讲法和追问；导入岗位后可以再出一版。")).toBeInTheDocument();
    expect(screen.queryByLabelText("对照岗位")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "去匹配分析" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "按简历生成" }));
    await waitFor(() => {
      expect(onSaveJob).toHaveBeenCalled();
      expect(onCreateInterviewKit).toHaveBeenCalledWith(created, "general");
    });
    expect(onNavigateInterview).toHaveBeenCalledWith(created.id);
  });

  it("can generate interview Q&A from a saved resume even when jobs exist", async () => {
    const created = sampleJob({ latest_evaluation_id: null, job_title: "按简历准备" });
    const onSaveJob = vi.fn().mockResolvedValue(created);
    const onCreateInterviewKit = vi.fn();
    const onNavigateInterview = vi.fn();
    renderWorkbench({
      viewMode: "interview",
      jobs: [sampleJob()],
      selectedJobId: null,
      onSaveJob,
      onCreateInterviewKit,
      onNavigateInterview
    });

    expect(screen.queryByLabelText("对照岗位")).not.toBeInTheDocument();
    expect(screen.getByText("按已保存简历出题。生成预测问题、STAR 讲法和追问；导入岗位后可以再出一版。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "按简历生成" }));
    await waitFor(() => {
      expect(onSaveJob).toHaveBeenCalled();
      expect(onCreateInterviewKit).toHaveBeenCalledWith(created, "general");
    });
    expect(onNavigateInterview).toHaveBeenCalledWith(created.id);
  });

  it("surfaces resume-prep, resume blocks, and a conversation to continue", () => {
    const onOpenChat = vi.fn();
    const onSaveJob = vi.fn();
    renderWorkbench({
      viewMode: "interview",
      resumeText: "项目经历\n任务调度系统\n负责接口与任务调度",
      jobs: [sampleJob()],
      selectedJobId: 7,
      conversations: [{
        id: 4,
        title: "追问任务调度",
        status: "active",
        summary: "",
        message_count: 3,
        updated_at: "2026-01-02T00:00:00Z",
        last_message_at: "2026-01-02T00:00:00Z"
      }],
      onOpenChat,
      onSaveJob
    });

    expect(screen.getByRole("heading", { name: "从一个具体问题开始。" })).toBeInTheDocument();
    expect(screen.getByLabelText("题目来源")).toHaveTextContent("示例 · 后端工程师");
    expect(screen.getByRole("button", { name: /按简历准备/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "任务调度系统" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /继续上次对话/ }));
    expect(onOpenChat).toHaveBeenCalledWith(4);
    expect(onSaveJob).not.toHaveBeenCalled();
  });

  it("reopens the last interview kit without asking to generate again", () => {
    const kit = sampleInterviewKit();
    renderWorkbench({
      viewMode: "interview",
      selectedJobId: null,
      jobs: [sampleJob({ job_title: "按简历准备", latest_evaluation_id: null })],
      interviewKits: [kit],
      interviewKit: kit
    });

    expect(screen.getByRole("heading", { name: "讲一个你做过的后端项目" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "从一个具体问题开始。" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "按简历生成" })).not.toBeInTheDocument();
  });

  it("does not flash the generate button while restoring a saved interview kit", () => {
    renderWorkbench({
      viewMode: "interview",
      selectedJobId: null,
      interviewBusy: true
    });

    expect(screen.getByText("正在打开面试问答")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "从一个具体问题开始。" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "按简历生成" })).not.toBeInTheDocument();
  });

  it("restores an existing interview kit instead of generating another copy", async () => {
    const kit = sampleInterviewKit();
    const onCreateInterviewKit = vi.fn();
    const onSelectInterviewKit = vi.fn();
    const onNavigateInterview = vi.fn();
    renderWorkbench({
      viewMode: "interview",
      selectedJobId: null,
      jobs: [sampleJob({ job_title: "按简历准备", latest_evaluation_id: null })],
      interviewKits: [kit],
      onCreateInterviewKit,
      onSelectInterviewKit,
      onNavigateInterview
    });

    fireEvent.click(screen.getByRole("button", { name: /继续上次练习/ }));
    await waitFor(() => {
      expect(onNavigateInterview).toHaveBeenCalledWith(kit.job_id);
      expect(onSelectInterviewKit).toHaveBeenCalledWith(kit.id);
    });
    expect(onCreateInterviewKit).not.toHaveBeenCalled();
  });

  it("shows interview questions, STAR guidance, and follow-ups from a kit", () => {
    const kit = sampleInterviewKit();
    renderWorkbench({
      viewMode: "interview",
      selectedJobId: 7,
      jobs: [sampleJob()],
      interviewKits: [kit],
      interviewKit: kit
    });

    expect(screen.queryByLabelText("对照岗位")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "讲一个你做过的后端项目" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("回答：讲一个你做过的后端项目"), {
      target: { value: "我负责过接口和调度。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "查看参考讲法" }));
    expect(screen.getByText(/用 STAR 讲接口与调度/)).toBeInTheDocument();
    expect(screen.getByText("任务调度")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "问面试官" }));
    expect(screen.getByText("团队接下来最看重什么？")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "匹配分析" })).not.toBeInTheDocument();
    expect(screen.queryByText("用真实经历准备重点问答")).not.toBeInTheDocument();
  });

  it("asks to save a resume before using the studio", () => {
    const onOpenProfile = vi.fn();
    renderWorkbench({
      viewMode: "resume",
      resumeFilename: "",
      resumeText: "",
      onOpenProfile
    });

    expect(screen.getByText("还没有保存简历")).toBeInTheDocument();
    expect(screen.getByText("先在求职资料里上传并保存简历，再选择类型和模板编辑和导出。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "去求职资料" }));
    expect(onOpenProfile).toHaveBeenCalled();
    expect(screen.queryByText("还没有对照过岗位")).not.toBeInTheDocument();
  });
});
