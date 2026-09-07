import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssistantSurface } from "./AssistantSurface";
function Harness() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(false);
  return <AssistantSurface page={page} open={open} busy={false} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onExpand={() => setPage(true)}><textarea aria-label="草稿" defaultValue="" /></AssistantSurface>;
}
describe("悬浮助手", () => {
  it("默认收起，关闭后恢复焦点并保留草稿，支持独立页面", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开 AI 助手" }));
    fireEvent.change(screen.getByLabelText("草稿"), { target: { value: "尚未发送的内容" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("button", { name: "打开 AI 助手" })).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开 AI 助手" }));
    expect(screen.getByLabelText("草稿")).toHaveValue("尚未发送的内容");
    fireEvent.click(screen.getByRole("button", { name: "在独立页面打开对话" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("草稿")).toHaveValue("尚未发送的内容");
    expect(screen.queryByRole("button", { name: "关闭对话框" })).not.toBeInTheDocument();
  });
  it("执行中可以关闭窗口", () => {
    const close = vi.fn();
    render(<AssistantSurface page={false} open busy onOpen={vi.fn()} onClose={close} onExpand={vi.fn()}><p>任务运行中</p></AssistantSurface>);
    fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
    expect(close).toHaveBeenCalledOnce();
  });
});
