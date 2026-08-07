import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const careerBundle = {
  profile: { id: 1, name: "小林", locale: "zh-CN", knowledge_revision: 3 },
  facts: [
    { id: 11, category: "achievement", statement: "转化率提升 30%", status: "pending", evidence: [{ source_id: 5, source_title: "cv.md", excerpt: "转化率提升 30%" }] },
    { id: 12, category: "skill", statement: "具备 Python 经验", status: "confirmed", evidence: [] }
  ],
  strategies: [
    { id: 2, name: "AI 产品", target_roles: ["AI 产品经理"], locations: ["上海"], industries: ["人工智能"], salary: {}, work_modes: [], priority: 100, is_active: true },
    { id: 3, name: "Agent 工程", target_roles: ["Agent 工程师"], locations: ["杭州"], industries: [], salary: {}, work_modes: [], priority: 60, is_active: false }
  ],
  active_strategy: { id: 2, name: "AI 产品", target_roles: ["AI 产品经理"], locations: ["上海"], industries: ["人工智能"], salary: {}, work_modes: [], priority: 100, is_active: true },
  stories: [{ id: 4, title: "关键项目", status: "confirmed", result: "按期上线" }],
  narratives: [],
  writing_samples: [],
  sources: [{ id: 5, title: "cv.md", source_type: "resume", privacy_mode: "redacted", allow_model_original: false, character_count: 1200, created_at: "2026-08-01" }],
  voice: { name: "简洁专业", tone_rules: ["先说结果"], banned_phrases: ["赋能"] },
  pending_changes: [{ id: 8 }],
  completeness: { score: 71, dimensions: { strategy: true }, missing: [] }
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
    onOpenChat: vi.fn(),
    onClearResume: vi.fn(),
    onSave: vi.fn(),
    onReturnToWorkbench: vi.fn()
  };
}

describe("ProfileSettingsPage 2.0", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/career-profile") ? careerBundle
        : url.endsWith("/jobs") ? [{ id: 21, company_name: "示例科技", job_title: "AI 产品经理", status: "saved" }]
          : url.endsWith("/career-insights/patterns") ? { eligible: false, progressed_count: 2, minimum_required: 5, stage_counts: {}, limitations: ["只反映个人记录"], recommendations: [] }
            : url.endsWith("/career-insights/skill-growth") ? { items: [{ skill: "Kubernetes", frequency: 2, eligible_for_recommendation: true, reason: "重复出现" }], rule: "单个缺口不升级" }
              : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders pending knowledge separately and sends explicit confirmation", async () => {
    render(<ProfileSettingsPage {...props()} />);
    expect(await screen.findByText("转化率提升 30%")).toBeInTheDocument();
    expect(screen.getByText("具备 Python 经验")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/career-profile/facts/11/review",
      expect.objectContaining({ method: "POST" })
    ));
  });

  it("shows per-source privacy authorization and strategy scope", async () => {
    render(<ProfileSettingsPage {...props()} />);
    await screen.findByRole("heading", { name: "待确认知识" });
    fireEvent.click(screen.getByRole("button", { name: "资料与隐私" }));
    expect(screen.getByText(/模型仅看脱敏文本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "策略与故事" }));
    expect(screen.getByText("当前策略")).toBeInTheDocument();
    expect(screen.getByText("关键项目")).toBeInTheDocument();
  });

  it("edits and merges pending facts through explicit review actions", async () => {
    render(<ProfileSettingsPage {...props()} />);
    await screen.findByText("转化率提升 30%");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByDisplayValue("转化率提升 30%"), { target: { value: "转化率提升 28%" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并确认" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/career-profile/facts/11/review",
      expect.objectContaining({ body: expect.stringContaining('"action":"edit"') })
    ));

    fireEvent.click(screen.getByRole("button", { name: "合并" }));
    fireEvent.change(screen.getByRole("combobox", { name: "选择保留事实" }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "确认合并" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/career-profile/facts/11/merge",
      expect.objectContaining({ method: "POST" })
    ));
  });

  it("switches strategy and records application outcome", async () => {
    render(<ProfileSettingsPage {...props()} />);
    await screen.findByText("转化率提升 30%");
    fireEvent.click(screen.getByRole("button", { name: "策略与故事" }));
    fireEvent.click(screen.getByRole("button", { name: "设为当前" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/career-profile/strategies/3",
      expect.objectContaining({ method: "PATCH" })
    ));

    fireEvent.click(screen.getByRole("button", { name: "结果与成长" }));
    expect(await screen.findByText("Kubernetes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "记录阶段" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/jobs/21/outcomes",
      expect.objectContaining({ method: "POST" })
    ));
  });
});
