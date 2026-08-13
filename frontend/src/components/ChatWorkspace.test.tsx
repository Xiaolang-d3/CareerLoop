import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspace, type ChatMessage } from "./ChatWorkspace";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

const conversation = {
  id: 1,
  title: "围绕一个项目追问我",
  status: "active" as const,
  summary: "",
  message_count: 1,
  task_status: "completed" as const,
  updated_at: "2026-08-11T00:00:00Z"
};

const message: ChatMessage = {
  id: 11,
  role: "user",
  content: "围绕一个项目追问我",
  created_at: "2026-08-11T00:00:00Z"
};

function renderChat(messages: ChatMessage[] = [message]) {
  const props = {
    conversationTitle: conversation.title,
    messages,
    hiddenMessageCount: 0,
    chatBusy: false,
    currentConversationId: conversation.id,
    conversations: [conversation],
    conversationBusy: false,
    waitingForUser: false,
    taskCancelBusy: false,
    retryDraft: null,
    chatEndRef: createRef<HTMLDivElement>(),
    chatInputRef: createRef<HTMLTextAreaElement>(),
    onLoadMore: vi.fn(),
    onSelectConversation: vi.fn(),
    onCreateConversation: vi.fn(),
    onRenameConversation: vi.fn(),
    onArchiveConversation: vi.fn(),
    onRemoveConversation: vi.fn(),
    attachmentBusy: false,
    attachmentConfig: null,
    webSearchAvailable: false,
    onUploadAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onAttachmentInvalid: vi.fn(),
    onSuggestedAction: vi.fn(),
    onCancelTask: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onEdit: vi.fn(),
    onRegenerate: vi.fn()
  };
  render(<ChatWorkspace {...props} />);
  return props;
}

describe("ChatWorkspace", () => {
  afterEach(cleanup);

  it("keeps a slim session header without status chrome", () => {
    renderChat();

    expect(screen.getByRole("heading", { level: 1, name: "围绕一个项目追问我" })).toBeInTheDocument();
    expect(screen.queryByText("准备中")).not.toBeInTheDocument();
    expect(screen.queryByText("CareerLoop · 面试准备")).not.toBeInTheDocument();
  });

  it("opens conversation history as a drawer instead of a persistent column", () => {
    renderChat();

    expect(screen.queryByRole("button", { name: "新建对话" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "对话记录" }));

    expect(screen.getByRole("button", { name: "新建对话" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "对话记录" })).toBeInTheDocument();
  });

  it("fills the composer from a starter card instead of sending", async () => {
    const props = renderChat([]);

    fireEvent.click(screen.getByRole("button", { name: /练习项目追问/ }));

    expect(props.onSend).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByLabelText("输入消息")).toHaveValue("围绕这个项目追问我。项目是：");
    });
  });

  it("keeps resume and analysis context available as composer chips", async () => {
    render(
      <ChatWorkspace
        {...{
          conversationTitle: "新对话",
          messages: [],
          hiddenMessageCount: 0,
          chatBusy: false,
          currentConversationId: 1,
          conversations: [conversation],
          conversationBusy: false,
          waitingForUser: false,
          taskCancelBusy: false,
          retryDraft: null,
          chatEndRef: createRef<HTMLDivElement>(),
          chatInputRef: createRef<HTMLTextAreaElement>(),
          onLoadMore: vi.fn(),
          onSelectConversation: vi.fn(),
          onCreateConversation: vi.fn(),
          onRenameConversation: vi.fn(),
          onArchiveConversation: vi.fn(),
          onRemoveConversation: vi.fn(),
          attachmentBusy: false,
          attachmentConfig: null,
          webSearchAvailable: false,
          onUploadAttachment: vi.fn(),
          onRemoveAttachment: vi.fn(),
          onAttachmentInvalid: vi.fn(),
          onSuggestedAction: vi.fn(),
          onCancelTask: vi.fn(),
          onSend: vi.fn(),
          onStop: vi.fn(),
          onEdit: vi.fn(),
          onRegenerate: vi.fn(),
          sessionContext: { resumeLabel: "resume.pdf", analysisLabel: "示例公司 · 后端" }
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /简历 · resume.pdf/ }));
    await waitFor(() => {
      expect(screen.getByLabelText("输入消息")).toHaveValue("结合我已经保存的简历（resume.pdf），");
    });
  });

  it("collapses the thinking process until expanded", () => {
    renderChat([{
      id: 12,
      role: "assistant",
      content: "可以。下面从项目目标开始问。",
      created_at: "2026-08-11T00:01:00Z",
      payload: {
        agent: {
          provider: "test",
          platform: "local",
          rounds: 1,
          status: "done",
          events: [{
            round: 1,
            tool_call_id: "think-1",
            tool_name: "agent_thinking",
            status: "done",
            message: "先确认项目范围，再追问取舍。"
          }]
        }
      }
    }]);

    const toggle = screen.getByRole("button", { name: "思考过程" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.closest(".thinking-process")).not.toHaveClass("expanded");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("先确认项目范围，再追问取舍。")).toBeVisible();
  });
});
