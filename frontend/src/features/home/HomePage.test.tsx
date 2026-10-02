import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTopBar } from "../../components/AppTopBar";
import type { Conversation } from "../../types";
import { HomePage } from "./HomePage";
import { homeInboxItems } from "./home-metrics";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function sampleConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 3,
    title: "对照字节后端",
    status: "active",
    summary: "",
    message_count: 4,
    task_status: "active",
    updated_at: "2026-08-14T09:00:00Z",
    last_message_at: "2026-08-14T09:10:00Z",
    ...overrides
  };
}

function renderHome(overrides: Partial<ComponentProps<typeof HomePage>> = {}) {
  const props = {
    displayName: "小林",
    email: "owner@example.com",
    libraryName: "张三",
    libraryLoaded: true,
    sourceCount: 1,
    enabledSourceCount: 1,
    sourceTitle: "读书笔记",
    onOpenProfile: vi.fn(),
    onOpenChat: vi.fn(),
    ...overrides
  };
  render(<HomePage {...props} />);
  return props;
}

describe("home-metrics", () => {
  it("keeps generic proposals and their source evidence without skill inference", () => {
    expect(homeInboxItems([{ id: 1, category: "knowledge", statement: "每天记录问题", evidence: [{ excerpt: "原始阅读笔记", source_title: "笔记" }] }]))
      .toEqual([expect.objectContaining({ id: 1, title: "每天记录问题", source: "原始阅读笔记", sourceLabel: "笔记" })]);
  });
});

describe("HomePage", () => {
  it("shows a greeting, quick actions, and honest knowledge overview", () => {
    renderHome();

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/张三/);
    expect(screen.queryByText("当前资料方向：后端工程师 · 上海")).not.toBeInTheDocument();
    expect(screen.getByLabelText("快捷操作")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加内容/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /向我提问/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始创作/ })).toBeInTheDocument();
    expect(screen.getByLabelText("我的知识概览")).toBeInTheDocument();
    expect(screen.getByLabelText("待确认内容")).toBeInTheDocument();
    expect(screen.getByLabelText("继续工作")).toBeInTheDocument();
    expect(screen.queryByLabelText("今日寄语")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("今日灵感")).not.toBeInTheDocument();
    expect(screen.queryByText("岗位推进")).not.toBeInTheDocument();
    expect(screen.queryByText("机会中心")).not.toBeInTheDocument();
  });

  it("keeps detailed skill information in the library instead of crowding the home page", () => {
    renderHome({});
    expect(screen.queryByLabelText("技能标签")).not.toBeInTheDocument();
    expect(screen.queryByText("LangChain")).not.toBeInTheDocument();
    expect(screen.getByLabelText("我的知识概览")).toBeInTheDocument();
  });

  it("uses a calm empty state when profile and jobs are not ready yet", () => {
    renderHome({
      libraryName: "",
      libraryLoaded: false
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/小林/);
    expect(screen.getByText("集中保存资料，基于知识提问，再把想法写成内容。")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("资料尚未读取").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the global top bar above the home greeting", () => {
    const props = {
      displayName: "小林",
      email: "owner@example.com",
      libraryName: "张三",
      libraryLoaded: true,
    sourceCount: 1,
    enabledSourceCount: 1,
    sourceTitle: "读书笔记",
      onOpenProfile: vi.fn()
    };
    render(
      <section className="content">
        <AppTopBar userEmail={props.email} onOpenProfile={props.onOpenProfile} onLogout={vi.fn()} />
        <HomePage {...props} />
      </section>
    );
    const bar = document.querySelector("header.app-topbar");
    expect(bar).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/张三/);
    expect(screen.getByRole("heading", { level: 2 }).closest(".app-topbar")).toBeNull();
  });

  it("does not show a weekly report", () => {
    renderHome();
    expect(screen.queryByText("本周求职进展")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("求职周报")).not.toBeInTheDocument();
  });

  it("wires quick actions to the library and AI workspace", () => {
    const props = renderHome();
    fireEvent.click(screen.getByRole("button", { name: /添加内容/ }));
    fireEvent.click(screen.getByRole("button", { name: /向我提问/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始创作/ }));
    expect(props.onOpenProfile).toHaveBeenCalled();
    expect(props.onOpenChat).toHaveBeenCalled();
    expect(props.onOpenChat).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: /机会中心/ })).not.toBeInTheDocument();
  });

  it("sends knowledge overview cards to the library", () => {
    const props = renderHome();
    const snapshot = screen.getByLabelText("内容概览");
    fireEvent.click(within(snapshot).getByRole("button", { name: /知识条目/ }));
    fireEvent.click(within(snapshot).getByRole("button", { name: /文件/ }));
    expect(props.onOpenProfile).toHaveBeenCalled();
  });

  it("lists recent chats and active tasks together as work to continue", () => {
    const props = renderHome({
      conversations: [
        sampleConversation(),
        sampleConversation({ id: 9, title: "整理本周笔记", task_status: "active", summary: "进行中" })
      ]
    });
    const continueWork = screen.getByLabelText("继续工作");
    expect(continueWork).toHaveTextContent("对照字节后端");
    expect(continueWork).toHaveTextContent("整理本周笔记");
    fireEvent.click(within(continueWork).getByRole("button", { name: /整理本周笔记/ }));
    expect(props.onOpenChat).toHaveBeenCalledWith(9);
  });
});
