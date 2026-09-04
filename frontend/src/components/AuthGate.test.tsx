import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";

describe("AuthGate", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("validates an existing session without requesting the sign-in configuration or captcha", async () => {
    window.sessionStorage.setItem("careerloop-auth-token", "saved-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/me")) {
        return new Response(JSON.stringify({ user: { email: "owner@example.com" } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthGate apiBase="https://app.example.com">
        {() => <div>应用已就绪</div>}
      </AuthGate>
    );

    await screen.findByText("应用已就绪");
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://app.example.com/auth/me"
    ]);
    expect(window.localStorage.getItem("careerloop-auth-token")).toBe("saved-token");
    expect(window.sessionStorage.getItem("careerloop-auth-token")).toBeNull();
  });

  it("restores a session from localStorage after a reload", async () => {
    window.localStorage.setItem("careerloop-auth-token", "persisted-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/me")) {
        return new Response(JSON.stringify({ user: { email: "owner@example.com" } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthGate apiBase="https://app.example.com">
        {() => <div>应用已就绪</div>}
      </AuthGate>
    );

    await screen.findByText("应用已就绪");
    expect(window.localStorage.getItem("careerloop-auth-token")).toBe("persisted-token");
  });

  it("keeps the saved session when the backend is briefly unavailable", async () => {
    window.localStorage.setItem("careerloop-auth-token", "saved-token");
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthGate apiBase="https://app.example.com">
        {() => <div>应用已就绪</div>}
      </AuthGate>
    );

    expect(await screen.findByText("Failed to fetch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeInTheDocument();
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("careerloop-auth-token")).toBe("saved-token");
  });

  it("only signs out when the saved token is actually rejected", async () => {
    window.localStorage.setItem("careerloop-auth-token", "expired-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/me")) {
        return new Response(JSON.stringify({ detail: "登录状态已失效，请重新登录" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>", accessible_text: "A B C D E" }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => <div>应用已就绪</div>}</AuthGate>);

    expect(await screen.findByLabelText("邮箱")).toBeInTheDocument();
    expect(screen.queryByText("应用已就绪")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("careerloop-auth-token")).toBeNull();
  });

  it("renders an inline captcha without a second image request", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>", accessible_text: "A B C D E" }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    const captchaImage = await screen.findByAltText("图形验证码");
    expect(captchaImage.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    const captchaRow = captchaImage.closest(".auth-captcha-row");
    expect(captchaRow).not.toBeNull();
    expect(captchaRow).toContainElement(screen.getByLabelText("验证码"));
    expect(captchaRow).toContainElement(screen.getByRole("button", { name: "更换验证码" }));
    expect(screen.queryByRole("group", { name: "验证码形式" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文字验证码" })).not.toBeInTheDocument();
    expect(screen.queryByText("验证码：A B C D E")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      "https://app.example.com/auth/config",
      "https://app.example.com/auth/captcha"
    ]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("main")).toHaveClass("auth-gate");
    expect(document.querySelector(".auth-atmosphere")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector(".auth-atmosphere .auth-grid")).toBeInTheDocument();
    expect(document.querySelector(".auth-atmosphere .auth-cell")).toBeInTheDocument();
    expect(document.querySelector(".auth-atmosphere .auth-gleam")).toBeInTheDocument();
    expect(document.querySelector(".auth-atmosphere .auth-pointer")).not.toBeInTheDocument();
    expect(document.querySelector(".auth-atmosphere .auth-grid-surface")).not.toBeInTheDocument();
    expect(document.querySelector(".auth-atmosphere .auth-scales-a")).not.toBeInTheDocument();
    expect(document.querySelector(".auth-atmosphere .auth-scales-b")).not.toBeInTheDocument();
    expect(document.querySelector(".auth-atmosphere .auth-aurora")).not.toBeInTheDocument();
    expect(document.querySelector(".auth-atmosphere .auth-ripple")).not.toBeInTheDocument();
    expect(document.querySelector(".auth-card")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toHaveClass("auth-submit");
    expect(screen.getByRole("heading", { name: "CAREERLOOP" })).toBeInTheDocument();
    const logo = document.querySelector("img.auth-logo");
    expect(logo).toHaveAttribute("src", "/careerloop-mark-v2.png");
    expect(logo).toHaveAttribute("draggable", "false");
    expect(logo).toHaveAttribute("alt", "");
    expect(screen.queryByText("职业成长助手")).not.toBeInTheDocument();
    expect(screen.queryByText("登录继续你的求职计划")).not.toBeInTheDocument();
    expect(screen.queryByText("登录状态只保存在当前标签页，关闭后需要重新登录。")).not.toBeInTheDocument();
    expect(screen.queryByText("使用账户进入你的职业成长工作台。")).not.toBeInTheDocument();
    expect(screen.queryByText("验证身份 → 进入求职系统，登录只在当前标签页。")).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "CareerLoop 如何与你协作" })).toBeInTheDocument();
    expect(screen.getByText("让资料在每次对话中持续发挥作用")).toBeInTheDocument();
    expect(screen.getByText("整理资料")).toBeInTheDocument();
    expect(screen.getByText("开始对话")).toBeInTheDocument();
    expect(screen.getByText("沉淀成果")).toBeInTheDocument();
    expect(screen.getByText("有据可循")).toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("密码")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "显示密码" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隐藏密码" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "显示密码" })).toHaveAttribute("aria-pressed", "false");
  });

  it("explains a rejected captcha instead of exposing a raw validation status", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>", accessible_text: "A B C D E" }), { status: 200 });
      }
      if (path.endsWith("/auth/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ detail: "验证码不正确或已过期" }), { status: 422, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    await screen.findByAltText("图形验证码");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-123" } });
    fireEvent.change(screen.getByPlaceholderText("输入 5 位字符"), { target: { value: "ABCDE" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("验证码不正确或已过期，已为你更换，请重新输入。")).toBeInTheDocument();
    expect(screen.queryByText(/请求失败（422）/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("验证码")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("验证码")).toHaveValue("");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/auth/captcha")).length).toBeGreaterThan(1);
  });

  it("keeps credential errors generic and still refreshes the captcha", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>", accessible_text: "A B C D E" }), { status: 200 });
      }
      if (path.endsWith("/auth/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ detail: "邮箱或密码不正确" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    await screen.findByAltText("图形验证码");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-123" } });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "ABCDE" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("邮箱或密码不正确，请核对后重试。验证码已更新。");
    expect(screen.queryByText(/不存在/)).not.toBeInTheDocument();
  });

  it("offers reconnect when the login request cannot reach the server", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>", accessible_text: "A B C D E" }), { status: 200 });
      }
      if (path.endsWith("/auth/login") && init?.method === "POST") {
        throw new TypeError("Failed to fetch");
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    await screen.findByAltText("图形验证码");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-123" } });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "ABCDE" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("网络已断开，请检查连接后点重新连接。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeInTheDocument();
  });

  it("checks the captcha locally before calling login", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>", accessible_text: "A B C D E" }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    await screen.findByAltText("图形验证码");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-123" } });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "AB" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("请输入图中的 5 位验证码")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/auth/login") && (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("refreshes the graphic captcha without exposing a text mode", async () => {
    let captchaCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        captchaCalls += 1;
        const letter = captchaCalls === 1 ? "A" : "B";
        return new Response(JSON.stringify({
          captcha_id: `captcha-${captchaCalls}`,
          svg: `<svg><text>${letter}</text><text>${letter}</text><text>${letter}</text><text>${letter}</text><text>${letter}</text></svg>`,
          accessible_text: `${letter} ${letter} ${letter} ${letter} ${letter}`
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    expect((await screen.findByAltText("图形验证码")).getAttribute("src")).toContain(encodeURIComponent("<text>A</text>"));
    expect(screen.queryByRole("button", { name: "文字验证码" })).not.toBeInTheDocument();
    expect(screen.queryByText("验证码：A A A A A")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更换验证码" }));
    expect(await screen.findByAltText("图形验证码")).toHaveAttribute("src", expect.stringContaining(encodeURIComponent("<text>B</text>")));
    expect(screen.queryByText("验证码：B B B B B")).not.toBeInTheDocument();
    expect(captchaCalls).toBe(2);
  });

  it("strips captcha spaces and refreshes when the image is clicked", async () => {
    let captchaCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        captchaCalls += 1;
        return new Response(JSON.stringify({
          captcha_id: `captcha-${captchaCalls}`,
          svg: `<svg><text>${captchaCalls}</text></svg>`,
          accessible_text: "A B C D E"
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    await screen.findByAltText("图形验证码");
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "a b c d e" } });
    expect(screen.getByLabelText("验证码")).toHaveValue("ABCDE");
    fireEvent.click(screen.getByRole("button", { name: "点击更换验证码" }));
    expect(screen.getByLabelText("验证码")).toHaveValue("");
    expect(await screen.findByAltText("图形验证码")).toHaveAttribute("src", expect.stringContaining(encodeURIComponent("<text>2</text>")));
    expect(captchaCalls).toBe(2);
  });

  it("lets a visitor switch to registration and create an account", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false, registration_open: true }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>", accessible_text: "A B C D E" }), { status: 200 });
      }
      if (path.endsWith("/auth/register") && init?.method === "POST") {
        return new Response(JSON.stringify({ access_token: "new-token", user: { email: "new@example.com" } }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthGate apiBase="https://app.example.com">
        {(_token, _logout, user) => <div>已进入 {user.email}</div>}
      </AuthGate>
    );

    await screen.findByAltText("图形验证码");
    fireEvent.click(screen.getByRole("button", { name: "没有账号？创建账号" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password-123" } });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "ABCDE" } });
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await screen.findByText("已进入 new@example.com")).toBeInTheDocument();
    expect(window.localStorage.getItem("careerloop-auth-token")).toBe("new-token");
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/auth/register") && (init as RequestInit | undefined)?.method === "POST")).toBe(true);
  });

  it("tracks a quiet pointer highlight on the login plan", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>" }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    }));

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    await screen.findByAltText("图形验证码");
    const gate = screen.getByRole("main");
    expect(gate.querySelector(".auth-atmosphere")).toHaveAttribute("aria-hidden", "true");
    expect(gate.querySelector(".auth-grid")).not.toBeNull();
    expect(gate.querySelector(".auth-cell")).not.toBeNull();
    expect(gate.querySelector(".auth-gleam")).not.toBeNull();
    expect(gate.querySelector(".auth-pointer")).toBeNull();
    expect(gate.querySelector(".auth-grid-surface")).toBeNull();
    expect(gate.querySelector(".auth-scales-a")).toBeNull();
    expect(gate.querySelector(".auth-scales-b")).toBeNull();
    expect(gate.querySelector(".auth-aurora")).toBeNull();
    expect(gate.querySelector(".auth-ripple")).toBeNull();
    const grid = gate.querySelector(".auth-grid");
    expect(grid).not.toBeNull();
    vi.spyOn(grid as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({})
    });
    fireEvent.pointerMove(gate, { clientX: 200, clientY: 400 });
    expect(parseFloat(gate.style.getPropertyValue("--cell-x"))).toBe(180);
    expect(parseFloat(gate.style.getPropertyValue("--cell-y"))).toBe(396);
    expect(gate.style.getPropertyValue("--linger")).toBe("1");

    fireEvent.pointerMove(gate, { clientX: 800, clientY: 100 });
    expect(parseFloat(gate.style.getPropertyValue("--cell-x"))).toBe(792);
    expect(parseFloat(gate.style.getPropertyValue("--cell-y"))).toBe(72);

    fireEvent.pointerLeave(gate);
    expect(gate.style.getPropertyValue("--linger")).toBe("0");
  });

  it("leaves the backdrop grid still when motion is reduced", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>" }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
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

    await screen.findByAltText("图形验证码");
    const gate = screen.getByRole("main");
    expect(gate.querySelector(".auth-grid")).not.toBeNull();
    expect(gate.querySelector(".auth-cell")).not.toBeNull();
    expect(gate.querySelector(".auth-gleam")).not.toBeNull();
    expect(gate.querySelector(".auth-pointer")).toBeNull();
    expect(gate.querySelector(".auth-grid-surface")).toBeNull();
    expect(gate.querySelector(".auth-scales-a")).toBeNull();
    expect(gate.querySelector(".auth-scales-b")).toBeNull();
    expect(gate.querySelector(".auth-aurora")).toBeNull();
    expect(gate.querySelector(".auth-ripple")).toBeNull();
    const grid = gate.querySelector(".auth-grid");
    expect(grid).not.toBeNull();
    vi.spyOn(grid as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({})
    });
    fireEvent.pointerMove(gate, { clientX: 200, clientY: 400 });
    expect(gate.style.getPropertyValue("--cell-x")).toBe("");
    expect(gate.style.getPropertyValue("--cell-y")).toBe("");
    expect(gate.style.getPropertyValue("--linger")).toBe("");
    expect(raf).not.toHaveBeenCalled();
  });

  it("ignores a backdrop double-click without selecting decorative layers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/config")) {
        return new Response(JSON.stringify({ enabled: true, setup_required: false }), { status: 200 });
      }
      if (path.endsWith("/auth/captcha")) {
        return new Response(JSON.stringify({ captcha_id: "captcha-id-123", svg: "<svg></svg>" }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate apiBase="https://app.example.com">{() => null}</AuthGate>);

    await screen.findByAltText("图形验证码");
    const gate = screen.getByRole("main");
    const atmosphere = gate.querySelector(".auth-atmosphere");
    const grid = gate.querySelector(".auth-grid");
    const gleam = gate.querySelector(".auth-gleam");
    const cell = gate.querySelector(".auth-cell");
    expect(atmosphere).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(gleam).not.toBeNull();
    expect(cell).not.toBeNull();

    expect(() => fireEvent.doubleClick(gate)).not.toThrow();
    expect(() => fireEvent.doubleClick(atmosphere as Element)).not.toThrow();

    const backdropEvent = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    gate.dispatchEvent(backdropEvent);
    expect(backdropEvent.defaultPrevented).toBe(true);

    const email = screen.getByLabelText("邮箱");
    const inputEvent = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    email.dispatchEvent(inputEvent);
    expect(inputEvent.defaultPrevented).toBe(false);

    const reveal = screen.getByRole("button", { name: "显示密码" });
    const revealEvent = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    reveal.dispatchEvent(revealEvent);
    expect(revealEvent.defaultPrevented).toBe(false);

    for (const node of [atmosphere, grid, gleam, cell] as HTMLElement[]) {
      const style = getComputedStyle(node);
      const select = style.userSelect || style.webkitUserSelect;
      if (select) expect(select).toBe("none");
    }
    const inputSelect = getComputedStyle(email).userSelect || getComputedStyle(email).webkitUserSelect;
    if (inputSelect) expect(inputSelect).toBe("text");
  });
});
