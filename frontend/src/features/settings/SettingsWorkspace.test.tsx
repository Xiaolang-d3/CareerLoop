import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsOverview, SettingsWorkspace } from "./SettingsWorkspace";
import { emptyLibraryEditor } from "../../constants";
import { isLibraryReady } from "../home/home-metrics";
import type { SettingsPage } from "../../routing";

function renderOverview(
  overrides: Partial<Parameters<typeof SettingsOverview>[0]> = {}
) {
  const onOpen = overrides.onOpen ?? vi.fn();
  render(
    <SettingsOverview
      library={{ ...emptyLibraryEditor, name: "资料库里的名字" }}
      libraryReady
      accountEmail="owner@example.com"
      onOpen={onOpen}
      {...overrides}
    />
  );
  return { onOpen };
}

describe("SettingsOverview", () => {
  afterEach(cleanup);

  it("separates account security from the career library", () => {
    const { onOpen } = renderOverview({ accountName: "小林" });

    expect(screen.getByText("账号与安全")).toBeInTheDocument();
    expect(screen.getByText("小林")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("资料库")).toBeInTheDocument();
    expect(screen.getByText("资料库里的名字")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "了解 灯灯" })).toHaveAttribute("href", "#/about");

    fireEvent.click(screen.getByRole("button", { name: /账号与安全/ }));
    expect(onOpen).toHaveBeenCalledWith("account");
  });

  it("includes 模型设置 and opens the existing model page", () => {
    const { onOpen } = renderOverview({
      modelName: "gpt-5.5",
      apiKeyConfigured: true
    });

    expect(screen.getByText("模型设置")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.5")).toBeInTheDocument();
    expect(screen.getByText("密钥已配置")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /模型设置/ }));
    expect(onOpen).toHaveBeenCalledWith("model");
  });

  it("shows 资料已就绪 when the library page would look filled", () => {
    renderOverview({
      library: {
        ...emptyLibraryEditor,
        name: "小林",

      },
      libraryReady: isLibraryReady("小林", 1)
    });

    expect(screen.getByText("资料已就绪")).toBeInTheDocument();
    expect(screen.queryByText("待完善")).not.toBeInTheDocument();
  });

  it("keeps 待完善 only when the editor is still empty from the user's view", () => {
    renderOverview({
      library: emptyLibraryEditor,
      libraryReady: isLibraryReady(emptyLibraryEditor.name, 0)
    });

    expect(screen.getByText("待完善")).toBeInTheDocument();
    expect(screen.queryByText("资料已就绪")).not.toBeInTheDocument();
    expect(screen.getByText("尚未填写称呼")).toBeInTheDocument();
    expect(screen.getByText("尚未保存资料")).toBeInTheDocument();
  });

  it("does not flash 待完善 while career library is still loading", () => {
    renderOverview({
      library: emptyLibraryEditor,
      libraryReady: null
    });

    expect(screen.getByText("检查中")).toBeInTheDocument();
    expect(screen.queryByText("待完善")).not.toBeInTheDocument();
    expect(screen.queryByText("资料已就绪")).not.toBeInTheDocument();
  });
});

describe("SettingsWorkspace", () => {
  afterEach(cleanup);

  it("uses the shared content container for every settings page", () => {
    const pages: SettingsPage[] = ["overview", "model", "agent", "library", "account"];
    const { container, rerender } = render(
      <SettingsWorkspace page={pages[0]} onBack={vi.fn()}>
        <div data-testid="settings-content" />
      </SettingsWorkspace>
    );

    for (const page of pages) {
      rerender(
        <SettingsWorkspace page={page} onBack={vi.fn()}>
          <div data-testid="settings-content" />
        </SettingsWorkspace>
      );

      const workspace = container.querySelector(".settings-workspace");
      expect(workspace).toHaveClass(`settings-${page}`);
      expect(screen.getByTestId("settings-content").parentElement).toBe(workspace);
    }
  });

  it("keeps the library as a first-class page instead of nesting it under settings", () => {
    const onBack = vi.fn();
    render(
      <SettingsWorkspace page="library" onBack={onBack}>
        <div />
      </SettingsWorkspace>
    );

    expect(screen.queryByRole("navigation", { name: "设置路径" })).not.toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("isLibraryReady", () => {
  it("uses the saved name and enabled sources", () => {
    expect(isLibraryReady("小林", 1)).toBe(true);
    expect(isLibraryReady("小林", 0)).toBe(false);
    expect(isLibraryReady("", 1)).toBe(false);
  });
});
