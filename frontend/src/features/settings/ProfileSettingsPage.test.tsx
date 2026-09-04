import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSettingsPage } from "./ProfileSettingsPage";
import type { CandidateEditor } from "../../types";

const editor: CandidateEditor = {
  name: "小林",
  targetRole: "AI 产品经理",
  targetCity: "上海",
  salaryMin: "30",
  salaryMax: "45",
  skills: "Python",
  industries: "人工智能",
  blockedKeywords: "外包",
  blockedCompanies: "",
  resumeText: "负责 AI 产品，转化率提升 30%",
  resumeFilename: "cv.md",
  resumeRedactedText: "负责 AI 产品，转化率提升 30%",
  privacyMode: "redacted"
};

function props() {
  return {
    apiBase: "http://127.0.0.1:8000",
    editor,
    busy: false,
    resumeBusy: false,
    enhancedParse: false,
    privacyFindings: [],
    suggestion: null,
    returnToWorkbench: false,
    onChange: vi.fn(),
    onEnhancedParseChange: vi.fn(),
    onParseFiles: vi.fn(),
    onScanPrivacy: vi.fn(),
    onFillSuggestion: vi.fn(),
    onCareerChange: vi.fn(),
    onClearResume: vi.fn(),
    onSave: vi.fn(),
    onReturnToWorkbench: vi.fn()
  };
}

