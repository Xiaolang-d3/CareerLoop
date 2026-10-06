import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const conversation = {
  id: 1,
  title: "资料研究",
  status: "active",
  summary: "",
  message_count: 0,
  task_status: "active",
  updated_at: "2026-09-22T08:00:00Z",
  last_message_at: "2026-09-22T08:00:00Z"
};

async function mockCurrentProduct(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("careerloop-auth-token", "e2e-token");
  });
  await page.route("http://127.0.0.1:4173/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/" || path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(path)) {
      return route.continue();
    }
    if (path === "/auth/me") {
      return route.fulfill({ json: { user: { id: 1, email: "e2e@local.test", display_name: "测试用户", has_avatar: false } } });
    }
    if (path === "/system/database-status") {
      return route.fulfill({ json: { status: "ready", schema_version: 25, required_schema_version: 25 } });
    }
    if (path === "/library") return route.fulfill({ json: {
      profile: { name: "读者", privacy_mode: "redacted", knowledge_revision: 1 },
      facts: [{ id: 1, category: "knowledge", statement: "每周整理一次阅读笔记", status: "pending" }],
      sources: [{ id: 7, title: "读书笔记", source_kind: "paste", original_filename: "", mime_type: "text/plain", source_uri: "", privacy_mode: "redacted", enabled: true, parse_status: "ready", character_count: 120, file_available: false, created_at: "2026-09-22T08:00:00Z", updated_at: "2026-09-22T08:00:00Z" }]
    } });
    if (path === "/conversations") return route.fulfill({ json: [conversation] });
    if (path === "/chat/messages") return route.fulfill({ json: [] });
    if (path === "/agent/runs/current") return route.fulfill({ json: { run: null } });
    if (path === "/agent/capabilities") {
      return route.fulfill({
        json: {
          configured: true,
          active_model_provider: "openai_compatible",
          active_model_name: "mock-model",
          active_platform: "local",
          model_providers: ["openai_compatible"],
          platforms: ["local"],
          tools: ["get_library_context", "search_library", "search_public_web", "ask_user", "propose_library_knowledge"],
          web_research: { enabled: true, provider: "mock" }
        }
      });
    }
    if (path === "/attachments/config") {
      return route.fulfill({
        json: {
          storage: "local",
          vision_enabled: false,
          vision_ready: false,
          vision_url_ttl_seconds: 900,
          requires_public_endpoint: false,
          checks: []
        }
      });
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled E2E route: ${path}` } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-22T08:00:00Z"));
  await mockCurrentProduct(page);
});

test("AI workspace keeps one reading axis and switches history rail by breakpoint", async ({ page }) => {
  const evidenceDir = resolve("..", "..", "output", "playwright");
  await mkdir(evidenceDir, { recursive: true });
  await page.goto("/#/chat/1");
  await expect(page.getByRole("heading", { name: "你想完成什么？" })).toBeVisible();
  await page.getByRole("button", { name: "对话记录" }).click();

  for (const viewport of [
    { width: 960, height: 800, mode: "drawer" },
    { width: 1280, height: 820, mode: "rail" },
    { width: 1440, height: 900, mode: "rail" }
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const panel = page.locator(".conversation-history-panel");
    const main = page.locator(".chat-main");
    const composer = page.locator(".composer-input");
    const header = page.locator(".chat-session-header");

    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS("position", viewport.mode === "drawer" ? "absolute" : "relative");
    const [mainBox, composerBox, headerBox] = await Promise.all([
      main.boundingBox(),
      composer.boundingBox(),
      header.boundingBox()
    ]);
    expect(mainBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(headerBox!.x).toBeCloseTo(mainBox!.x, 0);
    expect(headerBox!.width).toBeCloseTo(mainBox!.width, 0);
    expect(composerBox!.width).toBeGreaterThanOrEqual(600);
    expect(composerBox!.width).toBeLessThanOrEqual(900);
    expect(composerBox!.x).toBeGreaterThanOrEqual(mainBox!.x + 15);
    expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(mainBox!.x + mainBox!.width - 15);

    await page.screenshot({
      path: resolve(evidenceDir, `chat-workspace-${viewport.width}.png`),
      fullPage: true,
      animations: "disabled"
    });
    // Pixel baselines are macOS-specific. Linux still checks geometry and
    // interactions and emits the same screenshots for review.
    if (process.platform === "darwin") {
      await expect(page).toHaveScreenshot(`chat-workspace-${viewport.width}.png`, {
        animations: "disabled",
        maxDiffPixelRatio: 0.01
      });
    }
  }
});

test("retired career routes resolve only to the current product surfaces", async ({ page }) => {
  for (const [legacyRoute, expectedRoute] of [
    ["/#/opportunities", /#\/chat(?:\/\d+)?$/],
    ["/#/interview-prep", /#\/chat(?:\/\d+)?$/],
    ["/#/projects", /#\/library$/],
    ["/#/knowledge", /#\/library$/]
  ] as const) {
    await page.goto(legacyRoute);
    await expect(page).toHaveURL(expectedRoute);
  }
  await expect(page.getByText("职位机会", { exact: true })).toHaveCount(0);
});


test("home and library use current sources and stay usable on narrow screens", async ({ page }) => {
  for (const width of [375, 960, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/dashboard");
    await expect(page.getByRole("heading", { name: /读者/ })).toBeVisible();
    await expect(page.getByText("读书笔记", { exact: true })).toBeVisible();
    await page.goto("/#/library");
    await expect(page.getByRole("table", { name: "文件列表" })).toBeVisible();
    await expect(page.getByRole("button", { name: "操作 读书笔记" })).toBeVisible();
    await expect(page.getByRole("button", { name: "知识与个性化" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: resolve("..", "..", "output", "playwright", `library-${width}.png`), fullPage: true });
  }
});
