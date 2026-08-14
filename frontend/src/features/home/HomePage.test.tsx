import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTopBar } from "../../components/AppTopBar";
import type { JobProject } from "../../types";
import { HomePage } from "./HomePage";
import { isSettingsProfileReady, latestJobAnalysisAt, profileCompleteness, splitHomeTags } from "./home-metrics";

afterEach(cleanup);

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
    ...overrides
  };
  render(<HomePage {...props} />);
  return props;
}

describe("home-metrics", () => {
  it("counts filled profile fields without inventing a score", () => {
    expect(splitHomeTags("Python，FastAPI, React")).toEqual(["Python", "FastAPI", "React"]);
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
});

describe("HomePage", () => {
  it("shows a profile greeting and honest metrics without analysis data", () => {
    renderHome();

    expect(screen.getByRole("heading", { name: "你好，张三" })).toBeInTheDocument();
    expect(screen.getByText("目标方向：后端工程师")).toBeInTheDocument();
    expect(screen.getByText("简历")).toBeInTheDocument();
    expect(screen.getByText(String("一段已保存的简历文本。".length))).toBeInTheDocument();
    expect(screen.getByText("cv.pdf · 字")).toBeInTheDocument();
    expect(screen.getByText("岗位项目")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("还没有岗位")).toBeInTheDocument();
    expect(screen.getByText("最近分析")).toBeInTheDocument();
    expect(screen.getByText("暂无")).toBeInTheDocument();
    expect(screen.getAllByText("资料完整度").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("100%")).not.toHaveLength(0);
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("FastAPI")).toBeInTheDocument();
    expect(screen.queryByText("求职流程阶段")).not.toBeInTheDocument();
    expect(screen.queryByText("最近任务")).not.toBeInTheDocument();
  });

  it("uses a calm empty state when profile and jobs are not ready yet", () => {
    renderHome({
      profileName: "",
      targetRole: "",
      resumeText: "",
      skills: "",
      profileLoaded: false,
      jobsLoaded: false,
      jobs: []
    });

    expect(screen.getByRole("heading", { name: "你好，小林" })).toBeInTheDocument();
    expect(screen.getByText("完善个人资料后，这里会显示你的求职方向。")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("资料尚未读取")).toBeInTheDocument();
    expect(screen.getByText("计数稍后更新")).toBeInTheDocument();
    expect(screen.getByText("资料读取后会显示完整度。")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("正在加载")).not.toBeInTheDocument();
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
        <AppTopBar title="首页" userEmail={props.email} onOpenProfile={props.onOpenProfile} onLogout={vi.fn()} />
        <HomePage {...props} />
      </section>
    );

    const bar = document.querySelector("header.app-topbar");
    expect(bar).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "首页" })).toBeInTheDocument();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "账号菜单" }).closest(".app-topbar")).toBe(bar);
    expect(screen.getByRole("heading", { name: "你好，张三" }).closest(".app-topbar")).toBeNull();
  });

  it("only renders the weekly report card once an authenticated api context is available", async () => {
    renderHome();
    expect(screen.queryByText("本周求职进展")).not.toBeInTheDocument();

    const emptyMetrics = {
      discovered_jobs: 0,
      top_companies: [],
      saved_jobs: 0,
      applications_submitted: 0,
      entered_interview: 0,
      offers: 0,
      rejections: 0,
      evaluations_completed: 0,
      average_match_score: null,
      scans_completed: 0
    };
    const overview = {
      current: {
        period_start: "2026-08-10",
        period_end: "2026-08-17",
        metrics: emptyMetrics,
        highlights: ["本周没有新的求职活动记录，可以启用机会来源自动扫描或手动添加岗位。"],
        is_partial: true,
        generated_at: null
      },
      history: []
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(overview), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })));
    renderHome({ apiBase: "http://localhost:8000", accessToken: "token" });
    expect(screen.getByText("本周求职进展")).toBeInTheDocument();
    expect(await screen.findByText(/本周没有新的求职活动记录/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("links to the three workspaces and profile settings", () => {
    const props = renderHome({ jobs: [sampleJob()] });

    fireEvent.click(screen.getAllByRole("button", { name: /去分析简历/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /去定制简历/ }));
    fireEvent.click(screen.getByRole("button", { name: /去面试问答/ }));
    fireEvent.click(screen.getByRole("button", { name: "完善个人资料" }));

    expect(props.onOpenAnalysis).toHaveBeenCalledOnce();
    expect(props.onOpenResume).toHaveBeenCalledOnce();
    expect(props.onOpenInterview).toHaveBeenCalledOnce();
    expect(props.onOpenProfile).toHaveBeenCalledOnce();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("1 个高优先级")).toBeInTheDocument();
  });
});
