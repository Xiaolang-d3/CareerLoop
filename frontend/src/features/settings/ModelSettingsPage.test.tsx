import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAgentSettings } from "../../constants";
import type { AgentSettings, ModelCapabilityReport, ModelServiceMonitor } from "../../types";
import { ModelSettingsPage } from "./ModelSettingsPage";

const settings: AgentSettings = {
  ...defaultAgentSettings,
  model_name: "gpt-5.5",
  model_base_url: "https://api.openai.com/v1",
  model_protocol: "auto",
  api_key: "",
  api_key_configured: true
};

const monitor: ModelServiceMonitor = {
  status: "healthy",
  status_message: "最近调用正常",
  model_name: "gpt-5.5",
  base_url: "https://api.openai.com/v1",
  protocol: "openai",
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
  protocol: "openai",
  protocol_label: "OpenAI 兼容 Chat Completions",
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

function openAdvancedSettings() {
  const summary = screen.getByText("高级设置");
  fireEvent.click(summary);
  const details = summary.closest("details");
  if (details) details.open = true;
}

describe("ModelSettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows editable connection fields and keeps technical settings collapsed initially", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ModelSettingsPage {...props()} />);

    expect(screen.getByRole("heading", { name: "连接你的模型" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Base URL/)).toHaveValue("https://api.openai.com/v1");
    expect(screen.getByLabelText(/^Base URL/)).not.toBeDisabled();
    expect(screen.getByLabelText(/^Base URL/)).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText(/^API Key/)).not.toBeDisabled();
    expect(screen.getByLabelText(/^API Key/)).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("模型名称")).toHaveValue("gpt-5.5");
    expect(screen.getByLabelText("模型名称")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "保存并应用" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
    expect(screen.queryByText("已锁定")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "模型列表", hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText("高级设置").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText(/^接口协议/)).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "模型额度" })).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "模型能力检测" })).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "连接状态与调用质量" })).not.toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["Base URL", "https://models.example.test/v1", "model_base_url"],
    ["API Key", "test-key", "api_key"],
    ["模型名称", "gpt-4.1", "model_name"]
  ])("begins editing when the person changes %s without an unlock step", (label, value, field) => {
    const onSettingsChange = vi.fn();
    const onBeginEdit = vi.fn();
    render(<ModelSettingsPage {...props({ onSettingsChange, onBeginEdit })} />);

    fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });

    expect(onBeginEdit).toHaveBeenCalledOnce();
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, [field]: value });
  });

  it("saves a changed connection and cancels editing through their respective callbacks", () => {
    const onSave = vi.fn();
    const onCancelEdit = vi.fn();
    const onBeginEdit = vi.fn();
    const onSettingsChange = vi.fn();
    render(<ModelSettingsPage {...props({ editing: true, onSettingsChange, onSave, onCancelEdit, onBeginEdit })} />);

    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "gpt-4.1" } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, model_name: "gpt-4.1" });
    expect(onBeginEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
    expect(onSave).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it("disables the form while saving to prevent another change or duplicate submission", () => {
    const onSave = vi.fn();
    render(<ModelSettingsPage {...props({ editing: true, busy: true, onSave })} />);

    expect(screen.getByLabelText(/^Base URL/)).toBeDisabled();
    expect(screen.getByLabelText(/^API Key/)).toBeDisabled();
    expect(screen.getByLabelText("模型名称")).toBeDisabled();
    const save = screen.getByRole("button", { name: "保存中…" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("lets the person switch among discovered models", () => {
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
    expect(screen.getByRole("button", { name: "保存并应用" })).toBeEnabled();

    fireEvent.change(select, { target: { value: "deepseek-v4-flash" } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, model_name: "deepseek-v4-flash" });
  });

  it("allows a custom model name even when the service has returned a model list", () => {
    const onSettingsChange = vi.fn();
    const pageProps = props({ onSettingsChange });
    const { rerender } = render(<ModelSettingsPage {...pageProps} />);

    fireEvent.click(screen.getByRole("button", { name: "手动填写" }));
    const modelName = screen.getByLabelText("模型名称");
    expect(modelName.tagName).toBe("INPUT");
    expect(modelName).not.toBeDisabled();
    expect(modelName).toHaveValue("gpt-5.5");
    fireEvent.change(modelName, { target: { value: "custom-chat-model" } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, model_name: "custom-chat-model" });
    rerender(<ModelSettingsPage {...pageProps} settings={{ ...settings, model_name: "custom-chat-model" }} editing />);

    fireEvent.click(screen.getByRole("button", { name: "从列表选择" }));
    expect(screen.getByLabelText("模型名称").tagName).toBe("SELECT");
    expect(screen.getByLabelText("模型名称")).toHaveValue("custom-chat-model");
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
    expect(screen.getByRole("button", { name: "读取中…" })).toBeDisabled();

    fireEvent.change(select, { target: { value: "codex-auto-review" } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, model_name: "codex-auto-review" });
  });

  it("keeps manual entry available when the model list cannot be read", () => {
    const onSettingsChange = vi.fn();
    render(<ModelSettingsPage {...props({
      availableModels: [],
      discoveryError: "识别可用模型失败",
      onSettingsChange
    })} />);

    const input = screen.getByLabelText("模型名称");
    expect(input.tagName).toBe("INPUT");
    expect(input).not.toBeDisabled();
    expect(input).not.toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "gpt-5.4-mini" } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, model_name: "gpt-5.4-mini" });
  });

  it("uses a concise recovery hint rather than displaying a technical model discovery error", () => {
    const discoveryError = "模型目录 https://www.example.test/models 没有返回 OpenAI 兼容的模型列表，请确认 Base URL 填写的是模型服务的 API 网关地址";
    render(<ModelSettingsPage {...props({ availableModels: [], discoveryError })} />);

    expect(screen.getByText("未能读取模型列表，可手动填写模型名称。")).toBeInTheDocument();
    expect(screen.getByText(discoveryError, { exact: false })).not.toBeVisible();
  });

  it("lets the person refresh the model list explicitly", () => {
    const onDiscoverModels = vi.fn();
    render(<ModelSettingsPage {...props({ onDiscoverModels })} />);

    fireEvent.click(screen.getByRole("button", { name: "刷新列表" }));
    expect(onDiscoverModels).toHaveBeenCalledWith(true);
  });

  it("offers protocol, quota, capability and connection diagnostics after opening advanced settings", () => {
    const onProbeCapabilities = vi.fn();
    render(<ModelSettingsPage {...props({ onProbeCapabilities })} />);
    openAdvancedSettings();

    expect(screen.getByRole("combobox", { name: /^接口协议/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: "模型额度" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型能力检测" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "连接状态与调用质量" })).toBeInTheDocument();
    expect(screen.getByText("暂无额度数据")).toBeInTheDocument();
    expect(screen.getByText("1,280")).toBeInTheDocument();
    expect(screen.getByText("是否支持多模态")).toBeInTheDocument();
    expect(screen.getAllByText("支持").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByDisplayValue("自动匹配（当前：OpenAI 兼容 Chat Completions）")).toBeVisible();
    expect(screen.getByText(/系统不会自动添加 \/v1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检测" }));
    expect(onProbeCapabilities).toHaveBeenCalledOnce();
  });

  it("prefers Anthropic Messages for Claude models on a custom gateway", () => {
    const onSettingsChange = vi.fn();
    render(<ModelSettingsPage {...props({
      settings: { ...settings, model_name: "claude-sonnet-5-thinking", model_base_url: "https://api.example.test" },
      editing: true,
      capabilities: null,
      onSettingsChange
    })} />);
    openAdvancedSettings();

    const protocol = screen.getByDisplayValue("自动匹配（优先：Anthropic Messages API）");
    expect(protocol).not.toBeDisabled();
    fireEvent.change(protocol, { target: { value: "openai" } });
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ model_protocol: "openai" }));
  });

  it("uses Anthropic Messages for the official Anthropic host", () => {
    render(<ModelSettingsPage {...props({
      settings: { ...settings, model_name: "claude-sonnet-5-thinking", model_base_url: "https://api.anthropic.com" },
      capabilities: null
    })} />);
    openAdvancedSettings();

    expect(screen.getByDisplayValue("自动匹配（优先：Anthropic Messages API）")).toBeInTheDocument();
  });

  it("offers the common native protocols and recognizes Ollama without requiring a key", () => {
    render(<ModelSettingsPage {...props({
      settings: { ...settings, model_name: "qwen3", model_base_url: "http://localhost:11434" },
      editing: true,
      capabilities: null
    })} />);
    openAdvancedSettings();

    const protocol = screen.getByDisplayValue("自动匹配（优先：Ollama Chat API）");
    expect(protocol).toContainHTML('<option value="responses">OpenAI Responses API</option>');
    expect(protocol).toContainHTML('<option value="gemini">Google Gemini generateContent</option>');
    expect(protocol).toContainHTML('<option value="ollama">Ollama Chat API</option>');
    expect(screen.getByPlaceholderText("本地 Ollama 可留空")).toBeInTheDocument();
    expect(screen.getByText("本地 Ollama 可不填写密钥。")).toBeInTheDocument();
  });

  it("explains a managed read-only credential without asking to repair a keychain", () => {
    render(<ModelSettingsPage {...props({ savedSettings: { ...settings, secret_storage_writable: false, api_key_source: "environment" } })} />);
    expect(screen.getByText("当前密钥由服务部署环境提供，页面无法修改；请由服务部署配置更新密钥。")).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toBeDisabled();
    expect(screen.getByLabelText("模型名称")).toBeEnabled();
    expect(screen.queryByText(/修复系统钥匙串/)).not.toBeInTheDocument();
  });

  it("shows the negotiated protocol for the saved connection and a prediction for a draft", () => {
    const page = props({ settings: { ...settings, model_name: "claude-test" }, savedSettings: { ...settings, model_name: "claude-test" }, monitor: { ...monitor, model_name: "claude-test", protocol: "openai" } });
    const { rerender } = render(<ModelSettingsPage {...page} />);
    openAdvancedSettings();
    expect(screen.getByDisplayValue("自动匹配（当前：OpenAI 兼容 Chat Completions）")).toBeInTheDocument();
    rerender(<ModelSettingsPage {...page} editing />);
    expect(screen.getByDisplayValue("自动匹配（优先：Anthropic Messages API）")).toBeInTheDocument();
  });

  it("offers reconciliation and a version-checked recovery path for an uncertain save", () => {
    const onConfirmSave = vi.fn();
    const onResumeEditing = vi.fn();
    render(<ModelSettingsPage {...props({ editing: true, saveUnknown: true, onConfirmSave, onResumeEditing })} />);
    expect(screen.getByLabelText("API Key")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存并应用" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新确认保存结果" }));
    fireEvent.click(screen.getByRole("button", { name: "读取最新配置并继续编辑" }));
    expect(onConfirmSave).toHaveBeenCalledOnce();
    expect(onResumeEditing).toHaveBeenCalledOnce();
  });

});
