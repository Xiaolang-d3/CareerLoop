import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAgentSettings } from "../constants";
import { ThemeProvider } from "../features/appearance/ThemeProvider";
import type { AgentSettings, ModelCapabilityReport, ModelServiceMonitor } from "../types";
import { App } from "./App";

const api = vi.hoisted(() => ({ fetchJson: vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>() }));

vi.mock("../api/client", () => ({ createApiClient: () => api.fetchJson, fetchWithTimeout: vi.fn() }));
vi.mock("../page-prefetch", () => ({ createPagePrefetcher: () => ({ prefetch: vi.fn(), prefetchWhenIdle: vi.fn() }) }));
vi.mock("../hooks/useAsyncPolling", () => ({ useAsyncPolling: vi.fn() }));
vi.mock("../components/AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("../components/AppIdentityMenu", () => ({ AppIdentityMenu: () => null }));
vi.mock("../components/AppTopBar", () => ({ AppTopBar: () => null }));
vi.mock("../components/AssistantSurface", () => ({ AssistantSurface: () => null }));
vi.mock("../components/ChatWorkspace", () => ({ ChatWorkspace: () => null }));
vi.mock("../features/chat/useConversations", () => ({
  useConversations: () => ({
    conversations: [], currentConversationId: null, conversationBusy: false,
    conversationDialog: null, setConversations: vi.fn(), setCurrentConversationId: vi.fn(),
    setConversationBusy: vi.fn(), refreshConversations: vi.fn().mockResolvedValue([])
  })
}));
vi.mock("../features/chat/useChatRun", () => ({
  useChatRun: () => ({
    chatMessages: [], chatBusy: false, modelUnavailable: null,
    chatAgentRef: { current: null }, setChatMessages: vi.fn(), setChatBusy: vi.fn(),
    setRetryChatDraft: vi.fn(), setModelUnavailable: vi.fn()
  })
}));
vi.mock("../features/library/useLibrary", () => ({
  useLibrary: () => ({ librarySources: [], libraryFolders: [], pendingKnowledge: [], libraryLoaded: true })
}));

const savedSettings: AgentSettings = {
  ...defaultAgentSettings,
  display_name: "我的助手",
  persona_role: "分析技术文档",
  response_style: "detailed",
  custom_instructions: "保留原始来源",
  library_memory_enabled: false,
  conversation_memory_enabled: false,
  knowledge_memory_enabled: false,
  summary_enabled: false,
  context_message_limit: 24,
  model_name: "saved-model",
  model_base_url: "https://saved.example.test/v1",
  model_protocol: "responses",
  api_key: "",
  api_key_configured: true
};

const monitor: ModelServiceMonitor = {
  status: "unknown", status_message: "等待检测", model_name: savedSettings.model_name,
  base_url: savedSettings.model_base_url, protocol: "responses", api_key_configured: true,
  window_hours: 24,
  summary: {
    total_requests: 0, successful_requests: 0, failed_requests: 0, success_rate: null,
    average_latency_ms: null, p95_latency_ms: null, timeout_count: 0,
    consecutive_failures: 0, total_tokens: 0
  },
  error_breakdown: [], recent_events: [], last_event_at: null,
  last_success_at: null, last_check_at: null
};

const capabilities: ModelCapabilityReport = {
  model_name: savedSettings.model_name, provider: "responses", provider_label: "Responses",
  protocol: "responses", protocol_label: "OpenAI Responses API",
  vision: { status: "unknown", source: "model_id", detail: "等待检测" },
  streaming: { status: "supported", source: "client", detail: "支持流式输出" },
  tools: { status: "supported", source: "client", detail: "支持工具调用" },
  probed: false, probe_error: null
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function mockApi(settingsResult: Promise<AgentSettings> = Promise.resolve(savedSettings)) {
  api.fetchJson.mockImplementation(async (path, options) => {
    if (path === "/system/database-status") return { status: "ready" };
    if (path === "/agent/settings") {
      if (options?.method === "PUT") return { ...JSON.parse(String(options.body)), api_key: "", api_key_configured: true };
      return settingsResult;
    }
    if (path === "/agent/model-monitor?hours=24") return monitor;
    if (path === "/agent/model-monitor/check") return { ...monitor, available: true };
    if (path.startsWith("/agent/models/capabilities")) return capabilities;
    if (path === "/agent/models/discover") return { models: [], count: 0 };
    if (path === "/agent/capabilities" || path === "/attachments/config") return {};
    throw new Error(`Unexpected mocked request: ${path}`);
  });
}

function renderApp() {
  return render(<ThemeProvider><App apiBase="/test-api" accessToken="test-only-session" onLogout={vi.fn()} user={{ email: "developer@example.test", has_avatar: false }} updateSession={vi.fn()} /></ThemeProvider>);
}

function openAdvancedSettings() {
  const summary = screen.getByText("高级设置");
  fireEvent.click(summary);
  const details = summary.closest("details");
  if (details) details.open = true;
}

beforeEach(() => {
  api.fetchJson.mockReset();
  localStorage.clear();
  window.history.replaceState(null, "", "#/settings/model");
  vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("Model editing must not require confirmation"); });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("App model settings", () => {
  it("waits for saved configuration before editing and preserves other preferences when saving three fields", async () => {
    const initialSettings = deferred<AgentSettings>();
    mockApi(initialSettings.promise);
    renderApp();

    expect(await screen.findByText("正在读取模型配置…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("模型名称")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存并应用" })).not.toBeInTheDocument();
    expect(api.fetchJson.mock.calls.some(([path, options]) => path === "/agent/settings" && options?.method === "PUT")).toBe(false);

    await act(async () => { initialSettings.resolve(savedSettings); });
    expect(await screen.findByLabelText("Base URL")).toHaveValue(savedSettings.model_base_url);
    expect(screen.getByLabelText("模型名称")).toHaveValue(savedSettings.model_name);

    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://new.example.test/v1" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "test-only-new-key" } });
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "new-model" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));

    await waitFor(() => expect(api.fetchJson).toHaveBeenCalledWith("/agent/settings", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ ...savedSettings, model_base_url: "https://new.example.test/v1", api_key: "test-only-new-key", model_name: "new-model" })
    })));
    expect(await screen.findByText("设置已保存，连接检测成功")).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存并应用" })).toBeDisabled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("reads diagnostics from the saved connection and probes its explicit protocol after cancelling a draft", async () => {
    mockApi();
    renderApp();
    await screen.findByLabelText("Base URL");
    await waitFor(() => expect(api.fetchJson).toHaveBeenCalledWith("/agent/models/capabilities"));

    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "unsaved-model" } });
    openAdvancedSettings();
    expect(screen.getByRole("button", { name: "检测" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "立即检测" })).toBeDisabled();

    const later = Date.now() + 31_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    act(() => {
      window.history.replaceState(null, "", "#/settings/appearance");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByRole("heading", { name: "外观" });
    act(() => {
      window.history.replaceState(null, "", "#/settings/model");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByLabelText("模型名称")).toHaveValue("unsaved-model");
    await waitFor(() => expect(api.fetchJson.mock.calls.filter(([path, options]) => path === "/agent/models/capabilities" && !options)).toHaveLength(2));
    expect(api.fetchJson.mock.calls.some(([path]) => path.startsWith("/agent/models/capabilities?"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByLabelText("模型名称")).toHaveValue(savedSettings.model_name);
    openAdvancedSettings();
    fireEvent.click(screen.getByRole("button", { name: "检测" }));

    await waitFor(() => expect(api.fetchJson).toHaveBeenCalledWith("/agent/models/capabilities", expect.objectContaining({
      method: "POST", body: JSON.stringify({
        model_name: savedSettings.model_name, model_base_url: savedSettings.model_base_url,
        model_protocol: "responses", api_key: "", probe: true
      })
    })));
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
