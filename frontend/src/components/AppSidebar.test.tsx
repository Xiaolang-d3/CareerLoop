import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";
import type { PlaceholderPage, SettingsPage, WorkbenchPage } from "../routing";
import type { ViewKey } from "../types";

function renderSidebar(
  identity?: ReactNode,
  collapsed = false,
  activeView: ViewKey = "chat",
  extras: { settingsPage?: SettingsPage; workbenchPage?: WorkbenchPage; placeholderPage?: PlaceholderPage } = {}
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

  it("exposes the Chinese three-column product navigation", () => {
    renderSidebar();
    const desktopNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(desktopNav).getAllByRole("button").map((item) => item.getAttribute("aria-label"))).toEqual([
      "首页",
      "我的知识库",
      "AI 问答",
      "知识整理",
      "内容创作",
      "灵感笔记",
      "回顾与复盘",
      "知识图谱",
      "智能工具",
      "设置"
    ]);
    expect(screen.queryByRole("button", { name: "机会中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "资料库" })).not.toBeInTheDocument();
  });

  it("opens home, library, chat, workspace, and settings from the sidebar", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getAllByRole("button", { name: "首页" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "我的知识库" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "AI 问答" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "内容创作" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "设置" })[0]);
    expect(props.onSelectNav).toHaveBeenCalledWith("dashboard");
    expect(props.onSelectNav).toHaveBeenCalledWith("library");
    expect(props.onSelectNav).toHaveBeenCalledWith("chat");
    expect(props.onSelectNav).toHaveBeenCalledWith("workspace");
    expect(props.onSelectNav).toHaveBeenCalledWith("settings");
  });

  it("opens stub destinations for organize and inspiration notes", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getAllByRole("button", { name: "知识整理" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "灵感笔记" })[0]);
    expect(props.onSelectNav).toHaveBeenCalledWith("organize");
    expect(props.onSelectNav).toHaveBeenCalledWith("notes");
  });

  it("prefetches a module when its navigation item is hovered", () => {
    const props = renderSidebar();
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "首页" })[0]);
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "我的知识库" })[0]);
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "内容创作" })[0]);
    expect(props.onPrefetchPage).toHaveBeenCalledWith("dashboard");
    expect(props.onPrefetchPage).toHaveBeenCalledWith("profile");
    expect(props.onPrefetchPage).toHaveBeenCalledWith("workbench");
  });

  it("shows primary destinations in the mobile navigation", () => {
    const props = renderSidebar();
    const mobile = screen.getByRole("navigation", { name: "移动端主导航" });
    expect(within(mobile).getByRole("button", { name: "首页" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "我的知识库" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "内容创作" })).toBeInTheDocument();
    expect(within(mobile).getByRole("button", { name: "AI 问答" })).toHaveAttribute("aria-current", "page");
    expect(within(mobile).getByRole("button", { name: "设置" })).toBeInTheDocument();
    fireEvent.click(within(mobile).getByRole("button", { name: "我的知识库" }));
    expect(props.onSelectNav).toHaveBeenCalledWith("library");
  });

  it("highlights library, workspace, chat, and settings on matching pages", () => {
    renderSidebar(undefined, false, "settings", { settingsPage: "profile" });
    const libraryNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(libraryNav).getByRole("button", { name: "我的知识库" })).toHaveAttribute("aria-current", "page");
    cleanup();

    renderSidebar(undefined, false, "workbench", { workbenchPage: "resume" });
    const workspaceNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(workspaceNav).getByRole("button", { name: "内容创作" })).toHaveAttribute("aria-current", "page");
    cleanup();

    renderSidebar(undefined, false, "settings", { settingsPage: "overview" });
    const settingsNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(settingsNav).getByRole("button", { name: "设置" })).toHaveAttribute("aria-current", "page");
    cleanup();

    renderSidebar(undefined, false, "placeholder", { placeholderPage: "organize" });
    const organizeNav = screen.getByRole("navigation", { name: "主导航" });
    expect(within(organizeNav).getByRole("button", { name: "知识整理" })).toHaveAttribute("aria-current", "page");
  });

  it("does not resurrect opportunity or analysis product entries", () => {
    renderSidebar(undefined, false, "opportunities");
    expect(screen.queryByRole("button", { name: "机会中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "项目解析" })).not.toBeInTheDocument();
  });
});
