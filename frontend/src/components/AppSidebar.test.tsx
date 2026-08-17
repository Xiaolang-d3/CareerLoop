import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";

function renderSidebar(identity?: ReactNode, collapsed = false, activeView: "dashboard" | "workbench" | "chat" | "settings" | "opportunities" | "interview-prep" | "project-lab" = "chat") {
  const props = {
    collapsed,
    activeView,
    onToggle: vi.fn(),
    onGoHome: vi.fn(),
    onPrefetchPage: vi.fn(),
    onSelectView: vi.fn(),
    identity
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

  it("keeps module navigation in the sidebar", () => {
    renderSidebar();

    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "主导航" })).getByText("工作台")).toHaveClass("nav-label");
    expect(screen.queryByRole("region", { name: "求职" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "账户" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "首页" })).not.toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "分析" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "项目" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "求职" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "定制简历" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "对话" })).not.toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "设置" })).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "个人资料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "机会中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "项目解析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建对话" })).not.toBeInTheDocument();
  });

  it("opens home and the analysis workspace from the sidebar", () => {
    const props = renderSidebar();

    fireEvent.click(screen.getAllByRole("button", { name: "首页" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "分析" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "项目" })[0]);

    expect(props.onSelectView).toHaveBeenCalledWith("dashboard");
    expect(props.onSelectView).toHaveBeenCalledWith("workbench");
    expect(props.onSelectView).toHaveBeenCalledWith("project-lab");
  });

  it("prefetches a module when its navigation item is hovered", () => {
    const props = renderSidebar();

    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "首页" })[0]);
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "分析" })[0]);

    expect(props.onPrefetchPage).toHaveBeenCalledWith("dashboard");
    expect(props.onPrefetchPage).toHaveBeenCalledWith("workbench");
  });

  it("shows all five destinations in the mobile navigation", () => {
    const props = renderSidebar();
    const mobile = screen.getByRole("navigation", { name: "移动端主导航" });

    expect(within(mobile).getByRole("button", { name: "首页" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "分析" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "项目" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "对话" })).toHaveAttribute("aria-current", "page");
    expect(within(mobile).getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更多导航" })).not.toBeInTheDocument();

    fireEvent.focus(within(mobile).getByRole("button", { name: "设置" }));
    fireEvent.click(within(mobile).getByRole("button", { name: "设置" }));

    expect(props.onPrefetchPage).toHaveBeenCalledWith("settings");
    expect(props.onSelectView).toHaveBeenCalledWith("settings");
  });

  it("does not pretend a sidebar item is current on opportunity or project-prep deep links", () => {
    renderSidebar(undefined, false, "opportunities");
    const homeNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(homeNav).getByRole("button", { name: "首页" })).not.toHaveAttribute("aria-current");
    expect(within(homeNav).getByRole("button", { name: "分析" })).not.toHaveAttribute("aria-current");
    expect(within(homeNav).getByRole("button", { name: "对话" })).not.toHaveAttribute("aria-current");
    expect(within(homeNav).getByRole("button", { name: "设置" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button", { name: "机会中心" })).not.toBeInTheDocument();
    cleanup();

    renderSidebar(undefined, false, "interview-prep");
    const prepNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(prepNav).getByRole("button", { name: "分析" })).not.toHaveAttribute("aria-current");
    expect(within(prepNav).getByRole("button", { name: "项目" })).not.toHaveAttribute("aria-current");
    expect(within(prepNav).getByRole("button", { name: "首页" })).not.toHaveAttribute("aria-current");
    expect(within(prepNav).getByRole("button", { name: "对话" })).not.toHaveAttribute("aria-current");
    expect(within(prepNav).getByRole("button", { name: "设置" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button", { name: "项目解析" })).not.toBeInTheDocument();
    cleanup();

    renderSidebar(undefined, false, "project-lab");
    const labNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(labNav).getByRole("button", { name: "项目" })).toHaveAttribute("aria-current", "page");
  });
});
