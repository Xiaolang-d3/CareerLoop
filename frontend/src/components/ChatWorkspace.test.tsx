import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspace, interviewHintParts, interviewQuestionParts, type AgentRunResult, type ChatMessage } from "./ChatWorkspace";

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn()
}));

vi.mock("mermaid", () => ({
  default: mermaidMocks
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: vi.fn()
});

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

function assistantMessage(content: string, id = 12): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    created_at: "2026-08-11T00:01:00Z"
  };
}

function fencedMermaid(source: string): string {
  return ["```mermaid", source, "```"].join("\n");
}

function renderChat(messages: ChatMessage[] = [message], extras: { chatBusy?: boolean; latestAgent?: AgentRunResult; webSearchAvailable?: boolean } = {}) {
  const props = {
    conversationTitle: conversation.title,
    messages,
    hiddenMessageCount: 0,
    chatBusy: extras.chatBusy ?? false,
    currentConversationId: conversation.id,
    conversations: [conversation],
    conversationBusy: false,
    waitingForUser: false,
    latestAgent: extras.latestAgent,
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
    webSearchAvailable: extras.webSearchAvailable ?? false,
    onUploadAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onAttachmentInvalid: vi.fn(),
    onSuggestedAction: vi.fn(),
    onCancelTask: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onEdit: vi.fn(),
    onRegenerate: vi.fn(),
    onOpenResume: vi.fn()
  };
  render(<ChatWorkspace {...props} />);
  return props;
}

