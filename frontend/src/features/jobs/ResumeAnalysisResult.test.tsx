import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuickMatchResult } from "../../types";
import { ResumeAnalysisResult } from "./ResumeAnalysisResult";

afterEach(cleanup);

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
          verdict: "招聘方会记住「把整理时间降低 35%」；Python 只出现在技能清单，三十秒里容易被跳过。",
          evidence: "使用 FastAPI 完成岗位分析接口，将整理时间降低 35%。",
          remember: "把整理时间降低 35%",
          skip: "Python 只出现在技能清单",
          block_id: "project-demo"
        },
        blocks: [{ id: "project-demo", kind: "project", title: "内部工具" }],
        checklist: [
          { key: "direction", title: "方向匹配", question: "意向是否对得上", status: "pass", summary: "张三 · 后端工程师。这次没有对照具体岗位。", next_action: { label: "按这个意向定制简历", intent: "customize_resume", detail: "意向来自简历。" }, block_ids: [] },
          { key: "project_evidence", title: "项目证据", question: "有没有原句", status: "pass", summary: "核对了 1 个项目块，其中有可引用原句。", next_action: { label: "按项目块准备面试", intent: "interview_prep", detail: "只引用已切出的项目块。" }, block_ids: ["project-demo"] },
          { key: "quantified", title: "量化结果", question: "有没有数字", status: "pass", summary: "1 条经历带可核对数字，例如「将整理时间降低 35%」。", next_action: { label: "按这些数字准备面试追问", intent: "interview_prep", detail: "数字来自简历原句。" }, block_ids: ["project-demo"], evidence: "将整理时间降低 35%。" },
          { key: "risks", title: "风险/缺口", question: "缺什么", status: "warn", summary: "结构上看不到教育经历", next_action: { label: "去核对缺口，不要编事实", intent: "confirm_knowledge", detail: "没做过不要写成做过。" }, block_ids: [] },
          { key: "next_step", title: "下一步", question: "先做什么", status: "warn", summary: "补上简历模块：教育经历", next_action: { label: "补上简历模块：教育经历", intent: "edit_profile", detail: "去个人资料补模块。" }, block_ids: [] }
        ],
        scan: {
          identity: "张三",
          target: "后端工程师",
          headline_skills: ["Python", "FastAPI"],
          remember: ["把整理时间降低 35%"],
          skip: ["Python 只出现在技能清单", "结构上还看不到教育经历"],
          completeness: {
            present: 3,
            total: 5,
            modules: [
              { key: "教育", present: false },
              { key: "工作", present: false },
              { key: "项目", present: true },
              { key: "技能", present: true },
              { key: "成果", present: true }
            ]
          },
          proof: {
            label: "有可核对数字",
            character_count: 80,
            metric_lines: 1,
            evidence_lines: 2,
            skill_dump_lines: 1
          }
        },
        strengths: [{
          label: "岗位分析接口（FastAPI）",
          evidence: "负责简历解析与匹配结果展示。",
          skills: ["FastAPI"]
        }, { label: "Python", evidence: "" }],
        evidence_matrix: [
          {
            bucket: "后端服务",
            rows: [
              { skill: "FastAPI", evidence: "负责简历解析与匹配结果展示。", strength: "proven", block_id: "project-demo" },
              { skill: "Python", evidence: "", strength: "mentioned" }
            ]
          }
        ],
        structure: { found: ["项目经历"], missing: ["教育经历"] },
        talking_source: "project",
        projects: [{
          title: "内部工具",
          block_id: "project-demo",
          evidence: "内部工具\n- 使用 FastAPI 完成岗位分析接口，将整理时间降低 35%。",
          how_to_talk: "面试按 STAR 讲：情境是「内部工具」；行动是「使用 FastAPI 完成岗位分析接口」；结果是「将整理时间降低 35%」。",
          weak: false,
          holes: ["缺协作：和谁对接、你在链路里的位置"],
          star: {
            situation: "内部工具",
            task: "",
            action: "使用 FastAPI 完成岗位分析接口",
            result: "将整理时间降低 35%"
          },
          rewrite: {
            original: "负责简历解析与匹配结果展示。",
            suggested: "负责简历解析与匹配结果展示，【待补充：可核对的结果，如耗时/准确率/覆盖量】。",
            caveat: "数字未知就写待补充，不要编造。"
          }
        }],
        gaps: ["结构上缺少：教育经历。"],
        next_actions: [{
          title: "补上简历模块：教育经历",
          detail: "去个人资料把缺失模块写进去，分析才能引用原句。",
          evidence: "",
          intent: "edit_profile",
          why: "招聘方扫结构时看不到这些模块，分析也引用不到原句。",
          where: "简历结构",
          effect: "补上后分析能引用原句，面试也有段落可讲。"
        }, {
          title: "给「内部工具」补结果或职责",
          detail: "可先改成带待补充的结果。",
          evidence: "负责简历解析与匹配结果展示。",
          kind: "rewrite",
          why: "这段经历还缺结果或职责边界，三十秒里站不住。",
          where: "项目经历 · 内部工具",
          effect: "面试能按 STAR 讲完；数字不知道就标待补充。",
          patch: {
            original: "负责简历解析与匹配结果展示。",
            suggested: "负责简历解析与匹配结果展示，【待补充：可核对的结果，如耗时/准确率/覆盖量】。"
          }
        }]
      },
      ...overrides
    }
  };
}

