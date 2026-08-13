import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";

function renderSidebar() {
  const props = {
    collapsed: false,
    activeView: "chat" as const,
    onToggle: vi.fn(),
    onLogout: vi.fn(),
    onGoHome: vi.fn(),
    onPrefetchPage: vi.fn(),
    onSelectView: vi.fn(),
    onSelectPreparationPage: vi.fn(),
    onOpenProfile: vi.fn()
  };
  render(<AppSidebar {...props} />);
  return props;
}

describe("AppSidebar", () => {
  afterEach(cleanup);

  it("keeps logout in the sidebar tools", () => {
    const props = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(props.onLogout).toHaveBeenCalledOnce();
  });

  it("separates the low-frequency logout action from the top layout control", () => {
    renderSidebar();

    const toggle = screen.getByRole("button", { name: "收起侧边栏" });
    expect(toggle.closest(".brand-tools")).toBeTruthy();
    expect(toggle).toHaveClass("sidebar-edge-toggle");
    expect(screen.getByRole("button", { name: "退出登录" }).closest(".sidebar-session-actions")).toBeTruthy();
    expect(screen.getByText("退出登录")).toBeInTheDocument();
  });

  it("keeps module navigation in the sidebar", () => {
    renderSidebar();

    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "求职" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "账户" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "简历分析" })).not.toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "对话" })).not.toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "设置" })).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "机会中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "项目解析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建对话" })).not.toBeInTheDocument();
  });

  it("opens a core workspace directly from the sidebar", () => {
    const props = renderSidebar();

    fireEvent.click(screen.getAllByRole("button", { name: "简历分析" })[0]);

    expect(props.onSelectView).toHaveBeenCalledWith("workbench");
  });

  it("prefetches a module when its navigation item is hovered", () => {
    const props = renderSidebar();

    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "简历分析" })[0]);

    expect(props.onPrefetchPage).toHaveBeenCalledWith("workbench");
  });

  it("reveals lower-frequency destinations from the mobile more menu", () => {
    renderSidebar();

    expect(screen.getAllByRole("button", { name: "个人资料" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "更多导航" }));

    expect(screen.getByLabelText("更多工作区")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "个人资料" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "设置" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "更多导航" })).toHaveAttribute("aria-expanded", "true");
  });
});
