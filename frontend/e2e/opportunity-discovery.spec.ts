import { expect, test } from "@playwright/test";

test("legacy opportunity hashes redirect to chat and do not reopen the hub", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("careerloop-auth-token", "e2e-token");
  });
  await page.route("http://127.0.0.1:4173/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/" || path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(path)) {
      return route.continue();
    }
    if (path === "/auth/me") return route.fulfill({ json: { user: { id: 1, email: "e2e@example.com", display_name: "端到端用户" } } });
    if (path === "/system/database-status") return route.fulfill({ json: { status: "ready", schema_version: 20, required_schema_version: 20 } });
    if (path === "/opportunity-runs" || path === "/discovered-jobs" || path === "/opportunity-sources") {
      return route.fulfill({ json: [] });
    }
    if (path === "/career-profile") return route.fulfill({ json: { profile: { id: 1, name: "端到端用户" }, active_strategy: { id: 2, name: "AI 产品" }, facts: [], sources: [] } });
    if (path === "/jobs" || path === "/conversations" || path === "/chat/messages") return route.fulfill({ json: [] });
    if (path === "/workflow/status") return route.fulfill({ json: { status: "idle", counts: {}, stage_counts: {}, nodes: [] } });
    if (path === "/agent/settings") return route.fulfill({ json: { display_name: "CareerLoop", persona_role: "AI 求职伙伴", response_style: "concise", custom_instructions: "", profile_memory_enabled: true, conversation_memory_enabled: true, knowledge_memory_enabled: true, summary_enabled: true, context_message_limit: 12, model_name: "gpt", model_base_url: "", model_protocol: "auto", api_key: "", api_key_configured: false } });
    if (path === "/agent/capabilities") return route.fulfill({ json: { tools: [], tool_specs: [] } });
    if (path === "/attachments/config") return route.fulfill({ json: { storage: "local", vision_enabled: false, vision_ready: false, checks: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/#/opportunities");
  await expect(page).toHaveURL(/#\/chat$/);
  await expect(page.getByRole("heading", { name: "值得优先查看" })).toHaveCount(0);

  await page.goto("/#/opportunities/new");
  await expect(page).toHaveURL(/#\/chat$/);
  await expect(page.getByRole("heading", { name: "选择发现方式" })).toHaveCount(0);

  await page.goto("/#/opportunities/pipeline");
  await expect(page).toHaveURL(/#\/chat$/);
  await expect(page.getByRole("heading", { name: "决定哪些岗位值得推进" })).toHaveCount(0);
});
