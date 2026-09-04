import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsPage } from "./AccountSettingsPage";
import type { AuthUser } from "../../components/AuthGate";

const account: AuthUser = {
  id: 1,
  email: "owner@example.com",
  display_name: "",
  has_avatar: false
};

function props(overrides: Partial<Parameters<typeof AccountSettingsPage>[0]> = {}) {
  return {
    apiBase: "https://app.example.com",
    accessToken: "token-1",
    account,
    avatarUrl: null,
    onAccountChange: vi.fn(),
    onPasswordChanged: vi.fn(),
    ...overrides
  };
}

describe("AccountSettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps account identity separate from the career profile", () => {
    render(<AccountSettingsPage {...props()} />);

    expect(screen.getByText("这些信息跟随登录账号，和资料库内容分开。换设备登录后仍然有效。")).toBeInTheDocument();
    expect(document.querySelector(".account-avatar-glyph")).toHaveTextContent("O");
    expect(screen.getByText("登录邮箱")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "登录邮箱" })).not.toBeInTheDocument();
    expect(screen.queryByText("我的求职资料")).not.toBeInTheDocument();
  });

  it("only asks to save a nickname after it changes", () => {
    render(<AccountSettingsPage {...props()} />);
    expect(screen.queryByRole("button", { name: "保存昵称" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "小林" } });

    expect(screen.getByRole("button", { name: "保存昵称" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("lets the person discard an unsaved nickname", () => {
    render(<AccountSettingsPage {...props({ account: { ...account, display_name: "小林" } })} />);
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "小王" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByLabelText("昵称")).toHaveValue("小林");
    expect(screen.queryByRole("button", { name: "保存昵称" })).not.toBeInTheDocument();
  });

  it("saves a nickname to the signed-in account", async () => {
    const onAccountChange = vi.fn();
    const nextUser = { ...account, display_name: "小林" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://app.example.com/auth/me");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ display_name: "小林" });
      return new Response(JSON.stringify({ user: nextUser }), { status: 200 });
    }));

    render(<AccountSettingsPage {...props({ onAccountChange })} />);
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "小林" } });
    fireEvent.click(screen.getByRole("button", { name: "保存昵称" }));

    await waitFor(() => expect(onAccountChange).toHaveBeenCalledWith(nextUser));
    expect(await screen.findByText("昵称已保存")).toBeInTheDocument();
  });

  it("rejects mismatched new passwords before calling the API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountSettingsPage {...props()} />);

    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "other-password" } });

    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的新密码不一致");
    expect(screen.getByRole("button", { name: "更新密码" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the session after a successful password change", async () => {
    const onPasswordChanged = vi.fn();
    const nextUser = { ...account, display_name: "小林" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://app.example.com/auth/me/password");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ access_token: "token-2", user: nextUser }), { status: 200 });
    }));

    render(<AccountSettingsPage {...props({ onPasswordChanged })} />);
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));

    await waitFor(() => expect(onPasswordChanged).toHaveBeenCalledWith("token-2", nextUser));
    expect(await screen.findByText("密码已更新，当前登录仍然有效")).toBeInTheDocument();
  });

  it("uploads an avatar for the current account", async () => {
    const onAccountChange = vi.fn();
    const nextUser = { ...account, has_avatar: true };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://app.example.com/auth/me/avatar");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ user: nextUser }), { status: 200 });
    }));

    render(<AccountSettingsPage {...props({ onAccountChange })} />);
    const file = new File(["avatar"], "face.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] }
    });

    await waitFor(() => expect(onAccountChange).toHaveBeenCalledWith(nextUser));
    expect(await screen.findByText("头像已更新")).toBeInTheDocument();
  });

  it("checks the avatar locally before uploading", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountSettingsPage {...props()} />);
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "face.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] }
    });

    expect(screen.getByRole("alert")).toHaveTextContent("图片不能超过 2MB");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
