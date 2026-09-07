import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreationPage } from "./CreationPage";
describe("内容创作", () => {
  it("提交所选类型、风格及要求，不依赖简历", () => {
    const onGenerate = vi.fn();
    render(<CreationPage busy={false} onGenerate={onGenerate} onOpenLibrary={vi.fn()} onOpenResume={vi.fn()} />);
    expect(screen.getByRole("button", { name: "生成内容" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "总结" }));
    fireEvent.change(screen.getByLabelText("创作要求"), { target: { value: "总结学习笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "生成内容" }));
    expect(onGenerate).toHaveBeenCalledWith(expect.stringContaining("请帮我总结。"));
    expect(onGenerate).toHaveBeenCalledWith(expect.stringContaining("总结学习笔记"));
  });
});
