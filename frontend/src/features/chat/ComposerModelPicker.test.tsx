import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerModelPicker } from "./ComposerModelPicker";

const profiles = [
  { id: "p1", model_name: "gpt-5.5", connection_name: "主连接" },
  { id: "p2", model_name: "claude-x", connection_name: "备用连接" }
];
function setup(overrides: Partial<Parameters<typeof ComposerModelPicker>[0]> = {}) {
  const props = {
    configured: true, currentModelName: "gpt-5.5", defaultModelName: "gpt-5.5", profiles, selectedProfileId: null,
    profileDisabled: false, serviceUnavailable: false, busy: false, canSelect: true,
    onChange: vi.fn(), onOpenSettings: vi.fn(), ...overrides
  };
  render(<ComposerModelPicker {...props} />);
  return props;
}
afterEach(cleanup);

describe("ComposerModelPicker", () => {
  it("switches between the default and configured models", () => {
    const props = setup();
    const select = screen.getByRole("combobox", { name: "切换模型" });
    expect(screen.getByRole("option", { name: "跟随默认（gpt-5.5）" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "p2" } });
    expect(props.onChange).toHaveBeenCalledWith("p2");
    fireEvent.change(select, { target: { value: "" } });
    expect(props.onChange).toHaveBeenLastCalledWith(null);
  });

  it("asks the user to configure a model when none is available", () => {
    const props = setup({ configured: false });
    expect(screen.queryByRole("combobox", { name: "切换模型" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "未配置模型，去设置" }));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("warns when the model service is unavailable but still allows switching", () => {
    const props = setup({ serviceUnavailable: true });
    expect(screen.getByRole("status")).toHaveTextContent("服务不可用");
    expect(screen.getByRole("combobox", { name: "切换模型" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "打开模型设置" }));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("marks a disabled conversation model and keeps it unselectable", () => {
    setup({ profileDisabled: true, selectedProfileId: "gone", currentModelName: "old-model" });
    expect(screen.getByRole("status")).toHaveTextContent("已停用");
    expect(screen.getByRole("option", { name: "old-model（已停用）" })).toBeDisabled();
  });
});
