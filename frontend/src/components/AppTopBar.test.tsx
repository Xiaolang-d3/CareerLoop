import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTopBar } from "./AppTopBar";
import { topbarSectionForPage } from "../constants";

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

});
