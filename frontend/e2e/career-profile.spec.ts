import { expect, test } from "@playwright/test";

test("empty-to-confirmed profile governance path", async ({ page }) => {
  const profile: any = {
    profile: { id: 1, name: "端到端用户", locale: "zh-CN", knowledge_revision: 1 },
    facts: [{ id: 7, category: "achievement", statement: "项目交付周期缩短 30%", status: "pending", evidence: [{ source_id: 2, source_title: "简历", excerpt: "交付周期缩短 30%" }] }],
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
    pending_changes: [{ id: 9 }],
    completeness: { score: 42, dimensions: {}, missing: ["stories"] }
  };

  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path === "/career-profile/facts/7/review" && method === "POST") {
      profile.facts[0].status = "confirmed";
      profile.profile.knowledge_revision += 1;
      profile.pending_changes = [];
      return route.fulfill({ json: profile.facts[0] });
    }
    if (path === "/career-profile/strategies/4" && method === "PATCH") {
      profile.strategies.forEach((strategy: any) => { strategy.is_active = strategy.id === 4; });
      profile.active_strategy = profile.strategies[1];
      return route.fulfill({ json: profile.strategies[1] });
    }
    if (path === "/career-profile") return route.fulfill({ json: profile });
    if (path === "/system/database-status") return route.fulfill({ json: { status: "ready", schema_version: 5, required_schema_version: 5 } });
    if (path === "/discovered-jobs" || path === "/chat/messages") return route.fulfill({ json: [] });
    if (path === "/jobs") return route.fulfill({ json: [{ id: 21, company_name: "示例科技", job_title: "AI 产品经理", status: "saved" }] });
    if (path === "/career-insights/patterns") return route.fulfill({ json: { eligible: false, progressed_count: 2, minimum_required: 5, stage_counts: {}, limitations: ["只反映个人记录"], recommendations: [] } });
    if (path === "/career-insights/skill-growth") return route.fulfill({ json: { items: [{ skill: "Kubernetes", frequency: 2, eligible_for_recommendation: true, reason: "重复出现" }], rule: "单个缺口不升级" } });
    if (path === "/conversations") return route.fulfill({ json: [{ id: 1, title: "画像访谈", status: "active", summary: "", updated_at: "2026-08-01" }] });
    if (path === "/workflow/status") return route.fulfill({ json: { status: "in_progress", counts: { profiles: 1, jd_analyses: 0, resume_evidence_searches: 0, tailored_resume_generations: 0, interview_advice_generations: 0, company_researches: 0 }, stage_counts: { candidate_knowledge: 0, opportunity_discovery: 0, job_evaluation: 0, material_preparation: 0, interview_preparation: 0, outcome_tracking: 0 }, nodes: [{ id: "candidate_knowledge", title: "候选人画像与知识", status: "pending", detail: "" }, { id: "opportunity_discovery", title: "机会发现", status: "pending", detail: "" }, { id: "job_evaluation", title: "岗位评估与决策", status: "pending", detail: "" }, { id: "material_preparation", title: "求职材料准备", status: "pending", detail: "" }, { id: "interview_preparation", title: "面试准备", status: "pending", detail: "" }, { id: "outcome_tracking", title: "结果与复盘", status: "pending", detail: "" }] } });
    if (path === "/agent/settings") return route.fulfill({ json: { display_name: "CareerLoop", persona_role: "AI 求职伙伴", response_style: "concise", custom_instructions: "", profile_memory_enabled: true, conversation_memory_enabled: true, knowledge_memory_enabled: true, summary_enabled: true, context_message_limit: 12, model_name: "gpt", model_base_url: "", api_key: "", api_key_configured: false } });
    if (path === "/agent/capabilities") return route.fulfill({ json: { tools: [] } });
    if (path === "/attachments/config") return route.fulfill({ json: { storage: "local", vision_enabled: false, vision_ready: false, checks: [] } });
    if (path === "/agent/model-monitor") return route.fulfill({ json: { status: "unknown", summary: {}, recent_events: [] } });
    if (path === "/agent/operations") return route.fulfill({ json: { summary: {}, recent_runs: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/#/settings/profile");
  await expect(page.getByRole("heading", { name: "职业画像中心" })).toBeVisible();
  await expect(page.getByText("项目交付周期缩短 30%")).toBeVisible();
  await page.getByRole("button", { name: "确认" }).click();
  await expect(page.getByText("项目交付周期缩短 30%")).toBeVisible();
  await expect(page.getByText("R2")).toBeVisible();
  await page.getByRole("button", { name: "资料与隐私" }).click();
  await expect(page.getByText(/模型仅看脱敏文本/)).toBeVisible();
  await page.getByRole("button", { name: "策略与故事" }).click();
  await page.getByRole("button", { name: "设为当前" }).click();
  await expect(page.getByText(/已切换到“Agent 工程师”/)).toBeVisible();
  await page.getByRole("button", { name: "结果与成长" }).click();
  await expect(page.getByText("Kubernetes")).toBeVisible();
  await expect(page.getByRole("button", { name: "记录阶段" })).toBeVisible();
});
