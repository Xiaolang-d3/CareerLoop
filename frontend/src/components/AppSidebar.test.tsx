import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";
import type { SettingsPage } from "../routing";
import type { ViewKey } from "../types";

function renderSidebar(
  identity?: ReactNode,
  collapsed = false,
  activeView: ViewKey = "chat",
  extras: { settingsPage?: SettingsPage } = {}
) {
  const props = {
    collapsed,
    activeView,
    onToggle: vi.fn(),
    onGoHome: vi.fn(),
    onPrefetchPage: vi.fn(),
    onSelectNav: vi.fn(),
    identity,
    ...extras
  };
  render(<AppSidebar {...props} />);
  return props;
}

describe("AppSidebar", () => {
  afterEach(cleanup);

  it("returns to home from the brand mark", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(props.onGoHome).toHaveBeenCalledOnce();
  });

  it("keeps the collapse control in the sidebar footer", () => {
    renderSidebar();
    const toggle = screen.getByRole("button", { name: "收起侧边栏" });
    expect(toggle.closest(".sidebar-toggle-footer")).toBeTruthy();
    expect(toggle.closest(".brand")).toBeNull();
  });

  it("keeps accessible names and click behavior on the icon-only bottom toggle", () => {
    const expanded = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(expanded.onToggle).toHaveBeenCalledOnce();
    cleanup();
    const collapsed = renderSidebar(undefined, true);
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(collapsed.onToggle).toHaveBeenCalledOnce();
  });

  it("keeps the mobile identity slot without becoming a second app top bar", () => {
    renderSidebar(
      <button className="sidebar-identity" type="button" aria-label="账号菜单">
        <span className="sidebar-identity-avatar">O</span>
      </button>
    );
    expect(document.querySelector("header.app-topbar")).toBeNull();
    expect(screen.getByRole("button", { name: "账号菜单" }).closest(".sidebar-identity-slot")).toBeTruthy();
  });

  it("exposes the available product navigation", () => {
    renderSidebar();
    const desktopNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(desktopNav).getAllByRole("button").map((item) => item.getAttribute("aria-label"))).toEqual([
      "首页",
      "我的知识库",
      "AI 工作区",
      "设置"
    ]);
    expect(screen.queryByText("快速搜索…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "机会中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "资料库" })).not.toBeInTheDocument();
  });

  it("opens home, library, the AI workspace, and settings from the sidebar", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getAllByRole("button", { name: "首页" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "我的知识库" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "AI 工作区" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "设置" })[0]);
    expect(props.onSelectNav).toHaveBeenCalledWith("dashboard");
    expect(props.onSelectNav).toHaveBeenCalledWith("library");
    expect(props.onSelectNav).toHaveBeenCalledWith("chat");
    expect(props.onSelectNav).toHaveBeenCalledWith("settings");
  });

  it("prefetches a module when its navigation item is hovered", () => {
    const props = renderSidebar();
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "首页" })[0]);
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "我的知识库" })[0]);
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "AI 工作区" })[0]);
    expect(props.onPrefetchPage).toHaveBeenCalledWith("dashboard");
    expect(props.onPrefetchPage).toHaveBeenCalledWith("profile");
    expect(props.onPrefetchPage).toHaveBeenCalledWith("chat");
  });

  it("shows primary destinations in the mobile navigation", () => {
    const props = renderSidebar();
    const mobile = screen.getByRole("navigation", { name: "移动端主导航" });
    expect(within(mobile).getByRole("button", { name: "首页" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "我的知识库" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "AI 工作区" })).toHaveAttribute("aria-current", "page");
    expect(within(mobile).getByRole("button", { name: "设置" })).toBeInTheDocument();
    fireEvent.click(within(mobile).getByRole("button", { name: "我的知识库" }));
    expect(props.onSelectNav).toHaveBeenCalledWith("library");
  });

  it("highlights library, the AI workspace, and settings on matching pages", () => {
    renderSidebar(undefined, false, "settings", { settingsPage: "profile" });
    const libraryNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(libraryNav).getByRole("button", { name: "我的知识库" })).toHaveAttribute("aria-current", "page");
    cleanup();

    renderSidebar(undefined, false, "chat");
    const workspaceNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(workspaceNav).getByRole("button", { name: "AI 工作区" })).toHaveAttribute("aria-current", "page");
    cleanup();

    renderSidebar(undefined, false, "settings", { settingsPage: "overview" });
    const settingsNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(settingsNav).getByRole("button", { name: "设置" })).toHaveAttribute("aria-current", "page");
    cleanup();

  });

  it("does not expose retired opportunity or analysis product entries", () => {
    renderSidebar(undefined, false, "dashboard");
    expect(screen.queryByRole("button", { name: "机会中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "项目解析" })).not.toBeInTheDocument();
  });
});
