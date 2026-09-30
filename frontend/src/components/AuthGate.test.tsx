import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";

function authConfig(setupRequired = false) {
  return new Response(JSON.stringify({ enabled: true, setup_required: setupRequired, registration_open: true }), { status: 200 });
}

describe("AuthGate", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("validates an existing session without requesting sign-in configuration", async () => {
    window.sessionStorage.setItem("careerloop-auth-token", "saved-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/me")) {
        return new Response(JSON.stringify({ user: { email: "owner@example.com" } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => <div>应用已就绪</div>}</AuthGate>);

    await screen.findByText("应用已就绪");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("careerloop-auth-token")).toBe("saved-token");
    expect(window.sessionStorage.getItem("careerloop-auth-token")).toBeNull();
  });

  it("keeps a saved session when the backend is briefly unavailable", async () => {
    window.localStorage.setItem("careerloop-auth-token", "saved-token");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

    render(<AuthGate apiBase="https://app.example.com">{() => <div>应用已就绪</div>}</AuthGate>);

    expect(await screen.findByText("Failed to fetch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeInTheDocument();
    expect(window.localStorage.getItem("careerloop-auth-token")).toBe("saved-token");
  });

  it("only signs out when the saved token is rejected", async () => {
    window.localStorage.setItem("careerloop-auth-token", "expired-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/me")) {
        return new Response(JSON.stringify({ detail: "登录状态已失效，请重新登录" }), { status: 401 });
      }
      if (path.endsWith("/auth/config")) return authConfig();
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => <div>应用已就绪</div>}</AuthGate>);

    expect(await screen.findByLabelText("邮箱")).toBeInTheDocument();
    expect(window.localStorage.getItem("careerloop-auth-token")).toBeNull();
  });

  it("renders a local-only account form without a captcha", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/config")) return authConfig();
      throw new Error(`Unexpected request: ${String(input)}`);
    }));

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    expect(await screen.findByLabelText("邮箱")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("密码")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryByLabelText("验证码")).not.toBeInTheDocument();
    expect(screen.getByText("账户、资料和对话只保存在这台设备上，不是云端账号。")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("auth-gate");
    expect(screen.getByRole("heading", { name: "CAREERLOOP" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "CareerLoop 如何与你协作" })).toBeInTheDocument();
    expect(screen.getByText(/沉淀到你的本地知识库/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
  });

  it("keeps credential errors generic", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) return authConfig();
      if (path.endsWith("/auth/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ detail: "邮箱或密码不正确" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);
    await screen.findByLabelText("邮箱");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("邮箱或密码不正确，请核对后重试。");
  });

  it("offers reconnect when login cannot reach the server", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) return authConfig();
      if (path.endsWith("/auth/login") && init?.method === "POST") throw new TypeError("Failed to fetch");
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);
    await screen.findByLabelText("邮箱");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("网络已断开，请检查连接后点重新连接。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeInTheDocument();
  });

  it("validates fields before calling login", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/config")) return authConfig();
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);
    await screen.findByLabelText("邮箱");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "invalid" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("请输入有效的邮箱地址")).toBeInTheDocument();
    expect(screen.getByText("密码至少 8 位")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets a visitor create another local account", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) return authConfig();
      if (path.endsWith("/auth/register") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ email: "new@example.com", password: "password-123" });
        return new Response(JSON.stringify({ access_token: "new-token", user: { email: "new@example.com" } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{(_token, _logout, user) => <div>已进入 {user.email}</div>}</AuthGate>);
    await screen.findByLabelText("邮箱");
    fireEvent.click(screen.getByRole("button", { name: "没有账号？创建账号" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await screen.findByText("已进入 new@example.com")).toBeInTheDocument();
    expect(window.localStorage.getItem("careerloop-auth-token")).toBe("new-token");
  });

  it("respects reduced motion on the decorative background", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/config")) return authConfig();
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion") && query.includes("reduce"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    }));
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);
    await screen.findByLabelText("邮箱");
    const gate = screen.getByRole("main");
    expect(gate.querySelector(".auth-grid")).not.toBeNull();
    fireEvent.pointerMove(gate, { clientX: 200, clientY: 400 });
    expect(gate.style.getPropertyValue("--cell-x")).toBe("");
    expect(raf).not.toHaveBeenCalled();
  });
});
