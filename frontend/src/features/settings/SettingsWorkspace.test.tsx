import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsOverview, SettingsWorkspace } from "./SettingsWorkspace";
import { emptyCandidateEditor } from "../../constants";
import { isSettingsProfileReady } from "../home/home-metrics";
import type { SettingsPage } from "../../routing";

function renderOverview(
  overrides: Partial<Parameters<typeof SettingsOverview>[0]> = {}
) {
  const onOpen = overrides.onOpen ?? vi.fn();
  render(
    <SettingsOverview
      profile={{ ...emptyCandidateEditor, name: "求职画像里的名字" }}
      profileReady
      accountEmail="owner@example.com"
      onOpen={onOpen}
      {...overrides}
    />
  );
  return { onOpen };
}

describe("SettingsOverview", () => {
  afterEach(cleanup);

  it("separates account security from the career profile", () => {
    const { onOpen } = renderOverview({ accountName: "小林" });

    expect(screen.getByText("账号与安全")).toBeInTheDocument();
    expect(screen.getByText("小林")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("求职资料")).toBeInTheDocument();
    expect(screen.getByText("求职画像里的名字")).toBeInTheDocument();

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

  it("shows 资料已就绪 when the profile page would look filled", () => {
    renderOverview({
      profile: {
        ...emptyCandidateEditor,
        name: "小林",
        resumeText: "负责 AI 产品从 0 到 1。"
      },
      profileReady: isSettingsProfileReady({
        name: "小林",
        resumeText: "负责 AI 产品从 0 到 1。"
      })
    });

    expect(screen.getByText("资料已就绪")).toBeInTheDocument();
    expect(screen.queryByText("待完善")).not.toBeInTheDocument();
  });

  it("keeps 待完善 only when the editor is still empty from the user's view", () => {
    renderOverview({
      profile: emptyCandidateEditor,
      profileReady: isSettingsProfileReady(emptyCandidateEditor)
    });

    expect(screen.getByText("待完善")).toBeInTheDocument();
    expect(screen.queryByText("资料已就绪")).not.toBeInTheDocument();
    expect(screen.getByText("尚未填写称呼")).toBeInTheDocument();
    expect(screen.getByText("尚未保存简历")).toBeInTheDocument();
  });

  it("does not flash 待完善 while career profile is still loading", () => {
    renderOverview({
      profile: emptyCandidateEditor,
      profileReady: null
    });

    expect(screen.getByText("检查中")).toBeInTheDocument();
    expect(screen.queryByText("待完善")).not.toBeInTheDocument();
    expect(screen.queryByText("资料已就绪")).not.toBeInTheDocument();
  });
});

describe("SettingsWorkspace", () => {
  afterEach(cleanup);

  it("uses the shared content container for every settings page", () => {
    const pages: SettingsPage[] = ["overview", "model", "agent", "profile", "account"];
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

  it("shows a settings breadcrumb on the career profile page", () => {
    const onBack = vi.fn();
    render(
      <SettingsWorkspace page="profile" onBack={onBack}>
        <div />
      </SettingsWorkspace>
    );

    const crumb = screen.getByRole("navigation", { name: "设置路径" });
    expect(crumb).toHaveTextContent("设置");
    expect(crumb).toHaveTextContent("求职资料");
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("isSettingsProfileReady", () => {
  it("treats a saved name plus resume as ready even without confirmed facts", () => {
    expect(isSettingsProfileReady({
      name: "小林",
      resumeText: "一段已保存的简历"
    })).toBe(true);
  });

  it("treats name plus documented direction, city, and skills as ready", () => {
    expect(isSettingsProfileReady({
      name: "小林",
      targetRole: "后端工程师",
      targetCity: "上海",
      skills: "Python，FastAPI"
    })).toBe(true);
  });

  it("stays incomplete when only a name or only a resume exists", () => {
    expect(isSettingsProfileReady({ name: "小林" })).toBe(false);
    expect(isSettingsProfileReady({ resumeText: "一段简历" })).toBe(false);
    expect(isSettingsProfileReady({})).toBe(false);
  });
});
