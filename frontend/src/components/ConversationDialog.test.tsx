import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationDialog } from "./ConversationDialog";

const conversation = {
  id: 1,
  title: "项目表达练习",
  status: "active" as const,
  summary: "",
  message_count: 4,
  task_status: "completed" as const,
  updated_at: "2026-08-11T00:00:00Z"
};

describe("ConversationDialog", () => {
  afterEach(cleanup);

  it("edits a title through the app dialog", () => {
    const onRename = vi.fn();
    render(<ConversationDialog dialog={{ kind: "rename", conversation }} onClose={vi.fn()} onRename={onRename} onDelete={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("对话名称"), { target: { value: "项目复盘" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onRename).toHaveBeenCalledWith(conversation, "项目复盘");
  });

  it("uses an explicit irreversible delete confirmation", () => {
    const onDelete = vi.fn();
    render(<ConversationDialog dialog={{ kind: "delete", conversation }} onClose={vi.fn()} onRename={vi.fn()} onDelete={onDelete} />);

    expect(screen.getByText("删除“项目表达练习”后无法恢复。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(onDelete).toHaveBeenCalledWith(conversation);
  });
});
