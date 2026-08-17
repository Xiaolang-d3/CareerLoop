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
    expect(summary?.querySelector(".sidebar-identity-avatar")).toHaveAttribute("aria-hidden", "true");
    expect(summary?.querySelector(".sidebar-identity-glyph")).toHaveTextContent("小");
    expect(summary).toHaveTextContent("小林");
    expect(summary).toHaveTextContent("owner@example.com");
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

    expect(screen.getByRole("menuitem", { name: "求职资料" })).toBeInTheDocument();
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
        settingsPage="profile"
        onOpenProfile={onOpenProfile}
        onOpenAccount={onOpenAccount}
        onLogout={vi.fn()}
        onPrefetchPage={onPrefetchPage}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    const profile = screen.getByRole("menuitem", { name: "求职资料" });
    expect(profile).toHaveAttribute("aria-current", "page");
    fireEvent.focus(profile);
    fireEvent.click(profile);

    expect(onPrefetchPage).toHaveBeenCalledWith("profile");
    expect(onOpenProfile).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "账号与安全" }));
    expect(onOpenAccount).toHaveBeenCalledOnce();
  });
});
