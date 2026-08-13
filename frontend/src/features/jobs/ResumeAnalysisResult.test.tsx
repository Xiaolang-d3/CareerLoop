import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuickMatchResult } from "../../types";
import { ResumeAnalysisResult } from "./ResumeAnalysisResult";

function result(overrides: Partial<QuickMatchResult["analysis"]> = {}): QuickMatchResult {
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
        headline: {
          verdict: "能看出你会 Python，但缺少可展开的项目段落。",
          evidence: "使用 Python 完成内部工具。"
        },
        strengths: [{ label: "Python", evidence: "使用 Python 完成内部工具。" }],
        structure: { found: ["项目经历"], missing: ["教育经历"] },
        projects: [{
          title: "内部工具",
          evidence: "使用 Python 完成内部工具。",
          how_to_talk: "用这段经历讲清你负责的部分、决策和结果，避免只报项目名。",
          weak: false
        }],
        gaps: ["结构上缺少：教育经历。"],
        next_actions: [{
          title: "补上简历模块：教育经历",
          detail: "去个人资料把缺失模块写进去，分析才能引用原句。",
          evidence: ""
        }]
      },
      ...overrides
    }
  };
}

describe("ResumeAnalysisResult", () => {
  it("shows resume-centered analysis without a job", () => {
    render(<ResumeAnalysisResult result={result()} />);
    expect(screen.getByRole("heading", { name: "能看出你会 Python，但缺少可展开的项目段落。" })).toBeInTheDocument();
    expect(screen.getByText("第一印象")).toBeInTheDocument();
    expect(screen.getByText("能证明什么")).toBeInTheDocument();
    expect(screen.getByText("项目怎么讲")).toBeInTheDocument();
    expect(screen.getByText("先改哪里")).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("内部工具")).toBeInTheDocument();
    expect(screen.getByText("补上简历模块：教育经历")).toBeInTheDocument();
    expect(screen.getAllByText(/简历原句：使用 Python 完成内部工具。/).length).toBeGreaterThan(0);
    expect(screen.queryByText("对照这份岗位")).not.toBeInTheDocument();
  });

  it("adds match and gaps when a job is present", () => {
    render(<ResumeAnalysisResult result={{
      ...result({
        mode: "job_match",
        matched_skills: ["Python"],
        missing_skills: ["Kubernetes"],
        skill_coverage: 50,
        evidence: [{ skills: ["Python"], text: "使用 Python 完成内部工具。" }],
        resume: {
          ...result().analysis.resume!,
          headline: {
            verdict: "对照这份岗位，简历能用原句证明 Python；还缺 Kubernetes 的证据。",
            evidence: "使用 Python 完成内部工具。"
          },
          next_actions: [{
            title: "补上岗位还缺的原句：Kubernetes",
            detail: "有做过就在个人资料里写成一句可核对的经历；没做过不要编。",
            evidence: ""
          }]
        }
      }),
      job: { title: "后端工程师", company_name: "示例", description_character_count: 40 }
    }} />);
    expect(screen.getByText("对照这份岗位")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText("技能覆盖 50%")).toBeInTheDocument();
    expect(screen.getByText("补上岗位还缺的原句：Kubernetes")).toBeInTheDocument();
  });

  it("sends the user to edit the saved resume", () => {
    const onEditProfile = vi.fn();
    render(<ResumeAnalysisResult result={result()} onEditProfile={onEditProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "去个人资料改简历" }));
    expect(onEditProfile).toHaveBeenCalledOnce();
  });
});
