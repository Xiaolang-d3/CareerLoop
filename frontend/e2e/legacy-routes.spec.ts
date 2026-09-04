import { expect, test } from "@playwright/test";

async function mockCoreApis(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("careerloop-auth-token", "e2e-token");
  });
  await page.route("http://127.0.0.1:4173/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/" || path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(path)) {
      return route.continue();
    }
    if (path === "/auth/me") {
      return route.fulfill({ json: { user: { id: 1, email: "e2e@example.com", display_name: "端到端用户" } } });
    }
    if (path === "/system/database-status") {
      return route.fulfill({ json: { status: "ready", schema_version: 20, required_schema_version: 20 } });
    }
    if (path === "/career-profile") {
      return route.fulfill({ json: { profile: { id: 1, name: "端到端用户" }, active_strategy: null, facts: [], sources: [] } });
    }
    if (path === "/jobs" || path === "/conversations" || path === "/chat/messages" || path === "/discovered-jobs") {
      return route.fulfill({ json: [] });
    }
    if (path === "/workflow/status") {
      return route.fulfill({ json: { status: "idle", counts: {}, stage_counts: {}, nodes: [] } });
    }
    if (path === "/agent/settings") {
      return route.fulfill({
        json: {
          display_name: "CareerLoop",
          persona_role: "AI 求职伙伴",
          response_style: "concise",
          custom_instructions: "",
          profile_memory_enabled: true,
          conversation_memory_enabled: true,
          knowledge_memory_enabled: true,
          summary_enabled: true,
          context_message_limit: 12,
          model_name: "gpt",
          model_base_url: "",
          model_protocol: "auto",
          api_key: "",
          api_key_configured: false
        }
      });
    }
    if (path === "/agent/capabilities") return route.fulfill({ json: { tools: [], tool_specs: [] } });
    if (path === "/attachments/config") {
      return route.fulfill({ json: { storage: "local", vision_enabled: false, vision_ready: false, checks: [] } });
    }
    return route.fulfill({ json: {} });
  });
}

test("retired hashes land on chat or library without depending on page copy", async ({ page }) => {
  await mockCoreApis(page);

  await page.goto("/#/interview-prep");
  await expect(page).toHaveURL(/#\/chat$/);

  await page.goto("/#/interview-records");
  await expect(page).toHaveURL(/#\/chat$/);

  await page.goto("/#/workbench/interview");
  await expect(page).toHaveURL(/#\/chat$/);

  await page.goto("/#/project");
  await expect(page).toHaveURL(/#\/library/);

  await page.goto("/#/projects");
  await expect(page).toHaveURL(/#\/library/);

  await page.goto("/#/knowledge");
  await expect(page).toHaveURL(/#\/library/);

  await page.goto("/#/settings/profile");
  await expect(page).toHaveURL(/#\/library/);
});
