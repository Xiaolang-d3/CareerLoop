import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByRole("heading", { name: "个人信息" })).toBeInTheDocument();
    expect(screen.queryByText("JOB SEARCH")).not.toBeInTheDocument();
    expect(screen.queryByText("我的求职资料")).not.toBeInTheDocument();
    expect(screen.queryByText("我的亮点")).not.toBeInTheDocument();
    expect(screen.queryByText("待确认亮点")).not.toBeInTheDocument();
  });

  it("names the return destination when opened from the workbench flow", () => {
    const onReturnToWorkbench = vi.fn();
    render(<ProfileSettingsPage {...props()} returnToWorkbench onReturnToWorkbench={onReturnToWorkbench} />);

    fireEvent.click(screen.getByRole("button", { name: "返回简历分析" }));

    expect(onReturnToWorkbench).toHaveBeenCalledOnce();
  });

  it("keeps personal details, preparation direction, and resume in one compact flow", async () => {
    render(<ProfileSettingsPage {...props()} />);
    expect(screen.getByDisplayValue("AI 产品经理")).toBeInTheDocument();
    expect(screen.getByText("资料仅用于你的准备内容，不会自行对外发送。")).toBeInTheDocument();
    expect(screen.queryByLabelText("核心技能")).not.toBeInTheDocument();
    expect(screen.getByText("意向城市")).toBeInTheDocument();
    expect(screen.queryByText("其他求职方向")).not.toBeInTheDocument();
  });

  it("only exposes the upload control when the resume is empty or explicitly being replaced", () => {
    render(<ProfileSettingsPage {...props()} />);
    expect(screen.getByRole("button", { name: "重新导入" })).toBeInTheDocument();
    expect(screen.queryByText("上传新简历")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新导入" }));
    expect(screen.getByText("上传新简历")).toBeInTheDocument();

    cleanup();
    render(<ProfileSettingsPage {...props()} editor={{ ...editor, resumeText: "", resumeFilename: "" }} />);
    expect(screen.getByText("导入简历")).toBeInTheDocument();
  });

  it("shows a readable resume preview by default and keeps raw editing available", () => {
    render(<ProfileSettingsPage {...props()} />);
    expect(screen.getByRole("heading", { name: "简历预览" })).toBeInTheDocument();
    expect(screen.getByLabelText("简历预览")).toHaveClass("profile-resume-preview");

    fireEvent.click(screen.getByRole("tab", { name: "编辑原文" }));
    expect(screen.getByRole("textbox", { name: "简历内容" })).toBeInTheDocument();
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
