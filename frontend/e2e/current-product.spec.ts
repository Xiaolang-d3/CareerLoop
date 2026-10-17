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
    if (path === "/home/feed") return route.fulfill({ json: {
      news: [], repositories: { day: [], week: [] }, updates: [], practices: [], sources: [],
      preferences: { topics: ["AI", "Agent", "MCP"], repositories: [] }, item_states: {}, bookmarks: [],
      refreshing: false, last_synced_at: null
    } });
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

test("long conversations keep one scroll viewport without blank space above the composer", async ({ page }) => {
  const source = { title: "参考资料", url: "https://example.com/reference", domain: "example.com" };
  const messages = Array.from({ length: 6 }, (_, index) => [
    { id: index * 2 + 1, role: "user", content: `问题 ${index + 1}`, created_at: conversation.updated_at },
    {
      id: index * 2 + 2, role: "assistant", created_at: conversation.updated_at,
      content: `${"这是一段用于验证长对话滚动的回答。\n\n".repeat(20)}[参考资料](${source.url})`,
      payload: { agent: {
        provider: "mock", platform: "local", status: "done", rounds: 1,
        events: [{ round: 1, tool_call_id: `search-${index}`, tool_name: "search_public_web", status: "done", message: "已检索", data: { sources: [source] } }]
      } }
    }
  ]).flat();
  await page.route("**/chat/messages?*", route => route.fulfill({ json: messages }));
  await page.setViewportSize({ width: 1088, height: 770 });
  await page.goto("/#/chat/1");
  await expect(page.locator(".message.assistant")).toHaveCount(6);

  const surface = page.locator(".chat-thread-surface");
  const viewport = page.getByRole("log");
  const assertSingleViewport = async () => {
    await expect.poll(() => surface.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    const [surfaceBox, viewportBox] = await Promise.all([surface.boundingBox(), viewport.boundingBox()]);
    expect(viewportBox!.y).toBeCloseTo(surfaceBox!.y, 0);
    expect(viewportBox!.height).toBeCloseTo(surfaceBox!.height, 0);
  };
  await assertSingleViewport();
  await page.getByRole("button", { name: "查看全部 1 个来源", exact: true }).last().click();
  const panel = page.getByRole("complementary", { name: "来源详情" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "关闭来源详情", exact: true }).click();
  await expect(panel).toBeHidden();
  await assertSingleViewport();

  for (const width of [777, 390, 1088]) {
    await page.setViewportSize({ width, height: 770 });
    await viewport.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await assertSingleViewport();
    const [viewportBox, lastMessageBox] = await Promise.all([
      viewport.boundingBox(), page.locator(".message.assistant").last().boundingBox()
    ]);
    const bottomGap = viewportBox!.y + viewportBox!.height - lastMessageBox!.y - lastMessageBox!.height;
    expect(bottomGap).toBeGreaterThanOrEqual(0);
    expect(bottomGap).toBeLessThanOrEqual(64);
  }
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
      // Collect every breakpoint's diff in one run; any mismatch still fails
      // the test and the required CI gate.
      await expect.soft(page).toHaveScreenshot(`chat-workspace-${viewport.width}.png`, {
        animations: "disabled",
        maxDiffPixelRatio: 0.01
      });
    }
  }
});

test("retired career routes are not recognized and open home", async ({ page }) => {
  for (const legacyRoute of ["/#/opportunities", "/#/interview-prep", "/#/projects", "/#/knowledge"]) {
    await page.goto(legacyRoute);
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByRole("region", { name: "开发者首页" })).toBeVisible();
  }
  await expect(page.getByText("职位机会", { exact: true })).toHaveCount(0);
});


test("home and library use current sources and stay usable on narrow screens", async ({ page }) => {
  for (const width of [375, 960, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/dashboard");
    await expect(page.getByRole("heading", { name: /测试用户/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI / Agent 动态", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "GitHub 热榜", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto("/#/library");
    await expect(page.getByRole("table", { name: "文件列表" })).toBeVisible();
    await expect(page.getByRole("button", { name: "操作 读书笔记" })).toBeVisible();
    await expect(page.getByRole("button", { name: "知识", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: resolve("..", "..", "output", "playwright", `library-${width}.png`), fullPage: true });
  }
});
