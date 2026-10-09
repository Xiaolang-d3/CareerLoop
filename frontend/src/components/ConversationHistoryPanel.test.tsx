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
  const view = render(<ConversationHistoryPanel {...props} />);
  return { ...props, view };
}

describe("ConversationHistoryPanel", () => {
  afterEach(cleanup);

  it("searches titles and summaries, identifies the current conversation and clears an empty search with Escape", () => {
    const { view, ...props } = renderPanel();
    const longTitle = "很长的开发记录".repeat(12);
    view.rerender(<ConversationHistoryPanel {...props} conversations={[conversation, { ...conversation, id: 2, title: longTitle, summary: "Agent 工具研究" }]} />);
    expect(screen.getByTitle(conversation.title)).toHaveAttribute("aria-current", "page");
    expect(screen.getByTitle(longTitle)).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "搜索对话标题或摘要" });
    fireEvent.change(search, { target: { value: "agent" } });
    expect(screen.queryByTitle(conversation.title)).not.toBeInTheDocument();
    expect(screen.getByTitle(longTitle)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "没有这条对话" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的对话");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("supports menu keyboard navigation and restores its trigger on Escape", () => {
    const props = renderPanel();
    const trigger = screen.getByRole("button", { name: "项目表达练习 的更多操作" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "归档" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(screen.getByRole("menuitem", { name: "删除" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(props.onClose).not.toHaveBeenCalled();
  });

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
