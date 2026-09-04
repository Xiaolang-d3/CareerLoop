import { expect, test } from "@playwright/test";

test("saved profile and resume remain available in the library", async ({ page }) => {
  const profile: any = {
    profile: {
      id: 1,
      name: "端到端用户",
      locale: "zh-CN",
      knowledge_revision: 1,
      privacy_mode: "redacted",
      resume_text: "端到端用户\nAI 产品经理\n项目交付周期缩短 30%",
      resume_redacted_text: "候选人\nAI 产品经理\n项目交付周期缩短 30%",
      resume_filename: "简历.pdf"
    },
    facts: [{ id: 7, category: "achievement", statement: "项目交付周期缩短 30%", status: "confirmed", evidence: [{ source_id: 2, source_title: "简历", excerpt: "交付周期缩短 30%" }] }],
    strategies: [
      { id: 3, name: "AI 产品经理", target_roles: ["AI 产品经理"], locations: ["上海"], industries: [], salary: {}, work_modes: [], priority: 100, is_active: true },
      { id: 4, name: "Agent 工程师", target_roles: ["Agent 工程师"], locations: ["杭州"], industries: [], salary: {}, work_modes: [], priority: 60, is_active: false }
    ],
    active_strategy: { id: 3, name: "AI 产品经理", target_roles: ["AI 产品经理"], locations: ["上海"], industries: [], salary: {}, work_modes: [], priority: 100, is_active: true },
    stories: [],
    narratives: [],
    writing_samples: [],
    sources: [{ id: 2, title: "简历", source_type: "resume", privacy_mode: "redacted", allow_model_original: false, character_count: 500, created_at: "2026-08-01" }],
    voice: null,
    pending_changes: [],
    completeness: { score: 42, dimensions: {}, missing: ["stories"] }
  };

  await page.addInitScript(() => {
    window.localStorage.setItem("careerloop-auth-token", "e2e-token");
  });
  await page.route("http://127.0.0.1:4173/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/" || path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(path)) {
      return route.continue();
    }
    if (path === "/auth/me") return route.fulfill({ json: { user: { id: 1, email: "e2e@example.com", display_name: "端到端用户" } } });
    if (path === "/career-profile") return route.fulfill({ json: profile });
    if (path === "/career-profile/skill-tags") return route.fulfill({ json: [] });
    if (path === "/career-profile/facts") return route.fulfill({ json: profile.facts });
    if (path === "/career-profile/sources") return route.fulfill({ json: profile.sources });
    if (path === "/career-profile/strategies") return route.fulfill({ json: profile.strategies });
    if (path === "/system/database-status") return route.fulfill({ json: { status: "ready", schema_version: 20, required_schema_version: 20 } });
    if (path === "/discovered-jobs" || path === "/chat/messages") return route.fulfill({ json: [] });
    if (path === "/jobs") return route.fulfill({ json: [{ id: 21, company_name: "示例科技", job_title: "AI 产品经理", status: "saved" }] });
    if (path === "/conversations") return route.fulfill({ json: [{ id: 1, title: "画像访谈", status: "active", summary: "", updated_at: "2026-08-01" }] });
    if (path === "/workflow/status") return route.fulfill({ json: { status: "in_progress", counts: { profiles: 1, jd_analyses: 0, resume_evidence_searches: 0, tailored_resume_generations: 0, interview_advice_generations: 0, company_researches: 0 }, stage_counts: { candidate_knowledge: 0, opportunity_discovery: 0, job_evaluation: 0, material_preparation: 0, interview_preparation: 0, outcome_tracking: 0 }, nodes: [] } });
    if (path === "/agent/settings") return route.fulfill({ json: { display_name: "CareerLoop", persona_role: "AI 求职伙伴", response_style: "concise", custom_instructions: "", profile_memory_enabled: true, conversation_memory_enabled: true, knowledge_memory_enabled: true, summary_enabled: true, context_message_limit: 12, model_name: "gpt", model_base_url: "", model_protocol: "auto", api_key: "", api_key_configured: false } });
    if (path === "/agent/capabilities") return route.fulfill({ json: { tools: [], tool_specs: [] } });
    if (path === "/attachments/config") return route.fulfill({ json: { storage: "local", vision_enabled: false, vision_ready: false, checks: [] } });
    if (path === "/agent/model-monitor") return route.fulfill({ json: { status: "unknown", summary: {}, recent_events: [] } });
    if (path === "/agent/operations") return route.fulfill({ json: { summary: {}, recent_runs: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/#/library");
  await expect(page).toHaveURL(/#\/library/);
  await expect(page.getByRole("heading", { name: "资料库", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "基本资料" }).first()).toBeVisible();
  await expect(page.getByText("端到端用户", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "来源材料" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "检查隐私" })).toBeVisible();
  await expect(page.getByText("允许使用简历原文优化内容")).toBeVisible();
});
