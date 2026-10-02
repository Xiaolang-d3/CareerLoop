import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductIntroPage } from "./ProductIntroPage";

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

describe("product introduction", () => {
  const scroll = vi.fn();
  beforeEach(() => {
    scroll.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scroll, configurable: true });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  it("explores sections without changing the public hash or making network requests", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "#/about");
    render(<ProductIntroPage returnHash="#/home" />);

    fireEvent.click(screen.getByRole("button", { name: "工作方式" }));
    expect(screen.getByRole("region", { name: "从一个想法，到可用的成果。" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "资料与隐私" }));
    expect(screen.getByRole("region", { name: "你的资料，始终由你掌握。" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "探索产品" }));
    expect(screen.getByRole("region", { name: "产品交互演示" })).toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(3);
    expect(window.location.hash).toBe("#/about");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("link", { name: "开始使用" }).every((link) => link.getAttribute("href") === "#/home")).toBe(true);
  });

  it("shows examples, switches demo views, and opens citations in the correct source group", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length; });
    const finishFrame = () => act(() => { frames.splice(0).forEach((callback) => callback(0)); });
    render(<ProductIntroPage returnHash="#/settings" signedIn />);
    fireEvent.click(screen.getByRole("button", { name: "研究笔记 (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "查看引用：项目计划书.pdf" }));
    expect(screen.getByRole("button", { name: "项目记录 (3)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/项目目标：把分散的研究资料/)).toBeInTheDocument();
    finishFrame();
    expect(screen.getByLabelText("引用原文")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "收起原文" }));
    expect(within(screen.getByRole("complementary", { name: "演示参考资料" })).getByRole("button", { name: /项目计划书.pdf/ })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "研究笔记 (2)" }));
    expect(screen.queryByRole("button", { name: "收起原文" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "整理研究笔记" }));
    expect(screen.getByText("这些研究笔记里，有哪些方法可以复用？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "研究笔记 (2)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "换一个问题，看看资料如何发挥作用" }));
    finishFrame();
    expect(screen.getByLabelText("示例问题")).toHaveFocus();
    expect(screen.getByText("根据这些资料，帮我梳理项目亮点。")).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "演示视图" }));
    fireEvent.click(nav.getByRole("button", { name: "资料库" }));
    expect(screen.getByRole("heading", { name: "让有用的资料，随时可用。" })).toBeInTheDocument();
    fireEvent.click(nav.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "按你的方式，使用 AI。" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入 灯灯" })).toHaveAttribute("href", "#/settings");
    expect(screen.getByRole("link", { name: "返回应用" })).toHaveAttribute("href", "#/settings");
    expect(screen.getAllByRole("link", { name: "继续使用 灯灯" })).toHaveLength(2);
    expect(screen.getByText(/交互演示 · 使用示例资料/)).toBeInTheDocument();
  });
});
