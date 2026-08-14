import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppIdentityMenu } from "./AppIdentityMenu";

describe("AppIdentityMenu", () => {
  afterEach(cleanup);

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

    expect(screen.getByRole("menuitem", { name: "个人资料" })).toBeInTheDocument();
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
    const profile = screen.getByRole("menuitem", { name: "个人资料" });
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
