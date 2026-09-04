import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";
import type { SettingsPage, WorkbenchPage } from "../routing";
import type { ViewKey } from "../types";

function renderSidebar(
  identity?: ReactNode,
  collapsed = false,
  activeView: ViewKey = "chat",
  extras: { settingsPage?: SettingsPage; workbenchPage?: WorkbenchPage } = {}
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
    expect(toggle).toHaveClass("sidebar-toggle", "sidebar-bottom-toggle");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("title", "收起侧边栏");
    expect(toggle).toHaveAttribute("aria-label", "收起侧边栏");
    expect(toggle).not.toHaveTextContent("收起侧边栏");
    toggle.focus();
    expect(toggle).toHaveFocus();
  });

  it("keeps accessible names and click behavior on the icon-only bottom toggle", () => {
    const expanded = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(expanded.onToggle).toHaveBeenCalledOnce();
    cleanup();

    const collapsed = renderSidebar(undefined, true);
    const toggle = screen.getByRole("button", { name: "展开侧边栏" });
    expect(toggle).toHaveClass("sidebar-bottom-toggle");
    expect(toggle.closest(".sidebar-toggle-footer")).toBeTruthy();
    expect(toggle).toHaveAttribute("title", "展开侧边栏");
    expect(toggle).toHaveAttribute("aria-label", "展开侧边栏");
    expect(toggle).not.toHaveTextContent("展开侧边栏");
    fireEvent.click(toggle);
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

  it("places the identity control in the header slot instead of a session footer", () => {
    renderSidebar(
      <button className="sidebar-identity" type="button" aria-label="账号菜单">
        <span className="sidebar-identity-avatar">O</span>
      </button>
    );

    const trigger = screen.getByRole("button", { name: "账号菜单" });
    expect(trigger.closest(".sidebar-identity-slot")).toBeTruthy();
    expect(trigger.closest(".sidebar-session-actions")).toBeNull();
    expect(document.querySelector(".sidebar-session-actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "退出登录" })).not.toBeInTheDocument();
  });

  it("keeps only home, library, workspace, and chat in product navigation", () => {
    renderSidebar();

    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    const desktopNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(desktopNav).getByText("从对话开始")).toHaveClass("nav-label");
    expect(within(desktopNav).getAllByRole("button").map((item) => item.getAttribute("aria-label"))).toEqual([
      "对话",
      "首页",
      "资料库",
      "工作台"
    ]);
    expect(screen.getAllByRole("button", { name: "首页" })).not.toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "资料库" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "工作台" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "对话" })).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "分析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "求职" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "定制简历" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "个人资料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "机会中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "项目解析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建对话" })).not.toBeInTheDocument();
  });

  it("opens home, library, and workspace from the sidebar", () => {
    const props = renderSidebar();

    fireEvent.click(screen.getAllByRole("button", { name: "首页" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "资料库" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "工作台" })[0]);

    expect(props.onSelectNav).toHaveBeenCalledWith("dashboard");
    expect(props.onSelectNav).toHaveBeenCalledWith("library");
    expect(props.onSelectNav).toHaveBeenCalledWith("workspace");
  });

  it("prefetches a module when its navigation item is hovered", () => {
    const props = renderSidebar();

    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "首页" })[0]);
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "资料库" })[0]);
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "工作台" })[0]);

    expect(props.onPrefetchPage).toHaveBeenCalledWith("dashboard");
    expect(props.onPrefetchPage).toHaveBeenCalledWith("profile");
    expect(props.onPrefetchPage).toHaveBeenCalledWith("workbench");
  });

  it("shows the four destinations in the mobile navigation", () => {
    const props = renderSidebar();
    const mobile = screen.getByRole("navigation", { name: "移动端主导航" });

    expect(within(mobile).getByRole("button", { name: "首页" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "资料库" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "工作台" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "对话" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "更多导航" })).not.toBeInTheDocument();

    fireEvent.focus(within(mobile).getByRole("button", { name: "资料库" }));
    fireEvent.click(within(mobile).getByRole("button", { name: "资料库" }));

    expect(props.onPrefetchPage).toHaveBeenCalledWith("profile");
    expect(props.onSelectNav).toHaveBeenCalledWith("library");
  });

  it("highlights library and workspace only on those pages", () => {
    renderSidebar(undefined, false, "settings", { settingsPage: "profile" });
    const evidenceNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(evidenceNav).getByRole("button", { name: "资料库" })).toHaveAttribute("aria-current", "page");
    expect(within(evidenceNav).getByRole("button", { name: "工作台" })).not.toHaveAttribute("aria-current");
    expect(within(evidenceNav).getByRole("button", { name: "首页" })).not.toHaveAttribute("aria-current");
    cleanup();

    renderSidebar(undefined, false, "workbench", { workbenchPage: "resume" });
    const resumeNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(resumeNav).getByRole("button", { name: "工作台" })).toHaveAttribute("aria-current", "page");
    expect(within(resumeNav).getByRole("button", { name: "资料库" })).not.toHaveAttribute("aria-current");
    cleanup();

    renderSidebar(undefined, false, "workbench", { workbenchPage: "index" });
    const analysisNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(analysisNav).getByRole("button", { name: "工作台" })).not.toHaveAttribute("aria-current");
    expect(within(analysisNav).getByRole("button", { name: "资料库" })).not.toHaveAttribute("aria-current");
  });

  it("does not steal evidence or resume highlight on opportunity, interview, or project deep links", () => {
    renderSidebar(undefined, false, "opportunities");
    const homeNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(homeNav).getByRole("button", { name: "首页" })).not.toHaveAttribute("aria-current");
    expect(within(homeNav).getByRole("button", { name: "资料库" })).not.toHaveAttribute("aria-current");
    expect(within(homeNav).getByRole("button", { name: "工作台" })).not.toHaveAttribute("aria-current");
    expect(within(homeNav).getByRole("button", { name: "对话" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button", { name: "机会中心" })).not.toBeInTheDocument();
    cleanup();

    renderSidebar(undefined, false, "interview-prep");
    const prepNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(prepNav).getByRole("button", { name: "资料库" })).not.toHaveAttribute("aria-current");
    expect(within(prepNav).getByRole("button", { name: "工作台" })).not.toHaveAttribute("aria-current");
    expect(within(prepNav).getByRole("button", { name: "首页" })).not.toHaveAttribute("aria-current");
    expect(within(prepNav).getByRole("button", { name: "对话" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button", { name: "项目解析" })).not.toBeInTheDocument();
    cleanup();

    renderSidebar(undefined, false, "project-lab");
    const labNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(labNav).getByRole("button", { name: "资料库" })).not.toHaveAttribute("aria-current");
    expect(within(labNav).getByRole("button", { name: "工作台" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button", { name: "项目" })).not.toBeInTheDocument();
  });
});
