import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAgentSettings } from "../../constants";
import type { AgentSettings, ModelCapabilityReport, ModelServiceMonitor } from "../../types";
import { ModelSettingsPage } from "./ModelSettingsPage";

const settings: AgentSettings = {
  ...defaultAgentSettings,
  model_name: "gpt-5.5",
  model_base_url: "https://api.openai.com/v1",
  api_key: "",
  api_key_configured: true
};

const monitor: ModelServiceMonitor = {
  status: "healthy",
  status_message: "最近调用正常",
  model_name: "gpt-5.5",
  base_url: "https://api.openai.com/v1",
  api_key_configured: true,
  window_hours: 24,
  summary: {
    total_requests: 10,
    successful_requests: 9,
    failed_requests: 1,
    success_rate: 90,
    average_latency_ms: 400,
    p95_latency_ms: 800,
    timeout_count: 0,
    consecutive_failures: 0,
    total_tokens: 1280
  },
  usage: {
    window_hours: 24,
    total_tokens: 1280,
    remaining_quota: null,
    quota_available: false
  },
  error_breakdown: [],
  last_event_at: "2026-08-14T04:00:00Z",
  last_success_at: "2026-08-14T04:00:00Z",
  last_check_at: "2026-08-14T04:00:00Z",
  recent_events: []
};

const capabilities: ModelCapabilityReport = {
  model_name: "gpt-5.5",
  provider: "openai",
  provider_label: "OpenAI",
  vision: { status: "supported", source: "model_id", detail: "该模型 ID 通常支持图片 / 多模态输入" },
  streaming: { status: "supported", source: "client", detail: "当前 OpenAI 兼容客户端会对该对话模型发起流式请求" },
  tools: { status: "supported", source: "client", detail: "当前客户端会向该对话模型发送工具 / function calling" },
  probed: false,
  probe_error: null,
  attachment_vision_enabled: false
};

function props(overrides: Partial<Parameters<typeof ModelSettingsPage>[0]> = {}) {
  return {
    settings,
    savedSettings: settings,
    editing: false,
    busy: false,
    monitor,
    monitorBusy: false,
    availableModels: ["gpt-5.5", "gpt-4.1"],
    discoveryBusy: false,
    discoveryError: "",
    capabilities,
    capabilitiesBusy: false,
    onSettingsChange: vi.fn(),
    onDiscoverModels: vi.fn(),
    onCheckService: vi.fn(),
    onProbeCapabilities: vi.fn(),
    onBeginEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onSave: vi.fn(),
    ...overrides
  };
}

describe("ModelSettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the configured model connection, list, quota empty state, and capabilities", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ModelSettingsPage {...props()} />);

    expect(screen.getByRole("heading", { name: "模型连接" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型列表" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型额度" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型能力检测" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("OpenAI 兼容")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("模型名称")).toHaveValue("gpt-5.5");
    expect(screen.getByLabelText("模型名称")).toBeDisabled();
    expect(screen.getByRole("table", { name: "模型列表" })).toBeInTheDocument();
    expect(screen.getAllByText("gpt-4.1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("默认").length).toBeGreaterThan(0);
    expect(screen.getByText("暂无额度数据")).toBeInTheDocument();
    expect(screen.getByText("1,280")).toBeInTheDocument();
    expect(screen.getByText("是否支持多模态")).toBeInTheDocument();
    expect(screen.getAllByText("支持").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("87分")).not.toBeInTheDocument();
    expect(screen.queryByText("供应商市场")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    const page = document.querySelector(".model-settings-page");
    const top = document.querySelector(".model-settings-top");
    const monitor = document.querySelector(".model-monitor-card");
    expect(page).toContainElement(top);
    expect(page).toContainElement(monitor);
    expect(top).toContainElement(screen.getByRole("heading", { name: "模型连接" }));
    expect(top).toContainElement(screen.getByRole("heading", { name: "模型列表" }));
    expect(monitor).toContainElement(screen.getByRole("heading", { name: "连接状态与调用质量" }));
    expect(top?.contains(monitor)).toBe(false);
  });

  it("lets the person edit stored fields and run a real capability probe", () => {
    const onSettingsChange = vi.fn();
    const onSave = vi.fn();
    const onProbeCapabilities = vi.fn();
    render(<ModelSettingsPage {...props({ editing: true, onSettingsChange, onSave, onProbeCapabilities })} />);

    const modelName = screen.getByLabelText("模型名称");
    expect(modelName).not.toBeDisabled();
    fireEvent.change(modelName, { target: { value: "gpt-4.1" } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, model_name: "gpt-4.1" });

    fireEvent.click(screen.getByRole("button", { name: "确认并应用" }));
    expect(onSave).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "检测" }));
    expect(onProbeCapabilities).toHaveBeenCalledOnce();
  });

  it("lets the person switch among discovered models while editing", () => {
    const onSettingsChange = vi.fn();
    const availableModels = [
      "gpt-5.5",
      "codex-auto-review",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra"
    ];
    render(<ModelSettingsPage {...props({ editing: true, availableModels, onSettingsChange })} />);

    const select = screen.getByLabelText("模型名称");
    expect(select.tagName).toBe("SELECT");
    expect(select).not.toBeDisabled();
    expect(screen.getByText("已自动识别 9 个可用模型。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并应用" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "deepseek-v4-flash" } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, model_name: "deepseek-v4-flash" });
  });

  it("does not disable the model select just because rediscovery is in progress", () => {
    const onSettingsChange = vi.fn();
    render(<ModelSettingsPage {...props({
      editing: true,
      availableModels: ["gpt-5.5", "codex-auto-review", "deepseek-v4-flash"],
      discoveryBusy: true,
      onSettingsChange
    })} />);

    const select = screen.getByLabelText("模型名称");
    expect(select).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "自动识别中…" })).toBeDisabled();

    fireEvent.change(select, { target: { value: "codex-auto-review" } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, model_name: "codex-auto-review" });
  });

  it("keeps the model name field editable when discovery failed and the card is unlocked", () => {
    const onSettingsChange = vi.fn();
    render(<ModelSettingsPage {...props({
      editing: true,
      availableModels: [],
      discoveryError: "识别可用模型失败",
      onSettingsChange
    })} />);

    const input = screen.getByLabelText("模型名称");
    expect(input.tagName).toBe("INPUT");
    expect(input).not.toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "gpt-5.4-mini" } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, model_name: "gpt-5.4-mini" });
  });

  it("shows the backend reason for a failed discovery instead of guessing the cause", () => {
    const discoveryError = "模型目录 https://www.example.test/v1/models 没有返回 OpenAI 兼容的模型列表，请确认 Base URL 填写的是模型服务的 API 网关地址";
    render(<ModelSettingsPage {...props({ availableModels: [], discoveryError })} />);

    expect(screen.getByText(`${discoveryError}。也可以解锁后手动填写模型名称。`)).toBeInTheDocument();
    expect(screen.queryByText(/当前服务可能不支持模型目录/)).not.toBeInTheDocument();
  });

  it("keeps the discovery hint neutral while no error is reported", () => {
    render(<ModelSettingsPage {...props({ availableModels: [] })} />);

    expect(screen.getByText("保存的连接会自动读取模型列表；当前服务不支持时可手动输入。")).toBeInTheDocument();
  });
});
