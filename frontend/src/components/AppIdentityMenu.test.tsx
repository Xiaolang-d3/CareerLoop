import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppIdentityMenu } from "./AppIdentityMenu";

describe("AppIdentityMenu", () => {
  afterEach(cleanup);

  it("keeps the avatar glyph decorative and optically wrapped", () => {
    render(
      <AppIdentityMenu
        userEmail="owner@example.com"
        accountName="小林"
        onOpenProfile={vi.fn()}
        onLogout={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: "账号菜单" });
    const avatar = trigger.querySelector(".sidebar-identity-avatar");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveTextContent("小");
    expect(avatar?.querySelector(".sidebar-identity-glyph")).toHaveTextContent("小");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const summary = screen.getByRole("menu", { name: "账号菜单" }).querySelector(".app-identity-summary");
    expect(summary?.querySelector(".sidebar-identity-avatar")).toBeNull();
    expect(summary).toHaveTextContent("小林");
    expect(summary).toHaveTextContent("owner@example.com");
  });

  it("separates the account name from the complete email when no nickname is set", () => {
    const email = "a-very-long-account-name@example.com";
    render(<AppIdentityMenu userEmail={email} onOpenProfile={vi.fn()} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    const summary = screen.getByRole("menu").querySelector(".app-identity-summary");
    expect(summary?.querySelector("strong")).toHaveTextContent("a-very-long-account-name");
    expect(summary?.querySelector("strong")).toHaveAttribute("title", "a-very-long-account-name");
    expect(summary?.querySelector("small")).toHaveTextContent(email);
    expect(summary?.querySelector("small")).toHaveAttribute("title", email);
  });

  it("supports keyboard navigation and restores focus on Escape", () => {
    render(<AppIdentityMenu userEmail="owner@example.com" onOpenProfile={vi.fn()} onOpenAccount={vi.fn()} onOpenSettings={vi.fn()} onLogout={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "账号菜单" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    const profile = screen.getByRole("menuitem", { name: "资料库" });
    const account = screen.getByRole("menuitem", { name: "账号与安全" });
    const logout = screen.getByRole("menuitem", { name: "退出登录" });
    expect(profile).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(account).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(logout).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(profile).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(logout).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(profile).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).not.toHaveAttribute("aria-controls");
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toHaveFocus();
  });

  it("dismisses on Tab, outside pointer input, and focus leaving the menu", () => {
    render(<><AppIdentityMenu userEmail="owner@example.com" onOpenProfile={vi.fn()} onLogout={vi.fn()} /><button>菜单之外</button></>);
    const trigger = screen.getByRole("button", { name: "账号菜单" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.blur(screen.getByRole("menuitem", { name: "资料库" }), { relatedTarget: null });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.blur(screen.getByRole("menuitem", { name: "资料库" }), { relatedTarget: screen.getByRole("button", { name: "菜单之外" }) });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the uploaded avatar and closes after settings or logout actions", () => {
    const onOpenSettings = vi.fn();
    const onLogout = vi.fn();
    render(<AppIdentityMenu userEmail="owner@example.com" avatarUrl="blob:test-avatar" onOpenProfile={vi.fn()} onOpenSettings={onOpenSettings} onLogout={onLogout} />);
    const trigger = screen.getByRole("button", { name: "账号菜单" });
    expect(trigger.querySelector("img")).toHaveAttribute("src", "blob:test-avatar");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "设置" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole("separator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(onLogout).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps account destinations out of application navigation", () => {
    const onOpenProfile = vi.fn();
    const onOpenAccount = vi.fn();
    const onLogout = vi.fn();

    render(
      <AppIdentityMenu
        userEmail="owner@example.com"
        onOpenProfile={onOpenProfile}
        onOpenAccount={onOpenAccount}
        onLogout={onLogout}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));

    expect(screen.getByRole("menuitem", { name: "资料库" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "账号与安全" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "对话" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "设置" })).not.toBeInTheDocument();
  });

  it("preserves active state, prefetching, and account actions", () => {
    const onOpenProfile = vi.fn();
    const onOpenAccount = vi.fn();
    const onPrefetchPage = vi.fn();

    render(
      <AppIdentityMenu
        userEmail="owner@example.com"
        activeView="settings"
        settingsPage="library"
        onOpenProfile={onOpenProfile}
        onOpenAccount={onOpenAccount}
        onLogout={vi.fn()}
        onPrefetchPage={onPrefetchPage}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    const profile = screen.getByRole("menuitem", { name: "资料库" });
    expect(profile).toHaveAttribute("aria-current", "page");
    fireEvent.focus(profile);
    fireEvent.click(profile);

    expect(onPrefetchPage).toHaveBeenCalledWith("library");
    expect(onOpenProfile).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "账号与安全" }));
    expect(onOpenAccount).toHaveBeenCalledOnce();
  });
});
