import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspace, type AgentRunResult, type ChatMessage } from "./ChatWorkspace";

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

function renderChat(messages: ChatMessage[] = [message], extras: { chatBusy?: boolean; latestAgent?: AgentRunResult } = {}) {
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
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
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

  it("renders a quieter welcome with starter cards", () => {
    renderChat([]);

    expect(screen.getByText("面试准备")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "从一个具体问题开始。" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /梳理项目表达/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /复盘一次面试/ })).toBeInTheDocument();
  });

  it("fills the composer from a starter card instead of sending", async () => {
    const props = renderChat([]);

    fireEvent.click(screen.getByRole("button", { name: /练习项目追问/ }));

    expect(props.onSend).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByLabelText("输入消息")).toHaveValue("围绕这个项目追问我。项目是：");
    });
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

    const resume = screen.getByRole("button", { name: "查看已保存简历" });
    expect(resume).toHaveTextContent("简历");
    expect(resume).toHaveAttribute("title", "查看已保存简历，提问时会自动参考");
    expect(screen.getByText("分析")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /分析/ })).not.toBeInTheDocument();
    expect(screen.queryByText("参考简历原文")).not.toBeInTheDocument();

    fireEvent.click(resume);
    expect(onOpenResume).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText("输入消息")).toHaveValue("");
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
    const body = document.querySelector(".thinking-process-scroll");
    expect(body).not.toHaveTextContent("已识别为公司公开信息研究，需要先规划并限制可用工具");
    expect(body).toHaveTextContent("已规划 1 个步骤：核验腾讯科技公开信息");
    expect(body).toHaveTextContent("正在检索：腾讯科技");
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

    const toggle = screen.getByRole("button", { name: "正在整理要点" });
    fireEvent.click(toggle);
    expect(screen.queryByText(/已识别为/)).not.toBeInTheDocument();
    expect(document.querySelector(".thinking-process-scroll")).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "思考过程" }));
    expect(screen.queryByText(/已识别为/)).not.toBeInTheDocument();
    expect(screen.getByText("已找到并读取 2 条公开公司资料，可生成带来源的公司研究报告")).toBeVisible();
    expect(screen.getByText("已阅读 2 个站点")).toBeVisible();
    expect(screen.getByRole("link", { name: "tianyancha.com" })).toHaveAttribute("href", "https://www.tianyancha.com/company/1");
    expect(screen.getByRole("link", { name: "tencent.com" })).toHaveAttribute("href", "https://www.tencent.com/");
  });

  it("shows a specific thinking placeholder while waiting for the first assistant token", () => {
    renderChat([message], { chatBusy: true });

    expect(screen.getByText("正在整理要点")).toBeInTheDocument();
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
    expect(toggle).toHaveAttribute("aria-expanded", "false");
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
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("正在从简历中定位项目证据");
  });

  it("keeps the thought body out of the streaming header until expanded", () => {
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

    const toggle = screen.getByRole("button", { name: "正在整理要点" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveTextContent(thoughtBody);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(thoughtBody)).toBeVisible();
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
