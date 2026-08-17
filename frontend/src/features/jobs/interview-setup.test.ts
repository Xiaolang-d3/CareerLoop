import { afterEach, describe, expect, it } from "vitest";
import type { JobProject } from "../../types";
import { saveInterviewPractice } from "./interview-practice";
import {
  interviewSetupJobs,
  latestStartedKitId,
  matchQuestionId,
  resumeInterviewTopics,
  saveInterviewDrillFocus,
  takeInterviewDrillFocus
} from "./interview-setup";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
    priority: "medium",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    latest_evaluation_id: 3,
    ...overrides
  };
}

describe("interview setup helpers", () => {
  it("reads project and skill chips from a saved resume", () => {
    expect(resumeInterviewTopics(`项目经历
任务调度系统
负责接口与任务调度

相关技能
Python、FastAPI、PostgreSQL`)).toEqual({
      projects: ["任务调度系统"],
      skills: ["Python", "FastAPI", "PostgreSQL"]
    });
  });

  it("puts 按简历准备 first and keeps a selected job visible", () => {
    const jobs = interviewSetupJobs([
      sampleJob(),
      sampleJob({ id: 9, job_title: "按简历准备", company_name: "", latest_evaluation_id: null })
    ], 7);
    expect(jobs[0]).toMatchObject({ label: "按简历准备", resumePrep: true, id: 9 });
    expect(jobs.some((item) => item.id === 7 && item.label === "示例 · 后端工程师")).toBe(true);
  });

  it("prefers a kit the candidate already started", () => {
    saveInterviewPractice(31, { answers: { q1: "已写" }, practiced: ["q1"], currentId: "q1" });
    expect(latestStartedKitId([12, 31])).toBe(31);
    expect(latestStartedKitId([12])).toBe(12);
  });

  it("stores a one-shot drill focus for the next opened kit", () => {
    saveInterviewDrillFocus({ category: "project", query: "任务调度系统" });
    expect(takeInterviewDrillFocus()).toEqual({ category: "project", query: "任务调度系统" });
    expect(takeInterviewDrillFocus()).toBeNull();
  });

  it("matches a question by resume project title or category", () => {
    const questions = [
      { id: "q1", question: "请用一分钟介绍你自己", category: "intro" as const },
      { id: "q2", question: "讲一下任务调度系统", category: "project" as const }
    ];
    expect(matchQuestionId(questions, { query: "任务调度系统" })).toBe("q2");
    expect(matchQuestionId(questions, { category: "intro" })).toBe("q1");
  });
});
