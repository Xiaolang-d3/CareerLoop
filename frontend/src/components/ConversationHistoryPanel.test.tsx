import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationHistoryPanel } from "./ConversationHistoryPanel";

const conversation = {
  id: 1,
  title: "项目表达练习",
  status: "active" as const,
  summary: "",
  message_count: 4,
  task_status: "completed" as const,
  updated_at: "2026-08-11T00:00:00Z"
};

function renderPanel() {
  const props = {
    conversations: [conversation],
    currentConversationId: 1,
    busy: false,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onArchive: vi.fn(),
    onRemove: vi.fn()
  };
  render(<ConversationHistoryPanel {...props} />);
  return props;
}

describe("ConversationHistoryPanel", () => {
  afterEach(cleanup);

  it("creates a conversation from the chat-side history panel", () => {
    const props = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));

    expect(props.onCreate).toHaveBeenCalledOnce();
  });

  it("keeps conversation management actions in the right-panel menu", () => {
    const props = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "项目表达练习 的更多操作" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));

    expect(props.onArchive).toHaveBeenCalledWith(conversation);
  });
});
