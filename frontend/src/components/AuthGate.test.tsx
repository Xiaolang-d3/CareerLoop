import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";

describe("AuthGate", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("validates an existing session without requesting the sign-in configuration or captcha", async () => {
    window.sessionStorage.setItem("bosscopilot-auth-token", "saved-token");
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
    expect(screen.getByText("CAREERLOOP")).toBeInTheDocument();
    expect(screen.getByText("职业成长助手")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录继续你的求职计划" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "CareerLoop 如何帮助求职" })).toBeInTheDocument();
    expect(screen.getByText("把求职变成可持续推进的过程")).toBeInTheDocument();
    expect(screen.getByText("验证身份")).toBeInTheDocument();
    expect(screen.getByText("进入求职系统")).toBeInTheDocument();
    expect(screen.getByText("登录只在当前标签页")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "安全登录" }));

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
    fireEvent.click(screen.getByRole("button", { name: "安全登录" }));

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
    fireEvent.click(screen.getByRole("button", { name: "安全登录" }));

    expect(await screen.findByText("网络已断开，请检查连接后点重新连接。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeInTheDocument();
  });

  it("checks the captcha locally before calling login", async () => {
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

    await screen.findByAltText("图形验证码");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-123" } });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "AB" } });
    fireEvent.click(screen.getByRole("button", { name: "安全登录" }));

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
});
