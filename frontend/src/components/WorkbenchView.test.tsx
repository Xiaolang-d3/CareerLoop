import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuickMatchResult } from "../types";
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
        headline: { verdict: "能看出你会 Python。", evidence: "使用 Python 完成内部工具。" },
        strengths: [{ label: "Python", evidence: "使用 Python 完成内部工具。" }],
        structure: { found: ["项目经历"], missing: [] },
        projects: [],
        gaps: [],
        next_actions: [{ title: "补上项目结果", detail: "", evidence: "" }]
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

function renderWorkbench(
  overrides: Partial<ComponentProps<typeof WorkbenchView>> = {}
) {
  const props: ComponentProps<typeof WorkbenchView> = {
    viewMode: "index",
    hasProfile: true,
    resumeFilename: "cv.pdf",
    resumeText: "负责 AI 产品从 0 到 1。",
    profileName: "张三",
    resumeLoading: false,
    chatBusy: false,
    jobBusy: false,
    jobImportBusy: false,
    jobImportActivity: [],
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
    onNavigateEvaluation: vi.fn(),
    onCreateComparison: vi.fn(),
    onQuickMatch: vi.fn(async () => resumeOnlyResult()),
    onSaveJob: vi.fn(),
    onPreviewJobUrl: vi.fn(),
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
    ...overrides
  };
  return render(<WorkbenchView {...props} />);
}

describe("WorkbenchView 简历分析工作台", () => {
  it("shows a resume card and report outline without a job form", () => {
    renderWorkbench();

    expect(screen.getByRole("heading", { name: "cv.pdf" })).toBeInTheDocument();
    expect(screen.getByText(/字 · 已保存，可分析/)).toBeInTheDocument();
    expect(screen.getByText("负责 AI 产品从 0 到 1。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "将分析" })).toBeInTheDocument();
    expect(screen.getByText("第一印象")).toBeInTheDocument();
    expect(screen.getByText("能证明什么")).toBeInTheDocument();
    expect(screen.getByText("项目怎么讲")).toBeInTheDocument();
    expect(screen.getByText("先改哪里")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对照具体岗位（选填）" })).not.toBeInTheDocument();
    expect(screen.queryByText("要对照某份岗位吗？")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("例如：AI 产品经理")).not.toBeInTheDocument();
  });

  it("asks about a job only after a resume-only analysis", async () => {
    renderWorkbench();

    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));

    expect(await screen.findByRole("region", { name: "简历分析结果" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "将分析" })).not.toBeInTheDocument();
    expect(screen.getByText("要对照某份岗位吗？")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("例如：AI 产品经理")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "填写岗位" }));

    expect(screen.getByPlaceholderText("例如：AI 产品经理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对照分析" })).toBeInTheDocument();
  });

  it("does not prompt for a job after a job-match analysis", async () => {
    renderWorkbench({ onQuickMatch: vi.fn(async () => jobMatchResult()) });

    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));

    await waitFor(() => {
      expect(screen.getByText("对照这份岗位")).toBeInTheDocument();
    });
    expect(screen.queryByText("要对照某份岗位吗？")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对照具体岗位（选填）" })).not.toBeInTheDocument();
  });
});
