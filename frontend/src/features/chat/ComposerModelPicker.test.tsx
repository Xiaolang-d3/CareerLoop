import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerModelPicker } from "./ComposerModelPicker";
import type { ComposerModelSettings } from "./ComposerModelParameters";

const profiles = [
  { id: "p1", model_name: "gpt-5.5", connection_name: "主连接" },
  { id: "p2", model_name: "claude-x", connection_name: "备用连接" }
];
function setup(overrides: Partial<Parameters<typeof ComposerModelPicker>[0]> = {}) {
  const props = {
    configured: true, currentModelName: "gpt-5.5", defaultModelName: "gpt-5.5", profiles, selectedProfileId: "p1",
    profileDisabled: false, serviceUnavailable: false, busy: false, canSelect: true,
    onChange: vi.fn(), onOpenSettings: vi.fn(), ...overrides
  };
  render(<ComposerModelPicker {...props} />);
  return props;
}
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /切换模型/ }));
afterEach(cleanup);

describe("ComposerModelPicker", () => {
  it("edits the active model parameters without switching models and keeps field keyboard input local", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const props = setup({ modelSettings: {
      profile: { id: "p1", connection_id: "c1", model_name: "gpt-5.5", enabled: true, revision: 3 },
      fetchJson: vi.fn().mockResolvedValue({ protocol: "responses", capabilities: { reasoning: { status: "supported" } }, max_output_tokens: { tokens: null } }) as unknown as ComposerModelSettings["fetchJson"],
      onSave
    } });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "思考设置" }));
    await screen.findByText(/思考越深入/);
    const effort = screen.getByLabelText("思考程度");
    effort.focus();
    fireEvent.keyDown(effort, { key: "ArrowDown" });
    expect(effort).toHaveFocus();
    fireEvent.change(effort, { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("p1", 3, { reasoning_effort: "high" }));
    expect(props.onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(effort, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "模型与参数" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /切换模型，当前/ })).toHaveFocus();
  });

  it("loads service models on opening and searches/selects an unsaved model on the same service", async () => {
    const props = setup({
      profiles: profiles.map(profile => ({ ...profile, connection_id: profile.id === "p1" ? "service-a" : "service-b" })),
      serviceModels: { connection_id: "service-a", connection_name: "主连接", revision: 1, models: ["gpt-5.5", "grok-model", "claude-model"], busy: false, error: "" },
      onDiscover: vi.fn().mockResolvedValue(undefined), onServiceChange: vi.fn().mockResolvedValue(undefined)
    });
    openMenu();
    await waitFor(() => expect(props.onDiscover).toHaveBeenCalledOnce());
    expect(screen.getAllByRole("option", { name: "gpt-5.5" })).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索模型" }), { target: { value: "grok" } });
    expect(screen.queryByRole("option", { name: "claude-model" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "grok-model" }));
    expect(props.onServiceChange).toHaveBeenCalledWith("grok-model");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("keeps saved models usable after catalog failure and exposes a retry", () => {
    const props = setup({ serviceModels: { connection_id: "service-a", connection_name: "主连接", revision: 1, models: [], busy: false, error: "服务暂时不可用" }, onDiscover: vi.fn().mockResolvedValue(undefined) });
    openMenu();
    expect(screen.getByRole("alert")).toHaveTextContent("服务暂时不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(props.onDiscover).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("option", { name: "claude-x" }));
    expect(props.onChange).toHaveBeenCalledWith("p2");
  });
  it("opens a grouped menu and switches models", () => {
    const props = setup();
    openMenu();
    expect(screen.getByRole("listbox", { name: "选择模型" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "备用连接" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /跟随默认/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gpt-5.5" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("option", { name: "claude-x" }));
    expect(props.onChange).toHaveBeenCalledWith("p2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("searches saved models by model or connection without a service catalog", () => {
    setup();
    openMenu();
    const search = screen.getByRole("textbox", { name: "搜索模型" });
    fireEvent.change(search, { target: { value: "备用" } });
    expect(screen.getByRole("option", { name: "claude-x" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "gpt-5.5" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /跟随默认/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "GPT" } });
    expect(screen.getByRole("option", { name: "gpt-5.5" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "备用连接" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("没有匹配的模型")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("option", { name: "gpt-5.5" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: "备用连接" })).toBeInTheDocument();
  });

  it("closes on Escape and opens model settings from the footer", () => {
    const props = setup();
    openMenu();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "管理模型" }));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("asks the user to configure a model when none is available", () => {
    const props = setup({ configured: false });
    expect(screen.queryByRole("button", { name: /切换模型/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "未配置模型，去设置" }));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("warns when the model service is unavailable but still allows switching", () => {
    setup({ serviceUnavailable: true });
    expect(screen.getByRole("status")).toHaveTextContent("服务不可用");
    openMenu();
    expect(screen.getByText("当前模型服务不可用，可以换一个模型或检查设置")).toBeInTheDocument();
  });

  it("marks a disabled conversation model", () => {
    setup({ profileDisabled: true, selectedProfileId: "gone", currentModelName: "old-model" });
    expect(screen.getByRole("status")).toHaveTextContent("已停用");
    openMenu();
    expect(screen.getByRole("option", { name: /old-model/ })).toHaveAttribute("aria-disabled", "true");
  });
});
