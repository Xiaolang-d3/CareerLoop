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
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /切换模型/ }));
afterEach(cleanup);

describe("ComposerModelPicker", () => {
  it("opens a grouped menu and switches models", () => {
    const props = setup();
    openMenu();
    expect(screen.getByRole("listbox", { name: "选择模型" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "备用连接" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /跟随默认/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("option", { name: "claude-x" }));
    expect(props.onChange).toHaveBeenCalledWith("p2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
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
