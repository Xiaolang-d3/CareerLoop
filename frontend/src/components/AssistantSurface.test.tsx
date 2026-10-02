import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantSurface } from "./AssistantSurface";
describe("悬浮助手", () => {
  afterEach(cleanup);
  it("不提供悬浮启动按钮，弹窗仍可关闭或切换至独立页面", () => {
    const close = vi.fn();
    const expand = vi.fn();
    render(<AssistantSurface page={false} open busy={false} onClose={close} onExpand={expand}><textarea aria-label="草稿" defaultValue="尚未发送的内容" /></AssistantSurface>);
    expect(screen.queryByRole("button", { name: "打开 AI 助手" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("草稿")).toHaveValue("尚未发送的内容");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "在独立页面打开对话" }));
    expect(expand).toHaveBeenCalledOnce();
  });
  it("默认不显示弹窗", () => {
    render(<AssistantSurface page={false} open={false} busy={false} onClose={vi.fn()} onExpand={vi.fn()}><textarea aria-label="草稿" defaultValue="" /></AssistantSurface>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("执行中可以关闭窗口", () => {
    const close = vi.fn();
    render(<AssistantSurface page={false} open busy onClose={close} onExpand={vi.fn()}><p>任务运行中</p></AssistantSurface>);
    fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
    expect(close).toHaveBeenCalledOnce();
  });
});
