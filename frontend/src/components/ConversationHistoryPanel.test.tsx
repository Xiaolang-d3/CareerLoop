import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConversationHistoryPanel,
  formatConversationTime,
  groupConversationsByTime
} from "./ConversationHistoryPanel";

const conversation = {
  id: 1,
  title: "项目表达练习",
  status: "active" as const,
  summary: "",
  message_count: 4,
  task_status: "completed" as const,
  updated_at: "2026-08-11T00:00:00Z"
};

function renderPanel(open = true) {
  const props = {
    conversations: [conversation],
    currentConversationId: 1,
    busy: false,
    open,
    onClose: vi.fn(),
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

  it("stays closed until opened as a drawer", () => {
    renderPanel(false);

    expect(screen.queryByRole("button", { name: "新建对话" })).not.toBeInTheDocument();
  });

  it("closes the drawer from the panel header", () => {
    const props = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "关闭对话记录" }));

    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("groups conversations by recency instead of a generic recent label", () => {
    const now = new Date(2026, 7, 13, 8, 0, 0);
    const groups = groupConversationsByTime([
      { ...conversation, id: 1, title: "今天的练习", updated_at: new Date(2026, 7, 13, 10, 20, 0).toISOString() },
      { ...conversation, id: 2, title: "昨天的复盘", updated_at: new Date(2026, 7, 12, 9, 0, 0).toISOString() },
      { ...conversation, id: 3, title: "更早的对话", updated_at: new Date(2026, 6, 1, 9, 0, 0).toISOString() }
    ], now);

    expect(groups.map((group) => group.label)).toEqual(["今天", "昨天", "更早"]);
    expect(formatConversationTime(new Date(2026, 7, 13, 10, 20, 0).toISOString(), now)).toMatch(/10:20/);
  });
});