describe("ChatWorkspace", () => {
  beforeEach(() => {
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockReset();
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg data-rendered-mermaid="true" viewBox="0 0 100 60"></svg>'
    });
  });

  afterEach(cleanup);

  it("keeps conversation actions without a second route heading", () => {
    renderChat();

    expect(screen.getByLabelText("围绕一个项目追问我 · 对话操作")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "对话操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重命名对话" })).toHaveTextContent("围绕一个项目追问我");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("准备中")).not.toBeInTheDocument();
    expect(screen.queryByText("CareerLoop · 面试准备")).not.toBeInTheDocument();
  });

  it("keeps session title and tools in the conversation rail instead of a second page heading", () => {
    renderChat();

    const header = screen.getByLabelText("围绕一个项目追问我 · 对话操作");
    const thread = document.querySelector(".chat-thread");
    expect(header.compareDocumentPosition(thread as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header).toHaveClass("has-session");
    expect(header.querySelector(".chat-session-title")).toHaveTextContent("围绕一个项目追问我");
    expect(header.querySelector(".chat-session-mark")).toBeInTheDocument();
    expect(header.querySelector(".chat-session-tools")).toBe(screen.getByRole("toolbar", { name: "对话操作" }));
    expect(screen.getByRole("button", { name: "新建对话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对话记录" })).toBeInTheDocument();
    expect(header.querySelector(".chat-session-tools")).not.toHaveTextContent("新对话");
    expect(header.querySelector(".chat-session-tools")).not.toHaveTextContent("历史");
  });

  it("recedes an untitled session so the welcome owns the empty canvas", () => {
    render(
      <ChatWorkspace
        conversationTitle=""
        messages={[]}
        hiddenMessageCount={0}
        chatBusy={false}
        currentConversationId={null}
        conversations={[]}
        conversationBusy={false}
        waitingForUser={false}
        taskCancelBusy={false}
        retryDraft={null}
        chatEndRef={createRef<HTMLDivElement>()}
        chatInputRef={createRef<HTMLTextAreaElement>()}
        onLoadMore={vi.fn()}
        onSelectConversation={vi.fn()}
        onCreateConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onArchiveConversation={vi.fn()}
        onRemoveConversation={vi.fn()}
        attachmentBusy={false}
        attachmentConfig={null}
        webSearchAvailable={false}
        onUploadAttachment={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onAttachmentInvalid={vi.fn()}
        onSuggestedAction={vi.fn()}
        onCancelTask={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />
    );

    const header = screen.getByLabelText("新对话 · 对话操作");
    expect(header).toHaveClass("is-untitled");
    expect(header.querySelector(".chat-session-title")).toHaveClass("is-static");
    expect(screen.getByRole("toolbar", { name: "对话操作" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "你想完成什么？" })).toBeInTheDocument();
  });

  it("recedes a default-titled empty session so the opening line owns the canvas", () => {
    render(
      <ChatWorkspace
        conversationTitle="新对话"
        messages={[]}
        hiddenMessageCount={0}
        chatBusy={false}
        currentConversationId={1}
        conversations={[{ ...conversation, title: "新对话" }]}
        conversationBusy={false}
        waitingForUser={false}
        taskCancelBusy={false}
        retryDraft={null}
        chatEndRef={createRef<HTMLDivElement>()}
        chatInputRef={createRef<HTMLTextAreaElement>()}
        onLoadMore={vi.fn()}
        onSelectConversation={vi.fn()}
        onCreateConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onArchiveConversation={vi.fn()}
        onRemoveConversation={vi.fn()}
        attachmentBusy={false}
        attachmentConfig={null}
        webSearchAvailable={false}
        onUploadAttachment={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onAttachmentInvalid={vi.fn()}
        onSuggestedAction={vi.fn()}
        onCancelTask={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />
    );

    const header = screen.getByLabelText("新对话 · 对话操作");
    expect(header).toHaveClass("is-untitled");
    expect(header.querySelector(".chat-session-title")).toHaveTextContent("新对话");
    expect(screen.getByRole("heading", { level: 2, name: "你想完成什么？" })).toBeInTheDocument();
  });

  it("renames the current conversation from the session title", () => {
    const props = renderChat();

    fireEvent.click(screen.getByRole("button", { name: "重命名对话" }));

    expect(props.onRenameConversation).toHaveBeenCalledWith(conversation);
  });

  it("marks the history tool as open while the drawer is visible", () => {
    renderChat();

    const toggle = screen.getByRole("button", { name: "对话记录" });
    fireEvent.click(toggle);

    expect(toggle).toHaveClass("is-open");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("complementary", { name: "对话记录" })).toBeInTheDocument();
  });

  it("opens conversation history as a drawer instead of a persistent column", () => {
    renderChat();

    expect(screen.getByRole("button", { name: "新建对话" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "对话记录" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "对话记录" }));

    expect(screen.getAllByRole("button", { name: "新建对话" })).toHaveLength(2);
    expect(screen.getByRole("complementary", { name: "对话记录" })).toBeInTheDocument();
  });

  it("creates a conversation from the session header", () => {
    const props = renderChat();

    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));

    expect(props.onCreateConversation).toHaveBeenCalledOnce();
  });

  it("closes the conversation drawer with Escape", () => {
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "对话记录" }));
    expect(screen.getByRole("complementary", { name: "对话记录" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("complementary", { name: "对话记录" })).not.toBeInTheDocument();
  });

  it("renders an opening line with optional drafts below the composer", () => {
    renderChat([]);

    expect(screen.queryByText("准备与复盘")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "你想完成什么？" })).toBeInTheDocument();
    expect(screen.queryByText("没有固定题目。想出题去面试问答，想拆项目去项目解析。")).not.toBeInTheDocument();
    expect(screen.queryByText("面试问答")).not.toBeInTheDocument();
    expect(screen.queryByText("项目解析")).not.toBeInTheDocument();
    expect(screen.getByText("在这里搜索公开信息、核对来源、分析资料并生成内容，不用在多个工具之间来回切换。")).toBeInTheDocument();
    const drafts = screen.getByLabelText("可选草稿");
    const welcome = document.querySelector(".chat-welcome");
    const composer = document.querySelector(".chat-composer");
    expect(composer?.contains(welcome as Node)).toBe(true);
    expect(composer?.contains(drafts)).toBe(true);
    expect(screen.queryByRole("button", { name: "梳理已保存资料" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分析一份材料" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查找公开信息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "起草一份内容" })).toBeInTheDocument();
    expect(screen.getByLabelText("输入消息")).toHaveAttribute("placeholder", "描述任务，或添加一份资料…");
  });

  it("hides starter prompts once the conversation has messages", () => {
    renderChat();

    expect(screen.queryByLabelText("可选草稿")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析一份材料" })).not.toBeInTheDocument();
  });

  it("fills the composer from a draft instead of sending", async () => {
    const props = renderChat([]);

    fireEvent.click(screen.getByRole("button", { name: "分析一份材料" }));

    expect(props.onSend).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByLabelText("输入消息")).toHaveValue("帮我分析这份材料，先总结重点，再指出值得继续追问的地方。");
    });
  });

  it("enables web search when the public information starter is selected", async () => {
    renderChat([], { webSearchAvailable: true });

    expect(screen.getByRole("button", { name: "联网搜索" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "查找公开信息" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "联网搜索" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("输入消息")).toHaveValue("帮我查找并核对这个主题的公开信息：");
    });
  });

  it("keeps source selection inside the existing conversation composer", () => {
    renderChat([], { webSearchAvailable: true });

    expect(screen.queryByLabelText("联网搜索模式")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "联网搜索" }));

    const mode = screen.getByLabelText("联网搜索模式");
    expect(mode).toHaveValue("auto");
    fireEvent.change(mode, { target: { value: "technical" } });
    expect(mode).toHaveValue("technical");
  });

  it("shows saved resume and analysis as attached composer context", () => {
    const onOpenResume = vi.fn();
    const onSend = vi.fn();
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
          onSend,
          onStop: vi.fn(),
          onEdit: vi.fn(),
          onRegenerate: vi.fn(),
          onOpenResume,
          sessionContext: { resumeLabel: "resume.pdf", analysisLabel: "示例公司 · 后端" }
        }}
      />
    );

    const resume = screen.getByRole("button", { name: "查看已保存资料" });
    expect(resume).toHaveTextContent("已保存资料");
    expect(resume).toHaveAttribute("title", "查看已保存资料，提问时会自动参考");
    expect(screen.getByText("示例公司 · 后端")).toBeInTheDocument();
    expect(screen.queryByText("分析")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析" })).not.toBeInTheDocument();
    expect(screen.queryByText("参考简历原文")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "梳理已保存资料" })).toBeInTheDocument();

    fireEvent.click(resume);
    expect(onOpenResume).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText("输入消息")).toHaveValue("");
  });

  it("shows clarification choices in the composer and sends the selected option", async () => {
    const onSend = vi.fn();
    const onSuggestedAction = vi.fn();
    render(
      <ChatWorkspace
        {...{
          conversationTitle: conversation.title,
          messages: [message, {
            id: 12,
            role: "assistant",
            content: "你指的是哪家公司？",
            created_at: "2026-08-11T00:01:00Z",
            payload: {
              agent: {
                provider: "test",
                platform: "local",
                rounds: 1,
                status: "waiting_user",
                events: [{
                  round: 1,
                  tool_call_id: "ask-1",
                  tool_name: "ask_user",
                  status: "waiting_approval",
                  message: "你指的是哪家公司？",
                  data: {
                    clarification: {
                      question: "你指的是哪家公司？",
                      options: [
                        { id: "opt_1", label: "字节跳动", send: "按字节跳动继续" },
                        { id: "opt_2", label: "字节跳动教育", send: "按字节跳动教育继续" }
                      ],
                      allow_custom: true
                    }
                  }
                }]
              }
            }
          }],
          hiddenMessageCount: 0,
          chatBusy: false,
          currentConversationId: conversation.id,
          conversations: [conversation],
          conversationBusy: false,
          waitingForUser: true,
          latestAgent: {
            provider: "test",
            platform: "local",
            rounds: 1,
            status: "waiting_user",
            events: [{
              round: 1,
              tool_call_id: "ask-1",
              tool_name: "ask_user",
              status: "waiting_approval",
              message: "你指的是哪家公司？",
              data: {
                clarification: {
                  question: "你指的是哪家公司？",
                  options: [
                    { id: "opt_1", label: "字节跳动", send: "按字节跳动继续" },
                    { id: "opt_2", label: "字节跳动教育", send: "按字节跳动教育继续" }
                  ],
                  allow_custom: true
                }
              }
            }]
          },
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
          onSuggestedAction,
          onCancelTask: vi.fn(),
          onSend,
          onStop: vi.fn(),
          onEdit: vi.fn(),
          onRegenerate: vi.fn()
        }}
      />
    );

    const clarifier = screen.getByLabelText("需要你确认后继续");
    expect(clarifier).toHaveTextContent("你指的是哪家公司？");
    expect(screen.getByLabelText("输入消息")).toHaveAttribute("placeholder", "回答上面的问题，或直接说下一件…");
    expect(clarifier).toHaveTextContent("答当前问题则继续");
    expect(screen.queryByRole("button", { name: /继续处理/ })).not.toBeInTheDocument();
    expect(screen.queryByText("已暂停，等待你的操作")).not.toBeInTheDocument();
    expect(document.querySelector(".agent-result-note")).not.toBeInTheDocument();
    expect(screen.getByLabelText("输出结果")).toHaveTextContent("你指的是哪家公司？");

    fireEvent.click(screen.getByRole("button", { name: "字节跳动" }));
    expect(onSend).toHaveBeenCalledWith("按字节跳动继续");
    expect(onSuggestedAction).not.toHaveBeenCalled();
  });

  it("opens research details from the compact process summary without exposing raw thoughts", () => {
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

    const toggle = screen.getByRole("button", { name: "思考过程，打开研究详情" });
    expect(screen.queryByRole("complementary", { name: "研究详情" })).not.toBeInTheDocument();
    expect(screen.queryByText("先确认项目范围，再追问取舍。")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("complementary", { name: "研究详情" })).toBeInTheDocument();
    expect(screen.getByText("这条回答没有调用外部研究工具。")).toBeVisible();
    expect(screen.queryByText("先确认项目范围，再追问取舍。")).not.toBeInTheDocument();
  });

  it("expands thinking with live tool work and hides the local route summary", () => {
    renderChat([
      message,
      {
        id: -1,
        role: "assistant",
        content: "",
        created_at: "2026-08-11T00:01:00Z",
        payload: {
          agent: {
            provider: "test",
            platform: "local",
            rounds: 1,
            status: "done",
            events: [
              {
                round: 0,
                tool_call_id: "think-1",
                tool_name: "agent_thinking",
                status: "done",
                message: "已识别为公司公开信息研究，需要先规划并限制可用工具"
              },
              {
                round: 0,
                tool_call_id: "plan-1",
                tool_name: "agent_planner",
                status: "done",
                message: "已规划 1 个步骤：核验腾讯科技公开信息"
              },
              {
                round: 1,
                tool_call_id: "call-1",
                tool_name: "research_company",
                status: "running",
                message: "正在检索：腾讯科技",
                data: { arguments: { company_name: "腾讯科技" } }
              }
            ]
          }
        }
      }
    ], { chatBusy: true });

    const toggle = screen.getByRole("button", { name: /正在检索公司资料/ });
    fireEvent.click(toggle);
    const body = screen.getByRole("complementary", { name: "研究详情" });
    expect(body).not.toHaveTextContent("已识别为公司公开信息研究，需要先规划并限制可用工具");
    expect(body).toHaveTextContent("已规划 1 个步骤：核验腾讯科技公开信息");
    expect(body).toHaveTextContent("腾讯科技");
  });

  it("does not show the local route summary while waiting for the first real step", () => {
    renderChat([
      message,
      {
        id: -1,
        role: "assistant",
        content: "",
        created_at: "2026-08-11T00:01:00Z",
        payload: {
          agent: {
            provider: "test",
            platform: "local",
            rounds: 0,
            status: "done",
            events: [{
              round: 0,
              tool_call_id: "think-1",
              tool_name: "agent_thinking",
              status: "done",
              message: "已识别为公司公开信息研究，需要先规划并限制可用工具"
            }]
          }
        }
      }
    ], { chatBusy: true });

    expect(screen.getByText("正在整理要点")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "正在整理要点" })).not.toBeInTheDocument();
    expect(screen.queryByText(/已识别为/)).not.toBeInTheDocument();
    expect(document.querySelector(".thinking-process-scroll")).not.toBeInTheDocument();
  });

  it("shows completion repair as a friendly system activity", () => {
    renderChat([
      message,
      {
        id: -1,
        role: "assistant",
        content: "",
        created_at: "2026-08-11T00:01:00Z",
        payload: {
          agent: {
            provider: "test",
            platform: "local",
            rounds: 1,
            status: "done",
            events: [{
              round: 1,
              tool_call_id: "completion-validation-1",
              tool_name: "completion_validator",
              status: "running",
              message: "必要步骤尚未完成，正在继续执行",
              data: { missing_tools: ["research_company"] }
            }]
          }
        }
      }
    ], { chatBusy: true });

    const toggle = screen.getByRole("button", { name: /正在补齐必要步骤/ });
    expect(toggle).not.toHaveTextContent("research_company");
    fireEvent.click(toggle);
    expect(screen.getByRole("complementary", { name: "研究详情" }))
      .toHaveTextContent("必要步骤尚未完成，正在继续执行");
  });

  it("appends fetched source hosts after a research tool finishes", () => {
    renderChat([{
      id: 12,
      role: "assistant",
      content: "腾讯是一家互联网公司。",
      created_at: "2026-08-11T00:01:00Z",
      payload: {
        agent: {
          provider: "test",
          platform: "local",
          rounds: 1,
          status: "done",
          events: [
            {
              round: 0,
              tool_call_id: "think-1",
              tool_name: "agent_thinking",
              status: "done",
              message: "已识别为公司公开信息研究，需要先规划并限制可用工具"
            },
            {
              round: 1,
              tool_call_id: "call-1",
              tool_name: "research_company",
              status: "done",
              message: "已找到并读取 2 条公开公司资料，可生成带来源的公司研究报告",
              data: {
                sources: [
                  { title: "天眼查", url: "https://www.tianyancha.com/company/1", domain: "www.tianyancha.com" },
                  { title: "官网", url: "https://www.tencent.com/", domain: "www.tencent.com" }
                ]
              }
            }
          ]
        }
      }
    }]);

    fireEvent.click(screen.getByRole("button", { name: "思考过程，打开研究详情" }));
    expect(screen.queryByText(/已识别为/)).not.toBeInTheDocument();
    expect(screen.getByText("已找到并读取 2 条公开公司资料，可生成带来源的公司研究报告")).toBeVisible();
    expect(screen.getByText("2 个来源")).toBeVisible();
    expect(screen.getByRole("button", { name: "来源 1：天眼查" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "来源 2：官网" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /打开原网页/ })).toHaveAttribute("href", "https://www.tianyancha.com/company/1");
  });

  it("shows a specific thinking placeholder while waiting for the first assistant token", () => {
    renderChat([message], { chatBusy: true });

    expect(screen.getByText("正在整理要点")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "正在整理要点" })).not.toBeInTheDocument();
    expect(screen.queryByText("正在思考")).not.toBeInTheDocument();
  });

  it("shows the current executing task in the collapsed thinking header", () => {
    const thoughtBody = "先确认项目范围，再对照公司公开资料展开追问。";
    renderChat([
      message,
      {
        id: -1,
        role: "assistant",
        content: "",
        created_at: "2026-08-11T00:01:00Z",
        payload: {
          agent: {
            provider: "test",
            platform: "local",
            rounds: 1,
            status: "done",
            events: [
              {
                round: 1,
                tool_call_id: "think-1",
                tool_name: "agent_thinking",
                status: "done",
                message: thoughtBody
              },
              {
                round: 1,
                tool_call_id: "call-1",
                tool_name: "research_company",
                status: "running",
                message: "正在执行 research_company"
              }
            ],
            plan: {
              goal: "核验公司",
              route: "company_research",
              requires_confirmation: false,
              steps: [{
                id: "s1",
                title: "搜索公司资料",
                tool_name: "research_company",
                risk: "read_only",
                status: "running"
              }]
            }
          }
        }
      }
    ], { chatBusy: true });

    const toggle = screen.getByRole("button", { name: /正在检索公司资料/ });
    expect(toggle).toHaveTextContent("搜索公司资料");
    expect(toggle).not.toHaveTextContent(thoughtBody);
    expect(screen.queryByText("思考过程")).not.toBeInTheDocument();
  });

  it("uses the latest tool event message as the muted current-task line", () => {
    renderChat([
      message,
      {
        id: -1,
        role: "assistant",
        content: "",
        created_at: "2026-08-11T00:01:00Z",
        payload: {
          agent: {
            provider: "test",
            platform: "local",
            rounds: 1,
            status: "done",
            events: [{
              round: 1,
              tool_call_id: "call-2",
              tool_name: "search_resume_evidence",
              status: "running",
              message: "正在从简历中定位项目证据"
            }]
          }
        }
      }
    ], { chatBusy: true });

    const toggle = screen.getByRole("button", { name: /正在读取简历/ });
    expect(toggle).toHaveTextContent("正在从简历中定位项目证据");
  });

  it("keeps the thought body private while allowing the research panel to open", () => {
    const thoughtBody = "我先读取简历，再对比岗位要求，然后整理成面试可讲的要点。";
    renderChat([
      message,
      {
        id: -1,
        role: "assistant",
        content: "",
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
              status: "running",
              message: thoughtBody
            }]
          }
        }
      }
    ], { chatBusy: true });

    const toggle = screen.getByRole("button", { name: "正在整理要点，打开研究详情" });
    expect(toggle).not.toHaveTextContent(thoughtBody);
    fireEvent.click(toggle);
    expect(screen.getByRole("complementary", { name: "研究详情" })).toBeInTheDocument();
    expect(screen.queryByText(thoughtBody)).not.toBeInTheDocument();
  });

  it("renders in-text source links as numbered citation previews", () => {
    renderChat([
      message,
      {
        id: 12,
        role: "assistant",
        content: "腾讯科技成立于2000年，来源：[天眼查](https://www.tianyancha.com/company/150041670)。",
        created_at: "2026-08-11T00:01:00Z",
        payload: {
          agent: {
            provider: "test",
            platform: "local",
            rounds: 1,
            status: "done",
            events: [{
              round: 1,
              tool_call_id: "web-1",
              tool_name: "search_public_web",
              status: "done",
              message: "ok",
              data: {
                sources: [{
                  title: "腾讯科技（深圳）有限公司",
                  url: "https://www.tianyancha.com/company/150041670",
                  domain: "www.tianyancha.com"
                }]
              }
            }]
          }
        }
      }
    ]);

    const citation = screen.getByRole("link", { name: "来源 1：腾讯科技（深圳）有限公司" });
    expect(citation).toHaveClass("md-citation");
    expect(citation).toHaveAttribute("href", "https://www.tianyancha.com/company/150041670");
    expect(citation).toHaveAttribute("target", "_blank");
    expect(citation.querySelector(".md-citation-badge")).toHaveTextContent("1");
    expect(screen.queryByRole("link", { name: "天眼查" })).not.toBeInTheDocument();
    expect(citation).toHaveTextContent("腾讯科技（深圳）有限公司");
    expect(citation).toHaveTextContent("www.tianyancha.com");

    fireEvent.click(citation);
    expect(screen.getByRole("complementary", { name: "研究详情" })).toHaveTextContent("腾讯科技（深圳）有限公司");
  });

  it("opens source evidence details inside a researched answer", () => {
    renderChat([{
      id: 12,
      role: "assistant",
      content: "已完成联网核验。",
      created_at: "2026-08-11T00:01:00Z",
      payload: {
        agent: {
          provider: "test",
          platform: "local",
          rounds: 1,
          status: "done",
          events: [{
            round: 1,
            tool_call_id: "web-detail",
            tool_name: "search_public_web",
            status: "done",
            message: "ok",
            data: {
              sources: [{
                title: "Python 官方文档",
                url: "https://docs.python.org/3/library/asyncio.html",
                domain: "docs.python.org",
                snippet: "asyncio 用于编写并发代码。",
                published_at: "2026-08-01"
              }]
            }
          }]
        }
      }
    }]);

    fireEvent.click(screen.getByRole("button", { name: "查看全部 1 个来源" }));
    const panel = screen.getByRole("complementary", { name: "研究详情" });
    expect(panel).toHaveTextContent("asyncio 用于编写并发代码");
    expect(screen.getByRole("link", { name: /打开原网页/ })).toHaveAttribute("href", "https://docs.python.org/3/library/asyncio.html");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "研究详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "研究详情" })).toHaveAttribute("aria-expanded", "false");
  });

  it("renders each Mermaid block in its own stable container", async () => {
    const first = "flowchart LR\n  A --> B";
    const second = "sequenceDiagram\n  Alice->>Bob: Hello";
    renderChat([assistantMessage(`${fencedMermaid(first)}\n\n${fencedMermaid(second)}`)]);

    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledTimes(2));

    const diagrams = screen.getAllByTestId("mermaid-diagram");
    const containers = screen.getAllByRole("img", { name: "Mermaid 图表" });
    expect(diagrams).toHaveLength(2);
    expect(containers[0].id).not.toBe(containers[1].id);
    expect(containers[0].querySelector("[data-rendered-mermaid]")).toBeInTheDocument();
    expect(containers[1].querySelector("[data-rendered-mermaid]")).toBeInTheDocument();
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: "strict",
      flowchart: { htmlLabels: false }
    }));
  });

  it("renders mermaid mindmaps as an interactive outline, not a static image", () => {
    const source = "mindmap\n  root((求职准备))\n    简历\n    面试";
    renderChat([assistantMessage(fencedMermaid(source))]);

    expect(screen.getByTestId("interactive-mindmap")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /求职准备/ })).toBeInTheDocument();
    expect(screen.getByText("点击节点展开或收起，拖动画布移动；可全屏查看或复位视图。")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Mermaid 图表" })).not.toBeInTheDocument();
    expect(mermaidMocks.render).not.toHaveBeenCalled();
  });

  it("shows a copyable source fallback when a mindmap cannot be parsed", () => {
    const source = "mindmap\n  root((未闭合)";
    renderChat([assistantMessage(fencedMermaid(source))]);

    const fallback = screen.getByRole("alert");
    expect(fallback).toHaveTextContent("暂时无法显示这张思维导图");
    expect(fallback.querySelector("code.language-mermaid")?.textContent).toBe(source);
    expect(screen.getByRole("button", { name: "复制源码" })).toBeInTheDocument();
    expect(mermaidMocks.render).not.toHaveBeenCalled();
  });

  it("shows a copyable source fallback when Mermaid rendering fails", async () => {
    const source = "flowchart LR\n  A -->";
    mermaidMocks.render.mockRejectedValueOnce(new Error("parse error"));
    renderChat([assistantMessage(fencedMermaid(source))]);

    const fallback = await screen.findByRole("alert");
    expect(fallback).toHaveTextContent("暂时无法显示这张图");
    expect(fallback.querySelector("code.language-mermaid")?.textContent).toBe(source);
    expect(screen.getByRole("button", { name: "复制源码" })).toBeInTheDocument();
  });

  it("splits interview question stems and hints out of a long assistant answer", () => {
    renderChat([
      message,
      assistantMessage([
        "可以。先从检索质量开始。",
        "",
        "**Q1 | RAG 会议问答：检索到了，但答案仍偏泛，你怎么收？**",
        "",
        "追问：你怎么判断召回够不够用。",
        "",
        "Hint：先讲判断标准，再讲你改过的一处。"
      ].join("\n"))
    ]);

    const stem = document.querySelector(".interview-question-stem");
    expect(stem).toBeInTheDocument();
    expect(stem?.querySelector(".interview-question-index")).toHaveTextContent("Q1");
    expect(stem).toHaveTextContent("RAG 会议问答：检索到了，但答案仍偏泛，你怎么收？");
    expect(stem).not.toHaveTextContent("Q1 |");
    expect(document.querySelector(".interview-hint-label")).toHaveTextContent("Hint");
    expect(screen.getByText("先讲判断标准，再讲你改过的一处。")).toBeInTheDocument();
    expect(document.querySelector(".interview-followup-label")).toHaveTextContent("追问");
    expect(document.querySelector(".message-markdown")).toHaveClass("interview-drill");

    const dialog = screen.getByLabelText("输出结果");
    const copy = screen.getByLabelText("复制回答");
    const regenerate = screen.getByLabelText("重新生成回答");
    expect(dialog).toHaveClass("message-dialog");
    expect(dialog.contains(copy)).toBe(false);
    expect(dialog.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(regenerate).toBeInTheDocument();
  });

  it("keeps user copy and edit under the cue bubble", () => {
    renderChat();

    const bubble = document.querySelector(".message.user .message-dialog");
    const copy = screen.getByLabelText("复制消息");
    const edit = screen.getByLabelText("编辑消息");
    expect(bubble).toHaveTextContent("围绕一个项目追问我");
    expect(bubble?.contains(copy)).toBe(false);
    expect(copy.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("parses Q-index and hint lines used in interview drills", () => {
    expect(interviewQuestionParts("Q1 | RAG 会议问答：检索到了，但答案仍偏泛，你怎么收？")).toEqual({
      index: "Q1",
      title: "RAG 会议问答：检索到了，但答案仍偏泛，你怎么收？"
    });
    expect(interviewHintParts("Hint：先讲判断标准，再讲你改过的一处。")).toEqual({
      label: "Hint",
      body: "先讲判断标准，再讲你改过的一处。"
    });
    expect(interviewQuestionParts("可以。先从检索质量开始。")).toBeNull();
  });

  it("leaves non-Mermaid code blocks unchanged", () => {
    renderChat([assistantMessage(["```typescript", "const answer = 42;", "```"].join("\n"))]);

    const code = document.querySelector("pre > code.language-typescript");
    expect(code).toHaveTextContent("const answer = 42;");
    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument();
    expect(mermaidMocks.render).not.toHaveBeenCalled();
  });

  it("waits for streaming to finish before rendering Mermaid", () => {
    renderChat([
      message,
      assistantMessage(["```mermaid", "mindmap", "  root((准备中))"].join("\n"), -1)
    ], { chatBusy: true });

    expect(screen.getByText("思维导图生成中，完成后可展开查看…")).toBeInTheDocument();
    expect(mermaidMocks.render).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