describe("ResumeAnalysisResult", () => {
  it("shows resume-centered analysis without a job", () => {
    render(<ResumeAnalysisResult result={result()} />);
    expect(screen.getByRole("heading", { name: /招聘方会记住「把整理时间降低 35%」/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "方向匹配" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目证据" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "量化结果" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "风险/缺口" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "下一步" })).toBeInTheDocument();
    expect(screen.getByText("会记住")).toBeInTheDocument();
    expect(screen.getByText("容易跳过")).toBeInTheDocument();
    expect(screen.getByText("张三 · 后端工程师")).toBeInTheDocument();
    expect(screen.queryByText("完整度 3/5")).not.toBeInTheDocument();
    expect(screen.queryByText("教育无")).not.toBeInTheDocument();
    expect(screen.queryByText("项目有")).not.toBeInTheDocument();
    expect(screen.getByText(/证据密度 有可核对数字/)).toBeInTheDocument();
    expect(screen.getByText("后端服务")).toBeInTheDocument();
    expect(screen.getByText("已证明")).toBeInTheDocument();
    expect(screen.getByText("仅提及")).toBeInTheDocument();
    expect(screen.getByText("未见原句")).toBeInTheDocument();
    expect(screen.getAllByText("内部工具").length).toBeGreaterThan(0);
    expect(screen.getByText("情境")).toBeInTheDocument();
    expect(screen.getByText("未见明确任务")).toBeInTheDocument();
    expect(screen.getAllByText(/将整理时间降低 35%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("补上简历模块：教育经历").length).toBeGreaterThan(0);
    expect(screen.getAllByText("为什么").length).toBeGreaterThan(0);
    expect(screen.getByText("简历结构")).toBeInTheDocument();
    expect(screen.getByText(/面试按 STAR 讲/)).toBeInTheDocument();
    expect(screen.getByText("改写示例")).toBeInTheDocument();
    expect(screen.getByText(/【待补充：可核对的结果/)).toBeInTheDocument();
    expect(screen.getByText("使用 FastAPI 完成岗位分析接口，将整理时间降低 35%。")).toBeInTheDocument();
    expect(screen.getAllByText("仅已保存简历").length).toBeGreaterThan(0);
    expect(screen.getByText("有限")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "核对清单" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /方向匹配/ })).toHaveAttribute("href", "#analysis-01");
    expect(screen.getAllByText("简历原句 · 内部工具").length).toBeGreaterThan(0);
    expect(screen.queryByText("对照这份岗位")).not.toBeInTheDocument();
  });

  it("does not reuse the same resume quote in the first two sections", () => {
    const legacy = result({
      resume: {
        ...result().analysis.resume!,
        scan: undefined,
        evidence_matrix: []
      }
    });
    render(<ResumeAnalysisResult result={legacy} />);
    const articles = screen.getByRole("region", { name: "匹配分析结果" }).querySelectorAll("article");
    const texts = [...articles[0].querySelectorAll("blockquote"), ...articles[1].querySelectorAll("blockquote")]
      .map((node) => node.textContent);
    expect(texts.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(texts.length);
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
            verdict: "对照这份岗位，三十秒能记住 Python；还缺 Kubernetes 的可核对原句，投递前先补或拿掉。",
            evidence: "使用 FastAPI 完成岗位分析接口，将整理时间降低 35%。",
            remember: "把整理时间降低 35%",
            skip: "岗位还要 Kubernetes，简历里没有原句"
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
    expect(screen.getByRole("heading", { name: "对照这份岗位" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /方向匹配/ })).toHaveAttribute("href", "#analysis-01");
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText("技能覆盖 50%")).toBeInTheDocument();
    expect(screen.getByText("补上岗位还缺的原句：Kubernetes")).toBeInTheDocument();
  });

  it("sends the user to edit the saved resume", () => {
    const onEditProfile = vi.fn();
    render(<ResumeAnalysisResult result={result()} onEditProfile={onEditProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "去求职资料改简历" }));
    expect(onEditProfile).toHaveBeenCalledOnce();
  });

  it("opens the tailored resume page from the analysis report", () => {
    const onCustomizeResume = vi.fn();
    render(<ResumeAnalysisResult result={result()} onCustomizeResume={onCustomizeResume} />);
    fireEvent.click(screen.getAllByRole("button", { name: "定制简历" })[0]);
    expect(onCustomizeResume).toHaveBeenCalledOnce();
  });

  it("sends the user to interview prep from a checklist next action", () => {
    const onPrepareInterview = vi.fn();
    render(<ResumeAnalysisResult result={result()} onPrepareInterview={onPrepareInterview} />);
    fireEvent.click(screen.getAllByRole("button", { name: "准备面试" })[0]);
    expect(onPrepareInterview).toHaveBeenCalledOnce();
  });

  it("applies a rewrite from the next-action list", () => {
    const onApplyRewrite = vi.fn();
    render(<ResumeAnalysisResult result={result()} onApplyRewrite={onApplyRewrite} onEditProfile={() => undefined} />);
    fireEvent.click(screen.getAllByRole("button", { name: "采纳改写" })[0]);
    expect(onApplyRewrite).toHaveBeenCalledWith({
      original: "负责简历解析与匹配结果展示。",
      suggested: "负责简历解析与匹配结果展示，【待补充：可核对的结果，如耗时/准确率/覆盖量】。"
    });
  });

  it("hides a next action after it is marked done", () => {
    render(<ResumeAnalysisResult result={result()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "先放下" })[0]);
    const actionList = document.querySelector(".resume-analysis-actions");
    expect(actionList).toHaveTextContent("给「内部工具」补结果或职责");
    expect(actionList).not.toHaveTextContent("补上简历模块：教育经历");
  });

  it("shows the applied rewrite notice", () => {
    render(<ResumeAnalysisResult result={result()} appliedNotice="已写入简历并重新分析。刚处理：给「内部工具」补结果或职责" />);
    expect(screen.getByText(/已写入简历并重新分析/)).toBeInTheDocument();
  });

  it("falls back when structured fields are missing", () => {
    render(<ResumeAnalysisResult result={result({
      resume: {
        ...result().analysis.resume!,
        scan: undefined,
        evidence_matrix: undefined,
        talking_source: undefined,
        projects: result().analysis.resume!.projects.map(({ star, ...item }) => item),
        next_actions: result().analysis.resume!.next_actions?.map(({ why, where, effect, ...item }) => item)
      }
    })} />);
    expect(screen.getByText("岗位分析接口（FastAPI）")).toBeInTheDocument();
    expect(screen.getByText(/还出现了 Python/)).toBeInTheDocument();
    expect(screen.queryByText("完整度 3/5")).not.toBeInTheDocument();
    expect(screen.queryByText("未见明确任务")).not.toBeInTheDocument();
    expect(screen.getAllByText("仅已保存简历").length).toBeGreaterThan(0);
  });

  it("points at work bullets when there is no project", () => {
    render(<ResumeAnalysisResult result={result({
      resume: {
        ...result().analysis.resume!,
        talking_source: "work",
        projects: [{
          ...result().analysis.resume!.projects[0],
          title: "某公司 后端实习生",
          source: "work",
          how_to_talk: "面试按 STAR 讲这段工作经历：情境是「某公司 后端实习生」。"
        }]
      }
    })} />);
    expect(screen.getByText("没有拆出独立项目，下面按工作经历来讲。")).toBeInTheDocument();
    expect(screen.getAllByText("某公司 后端实习生").length).toBeGreaterThan(0);
  });
});