describe("ProfileSettingsPage 2.0", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps a single, concise personal-information heading", () => {
    render(<ProfileSettingsPage {...props()} />);
    expect(screen.getByRole("heading", { name: "资料库" })).toBeInTheDocument();
    expect(screen.getByText("来源已就绪")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "资料库内容" })).toBeInTheDocument();
    expect(screen.queryByText("JOB SEARCH")).not.toBeInTheDocument();
    expect(screen.queryByText("我的求职资料")).not.toBeInTheDocument();
    expect(screen.queryByText("我的亮点")).not.toBeInTheDocument();
    expect(screen.queryByText("待确认亮点")).not.toBeInTheDocument();
  });

  it("names the return destination when opened from the workbench flow", () => {
    const onReturnToWorkbench = vi.fn();
    render(<ProfileSettingsPage {...props()} returnToWorkbench onReturnToWorkbench={onReturnToWorkbench} />);

    fireEvent.click(screen.getByRole("button", { name: "返回分析" }));

    expect(onReturnToWorkbench).toHaveBeenCalledOnce();
  });

  it("keeps personal details, preparation direction, and resume in one compact flow", async () => {
    render(<ProfileSettingsPage {...props()} />);
    expect(screen.getByDisplayValue("AI 产品经理")).toBeInTheDocument();
    expect(screen.getByText("材料只用于你的搜索、分析和内容生成，不会自行对外发送。")).toBeInTheDocument();
    expect(screen.queryByLabelText("核心技能")).not.toBeInTheDocument();
    expect(screen.getByText("意向城市")).toBeInTheDocument();
    expect(screen.queryByText("其他求职方向")).not.toBeInTheDocument();
  });

  it("only exposes the upload control when the resume is empty or explicitly being replaced", () => {
    render(<ProfileSettingsPage {...props()} />);
    expect(screen.getByRole("button", { name: "重新导入" })).toBeInTheDocument();
    expect(screen.queryByText("上传新材料")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新导入" }));
    expect(screen.getByText("上传新材料")).toBeInTheDocument();

    cleanup();
    render(<ProfileSettingsPage {...props()} editor={{ ...editor, resumeText: "", resumeFilename: "" }} />);
    expect(screen.getByText("导入材料")).toBeInTheDocument();
  });

  it("shows a readable resume preview by default and keeps raw editing available", () => {
    render(<ProfileSettingsPage {...props()} />);
    expect(screen.getByRole("heading", { name: "材料预览" })).toBeInTheDocument();
    expect(screen.getByLabelText("简历预览")).toHaveClass("profile-resume-preview");

    fireEvent.click(screen.getByRole("tab", { name: "编辑原文" }));
    expect(screen.getByRole("textbox", { name: "简历内容" })).toBeInTheDocument();
  });

  it("reviews pending facts inside the library instead of on the home page", async () => {
    const onReviewFact = vi.fn().mockResolvedValue(undefined);
    render(<ProfileSettingsPage
      {...props()}
      pendingFacts={[{ id: 21, statement: "主导过检索评测", category: "project" }]}
      onReviewFact={onReviewFact}
    />);

    const queue = screen.getByLabelText("待确认内容");
    expect(queue).toHaveTextContent("主导过检索评测");
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(onReviewFact).toHaveBeenCalledWith(21, "confirm"));
    expect(screen.queryByLabelText("待确认内容")).not.toBeInTheDocument();
  });

  it("renders education like other preview sections: full-width card with heading and award lines", () => {
    render(<ProfileSettingsPage {...props()} editor={{
      ...editor,
      resumeText: `项目经历
CareerLoop 求职助手
完成简历解析与岗位匹配

教育经历
复旦大学｜计算机科学与技术｜2018.09-2022.06
国家奖学金、校级优秀毕业生`
    }} />);

    const preview = screen.getByLabelText("简历预览");
    const education = preview.querySelector("section.resume-preview-section.education");
    const projects = preview.querySelector("section.resume-preview-section.projects");
    expect(education).toBeTruthy();
    expect(projects).toBeTruthy();
    expect(education?.parentElement).toHaveClass("resume-preview-sections");
    expect(projects?.parentElement).toBe(education?.parentElement);
    expect(education?.querySelector(".resume-preview-entry-list")).toBeTruthy();
    expect(projects?.querySelector(".resume-preview-entry-list")).toBeTruthy();
    expect(education?.querySelector("strong")).toHaveTextContent("复旦大学｜计算机科学与技术｜2018.09-2022.06");
    expect([...education?.querySelectorAll("p") || []].map((node) => node.textContent)).toEqual([
      "国家奖学金",
      "校级优秀毕业生"
    ]);
  });

  it("renders three titled capabilities as 个人优势 entries, not summary", () => {
    render(<ProfileSettingsPage {...props()} editor={{
      ...editor,
      resumeText: `陈露鑫｜AI 应用工程师
GitHub：https://github.com/example
电话：13800138000

「AIGC 与大模型落地能力」：熟练掌握 LangChain、Prompt 工程与多模型协同。
「AI 工程化全栈交付能力」：能独立完成从接口、编排到前端工作台的交付。
「产品从 0 到 1 落地迭代能力」：从需求拆解到上线闭环，带过完整产品。

工作经历
示例科技｜AI 应用工程师`
    }} />);

    const preview = screen.getByLabelText("简历预览");
    const strengths = preview.querySelector("section.resume-preview-section.strengths");
    const summary = preview.querySelector("section.resume-preview-section.summary");
    const articles = [...strengths?.querySelectorAll(".resume-preview-entry-list article") || []];
    expect(strengths?.querySelector("h4")).toHaveTextContent("个人优势");
    expect(articles).toHaveLength(3);
    expect(articles.map((node) => node.querySelector("strong")?.textContent)).toEqual([
      "「AIGC 与大模型落地能力」",
      "「AI 工程化全栈交付能力」",
      "「产品从 0 到 1 落地迭代能力」"
    ]);
    expect(articles.map((node) => node.querySelector("p")?.textContent)).toEqual([
      "熟练掌握 LangChain、Prompt 工程与多模型协同。",
      "能独立完成从接口、编排到前端工作台的交付。",
      "从需求拆解到上线闭环，带过完整产品。"
    ]);
    expect(summary?.textContent || "").not.toContain("AIGC 与大模型落地能力");
    expect(summary?.querySelectorAll("article")).not.toHaveLength(3);
  });

  it("clears the resume workspace after 清除", () => {
    function Harness() {
      const [current, setCurrent] = useState(editor);
      return (
        <ProfileSettingsPage
          {...props()}
          editor={current}
          onClearResume={() => setCurrent({ ...current, resumeText: "", resumeFilename: "", resumeRedactedText: "" })}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByText("来源已就绪")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(screen.getByText("导入材料")).toBeInTheDocument();
    expect(screen.getByText("待导入材料")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清除" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("简历预览")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("小林")).toBeInTheDocument();
  });

  it("only shows save after the profile is edited", async () => {
    const pageProps = props();
    render(<ProfileSettingsPage {...pageProps} />);
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("AI 产品经理"), { target: { value: "AI 应用工程师" } });
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(pageProps.onSave).toHaveBeenCalledOnce());
  });
});
