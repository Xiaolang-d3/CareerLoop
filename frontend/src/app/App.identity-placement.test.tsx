import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAgentSettings } from "../constants";
import { ThemeProvider } from "../features/appearance/ThemeProvider";
import { App } from "./App";

const api = vi.hoisted(() => ({ fetchJson: vi.fn<(path: string) => Promise<unknown>>() }));
const conversations = vi.hoisted(() => ({
  conversations: [], currentConversationId: null, conversationBusy: false,
  conversationDialog: null, setConversations: vi.fn(), setCurrentConversationId: vi.fn(),
  setConversationBusy: vi.fn(), refreshConversations: vi.fn().mockResolvedValue([])
}));
const chat = vi.hoisted(() => ({
  chatMessages: [], chatBusy: false, modelUnavailable: null,
  chatAgentRef: { current: null }, setChatMessages: vi.fn(), setChatBusy: vi.fn(),
  setRetryChatDraft: vi.fn(), setModelUnavailable: vi.fn()
}));
const library = vi.hoisted(() => ({
  libraryEditor: { name: "", privacyMode: "redacted" }, librarySources: [], libraryFolders: [],
  pendingKnowledge: [], libraryLoaded: true, refreshLibrary: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../api/client", () => ({ createApiClient: () => api.fetchJson, fetchWithTimeout: vi.fn() }));
vi.mock("../page-prefetch", () => ({ createPagePrefetcher: () => ({ prefetch: vi.fn(), prefetchWhenIdle: vi.fn() }) }));
vi.mock("../hooks/useAsyncPolling", () => ({ useAsyncPolling: vi.fn() }));
vi.mock("../features/chat/useConversations", () => ({ useConversations: () => conversations }));
vi.mock("../features/chat/useChatRun", () => ({ useChatRun: () => chat }));
vi.mock("../features/library/useLibrary", () => ({ useLibrary: () => library }));
vi.mock("../components/AssistantSurface", () => ({
  AssistantSurface: ({ page, children }: { page: boolean; children: ReactNode }) => page ? <section>{children}</section> : null
}));
vi.mock("../components/ChatWorkspace", () => ({ ChatWorkspace: () => <h2>测试工作区</h2> }));
vi.mock("../features/home/HomePage", () => ({ HomePage: () => <h2>测试首页</h2> }));
vi.mock("../features/library/LibraryPage", () => ({ LibraryPage: () => <h2>测试文件库</h2> }));
vi.mock("../features/settings/AccountSettingsPage", () => ({ AccountSettingsPage: () => <h2>测试账号设置</h2> }));
vi.mock("../features/settings/ModelSettingsPage", () => ({ ModelSettingsPage: () => <h2>测试模型设置</h2> }));
vi.mock("../features/settings/SettingsWorkspace", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/settings/SettingsWorkspace")>(),
  SettingsOverview: () => <h2>测试设置概览</h2>
}));

function renderApp() {
  return render(
    <ThemeProvider>
      <App apiBase="/test-api" accessToken="test-only-session" onLogout={vi.fn()}
        user={{ email: "developer@example.test", has_avatar: false }} updateSession={vi.fn()} />
    </ThemeProvider>
  );
}

function expectSidebarIdentity(container: HTMLElement) {
  const triggers = screen.getAllByRole("button", { name: "账号菜单" });
  expect(triggers).toHaveLength(1);
  const trigger = triggers[0];
  expect(trigger.closest(".sidebar-identity-slot")).not.toBeNull();
  expect(trigger.closest("aside.sidebar")).not.toBeNull();
  expect(container.querySelector(".content .app-identity")).toBeNull();
  expect(container.querySelector(".app-topbar .app-identity")).toBeNull();
  return trigger;
}

beforeEach(() => {
  api.fetchJson.mockReset();
  conversations.refreshConversations.mockResolvedValue([]);
  library.refreshLibrary.mockResolvedValue(undefined);
  api.fetchJson.mockImplementation(async (path) => {
    if (path === "/system/database-status") return { status: "ready" };
    if (path === "/agent/settings") return { ...defaultAgentSettings, model_name: "test-model", api_key_configured: true };
    if (path === "/agent/model-monitor?hours=24" || path === "/agent/models/capabilities") return null;
    if (path === "/agent/models/discover") return { models: [], count: 0 };
    if (path === "/agent/capabilities" || path === "/attachments/config") return {};
    throw new Error(`Unexpected mocked request: ${path}`);
  });
  localStorage.clear();
  window.history.replaceState(null, "", "#/home");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("App identity placement", () => {
  it.each([
    ["#/home", "测试首页"],
    ["#/library", "测试文件库"],
    ["#/chat", "测试工作区"],
    ["#/settings/model", "测试模型设置"],
    ["#/settings/appearance", "外观"]
  ])("keeps one account menu in the sidebar on %s", async (hash, pageHeading) => {
    window.history.replaceState(null, "", hash);
    const { container } = renderApp();

    await screen.findByRole("heading", { name: pageHeading, level: 2 });
    expectSidebarIdentity(container);
    expect(window.location.hash).toBe(hash);
  });

  it("keeps the same account menu when navigating to account and settings", async () => {
    const { container } = renderApp();
    await screen.findByRole("heading", { name: "测试首页" });
    const trigger = expectSidebarIdentity(container);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "账号与安全" }));
    await screen.findByRole("heading", { name: "测试账号设置" });
    expect(window.location.hash).toBe("#/settings/account");
    expect(expectSidebarIdentity(container)).toBe(trigger);
    expect(screen.queryByRole("menu", { name: "账号菜单" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "账号与安全" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("menuitem", { name: "设置" }));
    await screen.findByRole("heading", { name: "测试设置概览" });
    expect(window.location.hash).toBe("#/settings");
    expect(expectSidebarIdentity(container)).toBe(trigger);
    expect(screen.queryByRole("menu", { name: "账号菜单" })).not.toBeInTheDocument();
  });

  it("opens the account menu after collapsing the sidebar", async () => {
    const { container } = renderApp();
    await screen.findByRole("heading", { name: "测试首页" });
    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    const trigger = expectSidebarIdentity(container);
    expect(trigger.closest("aside")).toHaveClass("collapsed");

    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "账号菜单" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "设置" }));
    await screen.findByRole("heading", { name: "测试设置概览" });
    expect(expectSidebarIdentity(container).closest("aside")).toHaveClass("collapsed");
    await waitFor(() => expect(localStorage.getItem("careerloop-sidebar:developer@example.test")).toBe("collapsed"));
  });
});
