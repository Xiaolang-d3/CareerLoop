import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTopBar } from "./AppTopBar";
import { HomePage } from "../features/home/HomePage";
import { pageMeta, topbarSectionForPage } from "../constants";

function renderTopBar(overrides: Partial<Parameters<typeof AppTopBar>[0]> = {}) {
  const props = {
    section: topbarSectionForPage("settings", "模型设置"),
    title: "模型设置",
    userEmail: "owner@example.com",
    onOpenProfile: vi.fn(),
    onOpenAccount: vi.fn(),
    onLogout: vi.fn(),
    onPrefetchPage: vi.fn(),
    ...overrides
  };
  render(<AppTopBar {...props} />);
  return props;
}

describe("AppTopBar", () => {
  afterEach(cleanup);

  it("places the identity avatar in the global top bar", () => {
    renderTopBar();

    expect(screen.getByRole("heading", { level: 1, name: "模型设置" })).toBeInTheDocument();
    expect(screen.queryByText("设置")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "账号菜单" });
    expect(trigger.closest(".app-topbar")).toBeTruthy();
    expect(trigger.querySelector(".sidebar-identity-avatar")).toHaveTextContent("O");
  });

  it("shows only the current conversation title for chat", () => {
    renderTopBar({ section: topbarSectionForPage("chat", "新对话"), title: "新对话" });

    expect(screen.getByRole("heading", { level: 1, name: "新对话" })).toBeInTheDocument();
    expect(screen.queryByText("对话")).not.toBeInTheDocument();
  });

  it("renames the current conversation from the chat title", () => {
    const onTitleClick = vi.fn();
    renderTopBar({
      section: topbarSectionForPage("chat", "新对话"),
      title: "新对话",
      onTitleClick,
      titleClickLabel: "重命名对话"
    });

    fireEvent.click(screen.getByRole("button", { name: "重命名对话" }));

    expect(onTitleClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { level: 1, name: "新对话" })).toBeInTheDocument();
  });

  it("uses the workspace metadata title on the workbench landing page", () => {
    renderTopBar({
      section: topbarSectionForPage("workbench", pageMeta.workbench.title),
      title: pageMeta.workbench.title
    });

    expect(screen.getByRole("heading", { level: 1, name: "工作台" })).toBeInTheDocument();
    expect(document.querySelector(".app-topbar-context > span")).toBeNull();
  });

  it("uses the account nickname initial when available", () => {
    renderTopBar({ accountName: "小林" });

    expect(screen.getByRole("button", { name: "账号菜单" }).querySelector(".sidebar-identity-avatar")).toHaveTextContent("小");
  });

  it("keeps profile, account, and logout in the identity menu", () => {
    const props = renderTopBar({ accountName: "小林" });

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));

    expect(screen.getByRole("menu", { name: "账号菜单" })).toBeInTheDocument();
    expect(screen.getByText("小林")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "资料库" }));
    expect(props.onOpenProfile).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "账号与安全" }));
    expect(props.onOpenAccount).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(props.onLogout).toHaveBeenCalledOnce();
  });

  it("prefetches account settings when the menu item is hovered", () => {
    const props = renderTopBar();

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "账号与安全" }));

    expect(props.onPrefetchPage).toHaveBeenCalledWith("account");
  });

  it("keeps the same global top bar when switching home and workbench", () => {
    const identity = {
      userEmail: "owner@example.com",
      onOpenProfile: vi.fn(),
      onOpenAccount: vi.fn(),
      onLogout: vi.fn(),
      onPrefetchPage: vi.fn()
    };
    const home = (
      <HomePage
        displayName="小林"
        email="owner@example.com"
        profileName="张三"
        targetRole="后端工程师"
        jobs={[]}
        jobsLoaded
        profileLoaded
        onOpenAnalysis={vi.fn()}
        onOpenResume={vi.fn()}
        onOpenInterview={vi.fn()}
        onOpenProfile={vi.fn()}
      />
    );
    const workbench = (
      <section className="resume-module-shell">
        <header className="topbar ui-section-header">
          <nav aria-label="求职模块">
            <button type="button">匹配分析</button>
          </nav>
        </header>
      </section>
    );

    const { rerender } = render(
      <section className="content">
        <AppTopBar {...identity} />
        {home}
      </section>
    );

    const homeBar = document.querySelector("header.app-topbar");
    const homeTrigger = screen.getByRole("button", { name: "账号菜单" });
    expect(homeBar).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "首页" })).not.toBeInTheDocument();
    expect(homeTrigger.closest(".app-topbar")).toBe(homeBar);
    expect(screen.getByRole("heading", { name: "你好，张三" }).closest(".app-topbar")).toBeNull();

    rerender(
      <section className="content">
        <AppTopBar {...identity} />
        {workbench}
      </section>
    );

    const workbenchBar = document.querySelector("header.app-topbar");
    expect(workbenchBar).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "匹配分析" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("h1")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "账号菜单" }).closest(".app-topbar")).toBe(workbenchBar);
    expect(screen.getByRole("navigation", { name: "求职模块" }).closest(".app-topbar")).toBeNull();
    expect(document.querySelectorAll("header.app-topbar")).toHaveLength(1);
  });
});
