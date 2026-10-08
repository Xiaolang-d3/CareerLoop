import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTopBar } from "../../components/AppTopBar";
import type { Conversation } from "../../types";
import { HomePage } from "./HomePage";
import { homeInboxItems } from "./home-metrics";

afterEach(cleanup);

function sampleConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 3,
    title: "整理阅读笔记",
    status: "active",
    summary: "",
    message_count: 4,
    task_status: "active",
    updated_at: "2026-10-07T09:00:00Z",
    last_message_at: "2026-10-07T09:10:00Z",
    ...overrides
  };
}

function renderHome(overrides: Partial<ComponentProps<typeof HomePage>> = {}) {
  const props = {
    displayName: "小林",
    libraryName: "张三",
    libraryLoaded: true,
    sourceCount: 6,
    confirmedFactCount: 2,
    pendingFactCount: 1,
    onOpenChat: vi.fn(),
    ...overrides
  };
  render(<HomePage {...props} />);
  return props;
}

describe("home-metrics", () => {
  it("keeps generic proposals and source evidence for the library review", () => {
    expect(
      homeInboxItems([
        {
          id: 1,
          category: "knowledge",
          statement: "每天记录问题",
          evidence: [{ excerpt: "原始阅读笔记", source_title: "笔记" }]
        }
      ])
    ).toEqual([expect.objectContaining({ id: 1, title: "每天记录问题", source: "原始阅读笔记", sourceLabel: "笔记" })]);
  });
});

describe("HomePage", () => {
  it("has one primary entry and a read-only overview instead of repeated shortcuts", () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("张三");
    const overview = screen.getByLabelText("资料概览");
    expect(overview).toHaveTextContent("文件6已确认知识2待确认1");
    expect(within(overview).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByLabelText("快捷操作")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("待确认内容")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /添加内容|向我提问|开始创作|去知识库添加/ })).not.toBeInTheDocument();
  });

  it("keeps unloaded counts distinct from a genuinely empty library", () => {
    const { rerender } = render(<HomePage libraryLoaded={false} />);
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("资料尚未读取");
    rerender(<HomePage libraryLoaded />);
    expect(screen.getAllByText("0")).toHaveLength(3);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to the account name and has no duplicate action in the empty state", () => {
    const props = renderHome({ libraryName: "" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("小林");
    expect(screen.getByText("还没有对话，开始后会显示在这里。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始新对话" }));
    expect(props.onOpenChat).toHaveBeenCalledExactlyOnceWith();
  });

  it("sorts all conversations by recency and limits continuation entries to three", () => {
    const conversations = [
      sampleConversation({ id: 1, title: "最早", last_message_at: "2026-10-01T08:00:00Z" }),
      sampleConversation({ id: 2, title: "次新", last_message_at: "2026-10-06T08:00:00Z", task_status: "completed" }),
      sampleConversation({ id: 3, title: "最新", last_message_at: "2026-10-07T08:00:00Z" }),
      sampleConversation({ id: 4, title: "第三", last_message_at: "", updated_at: "2026-10-05T08:00:00Z" })
    ];
    const props = renderHome({ conversations });
    const recent = screen.getByRole("region", { name: "最近对话" });
    expect(
      within(recent)
        .getAllByRole("button")
        .map((button) => button.textContent?.slice(0, 2))
    ).toEqual(["最新", "次新", "第三"]);
    expect(screen.queryByText("最早")).not.toBeInTheDocument();
    fireEvent.click(within(recent).getByRole("button", { name: /次新/ }));
    expect(props.onOpenChat).toHaveBeenCalledWith(2);
    expect(conversations[0].id).toBe(1);
  });

  it("disables new conversation creation while a request is pending", () => {
    const props = renderHome({ conversationBusy: true });
    const button = screen.getByRole("button", { name: "正在创建…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.onOpenChat).not.toHaveBeenCalled();
  });

  it("interprets backend timestamps as UTC and orders mixed timestamp formats correctly", () => {
    renderHome({
      conversations: [
        sampleConversation({ id: 1, title: "稍早", last_message_at: "2026-10-08T02:00:00Z" }),
        sampleConversation({ id: 2, title: "稍晚", last_message_at: "2026-10-08 03:00:00" })
      ]
    });
    const recent = screen.getByRole("region", { name: "最近对话" });
    const buttons = within(recent).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("稍晚");
    expect(buttons[0]).toHaveTextContent(
      new Date("2026-10-08T03:00:00Z").toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      })
    );
  });

  it("keeps account controls in the existing global top bar", () => {
    render(
      <section className="content">
        <AppTopBar userEmail="reader@local.test" onOpenProfile={vi.fn()} onLogout={vi.fn()} />
        <HomePage displayName="小林" />
      </section>
    );
    expect(document.querySelector("header.app-topbar")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).closest(".app-topbar")).toBeNull();
  });
});
