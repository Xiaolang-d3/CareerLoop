import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspace } from "./ChatWorkspace";
import type { AgentRunResult, ChatMessage, ChatRetryDraft, ChatAttachment, ChatComposerDraft, ChatWorkspaceProps, WebSearchOptions } from "../features/chat/types";

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

function renderChat(messages: ChatMessage[] = [message], extras: {
  density?: "page" | "dock";
  chatBusy?: boolean;
  latestAgent?: AgentRunResult;
  webSearchAvailable?: boolean;
  webSearchProvider?: string;
  webSearchCapabilities?: ChatWorkspaceProps["webSearchCapabilities"];
  composerSearchDrafts?: Map<number, WebSearchOptions>;
  retryDraft?: ChatRetryDraft | null;
  modelChecking?: boolean;
  modelUnavailable?: string;
  modelConfigured?: boolean;
  currentModelName?: string;
  taskCancelBusy?: boolean;
  libraryAttachments?: { conversationId: number; attachments: ChatAttachment[] };
  onLibraryAttachmentsConsumed?: () => void;
  composerDraft?: ChatComposerDraft;
  onComposerDraftConsumed?: () => void;
} = {}) {
  const props = {
    libraryAttachments: extras.libraryAttachments,
    onLibraryAttachmentsConsumed: extras.onLibraryAttachmentsConsumed,
    composerDraft: extras.composerDraft,
    composerSearchDrafts: extras.composerSearchDrafts,
    onComposerDraftConsumed: extras.onComposerDraftConsumed,
    density: extras.density,
    modelChecking: extras.modelChecking,
    modelUnavailable: extras.modelUnavailable,
    modelConfigured: extras.modelConfigured,
    currentModelName: extras.currentModelName,
    onOpenModelSettings: vi.fn(),
    conversationTitle: conversation.title,
    messages,
    hiddenMessageCount: 0,
    chatBusy: extras.chatBusy ?? false,
    currentConversationId: conversation.id,
    conversations: [conversation],
    conversationBusy: false,
    waitingForUser: false,
    latestAgent: extras.latestAgent ?? [...messages].reverse().find((item) => item.role === "assistant")?.payload?.agent,
    taskCancelBusy: extras.taskCancelBusy ?? false,
    retryDraft: extras.retryDraft ?? null,
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
    webSearchProvider: extras.webSearchProvider,
    webSearchCapabilities: extras.webSearchCapabilities ?? (extras.webSearchAvailable ? { enabled: true, provider: extras.webSearchProvider ?? "tavily", supported_topics: ["auto", "general", "news", "finance"] as Array<"auto" | "general" | "news" | "finance">, supports_auto_parameters: true, supports_technical_preference: true } : undefined),
    onUploadAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onAttachmentInvalid: vi.fn(),
    onSuggestedAction: vi.fn(),
    onCancelTask: vi.fn(),
    onSend: vi.fn(),
    onRetry: vi.fn(),
    onStop: vi.fn(),
    onEdit: vi.fn(),
    onRegenerate: vi.fn(),
    onOpenLibrary: vi.fn()
  };
  const view = render(<ChatWorkspace {...props} />);
  return { ...props, view };
}

describe("ChatWorkspace", () => {
  it("restores search choices per conversation and resets them for a new account scope", () => {
    const map = new Map<number, WebSearchOptions>();
    const props = renderChat([message], { webSearchAvailable: true, composerSearchDrafts: map });
    fireEvent.click(screen.getByRole("button", { name: "联网搜索" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索类别" }));
    fireEvent.click(screen.getByRole("radio", { name: /金融/ }));
    const second = { ...conversation, id: conversation.id + 1 };
    props.view.rerender(<ChatWorkspace {...props} currentConversationId={second.id} conversations={[conversation, second]} />);
    expect(screen.getByRole("button", { name: "联网搜索" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "联网搜索" }));
    expect(screen.getByRole("button", { name: "搜索类别" })).toHaveTextContent("自动");
    props.view.rerender(<ChatWorkspace {...props} />);
    expect(screen.getByRole("button", { name: "搜索类别" })).toHaveTextContent("金融");
    props.view.rerender(<ChatWorkspace {...props} composerSearchDrafts={new Map()} />);
    expect(screen.getByRole("button", { name: "联网搜索" })).toHaveAttribute("aria-pressed", "false");
  });

  it("inherits clarification search settings and allows explicitly disabling them for the next send", async () => {
    const pending: ChatMessage = { ...assistantMessage("请确认"), payload: { agent: { provider: "test", platform: "local", rounds: 1, status: "waiting_user", events: [] } } };
    const source: ChatMessage = { ...message, payload: { web_search_options: { version: 1, enabled: true, topic: "news", source_preference: "technical", provider: "tavily" } } };
    const props = renderChat([source, pending], { webSearchAvailable: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "搜索类别" })).toHaveTextContent("新闻"));
    fireEvent.click(screen.getByRole("button", { name: "搜索类别" }));
    expect(screen.getByText("沿用待确认任务的联网设置；修改后按新配置执行。")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "联网搜索设置" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "联网搜索" }));
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "只用已有资料" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(props.onSend).toHaveBeenCalledWith("只用已有资料", [], [], false, "news", "technical"));
  });

  it("keeps unknown actual categories inside answer details without inventing a match", () => {
    const answer: ChatMessage = { ...assistantMessage("测试回答"), payload: { agent: { provider: "test", platform: "local", rounds: 1, status: "done", events: [{ round: 1, tool_call_id: "search-1", tool_name: "search_public_web", status: "done", message: "检索完成", data: { search_metadata: { provider: "tavily", requested_topic: "auto", sent_topic: null, effective_topic: null, source_preference: "technical", warnings: [] } } }] } } };
    renderChat([message, answer]);
    expect(screen.queryByText(/服务实际类别/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "回答详情" }));
    const details = screen.getByRole("region", { name: "回答详情" });
    expect(details).toHaveTextContent("搜索服务：Tavily");
    expect(details).toHaveTextContent("服务实际类别：未知");
    expect(details).toHaveTextContent("优先技术资料");
  });

  it("keeps the current model label while generating and provides a stop action", async () => {
    const props = renderChat([message], { chatBusy: true, currentModelName: "grok-4.7" });
    const model = screen.getByRole("button", { name: "切换模型，当前 grok-4.7" });
    expect(model).toHaveTextContent("grok-4.7");
    expect(model).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    await waitFor(() => expect(props.onStop).toHaveBeenCalledOnce());
  });

  it("shows a pending stop without allowing a second request", () => {
    renderChat([message], { chatBusy: true, taskCancelBusy: true });
    expect(screen.getByRole("status")).toHaveTextContent("正在停止生成");
    expect(screen.getByRole("button", { name: "正在停止生成" })).toBeDisabled();
  });

  it("keeps a stopped process collapsed above the partial answer and allows reopening it", () => {
    const agent: AgentRunResult = { provider: "test", platform: "local", rounds: 1, status: "cancelled", events: [{ round: 1, tool_call_id: "search-1", tool_name: "search_library", status: "done", message: "已查阅项目资料" }] };
    const props = renderChat([message, { ...assistantMessage("已生成的部分内容"), payload: { agent } }]);
    const toggle = screen.getByRole("button", { name: "展开思考与执行过程" });
    const process = screen.getByRole("region", { name: "思考与执行过程" });
    const answer = within(screen.getByRole("log")).getByText("已生成的部分内容");
    expect(toggle).toHaveTextContent("已停止");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(answer).toBeInTheDocument();
    expect(process.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(props.view.container.querySelector(".chat-run-status")).not.toBeInTheDocument();
    expect(process.querySelector(".spinning")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看过程，打开研究详情" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(process).getByText("已查阅项目资料")).toBeVisible();
    expect(screen.queryByRole("complementary", { name: "来源详情" })).not.toBeInTheDocument();
  });

  it("uses the final result instead of treating a recovered tool failure as a failed answer", () => {
    const agent: AgentRunResult = { provider: "test", platform: "local", rounds: 2, status: "done", events: [{ round: 1, tool_call_id: "search-1", tool_name: "search_library", status: "failed", message: "该检索已改用其他策略" }] };
    renderChat([{ ...assistantMessage("已完成回答"), payload: { agent } }]);
    expect(screen.queryByText("生成失败")).not.toBeInTheDocument();
  });

  it("shows failed results even when the service did not emit tool events", () => {
    const agent: AgentRunResult = { provider: "test", platform: "local", rounds: 0, status: "failed", events: [], error: { code: "service_error", message: "服务不可用", retryable: true } };
    renderChat([{ ...assistantMessage("服务不可用"), payload: { agent } }]);
    expect(screen.getByText("生成失败")).toBeInTheDocument();
    expect(screen.getAllByText("服务不可用")).toHaveLength(1);
  });

  it("shows keyboard hints while editing without losing the draft when focus moves through the tools", () => {
    const props = renderChat();
    const input = screen.getByRole("textbox", { name: "输入消息" });
    const hint = props.view.container.querySelector(".composer-input-hint")!;
    expect(hint).toHaveAttribute("aria-hidden", "true");
    expect(input).toHaveAccessibleDescription(/Enter 发送 · Shift \+ Enter 换行/);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "保留正在编辑的内容" } });
    expect(hint).toHaveAttribute("aria-hidden", "false");
    const attachment = screen.getByRole("button", { name: "添加附件" });
    expect(within(screen.getByRole("group", { name: "输入选项" })).getByRole("button", { name: "添加附件" })).toBe(attachment);
    expect(attachment).toHaveTextContent(/^$/);
    fireEvent.blur(input, { relatedTarget: attachment });
    fireEvent.focus(attachment);
    expect(hint).toHaveAttribute("aria-hidden", "false");
    fireEvent.blur(attachment, { relatedTarget: document.body });
    expect(hint).toHaveAttribute("aria-hidden", "true");
    expect(input).toHaveValue("保留正在编辑的内容");
  });

  it("keeps the character limit visible when a long draft is not focused", () => {
    const props = renderChat();
    const input = screen.getByRole("textbox", { name: "输入消息" });
    fireEvent.change(input, { target: { value: "字".repeat(180_001) } });
    expect(screen.getByText("180,001 / 200,000 字")).toHaveAttribute("role", "status");
    expect(props.view.container.querySelector(".composer-input-hint")).toHaveAttribute("aria-hidden", "false");
    expect(input).toHaveAttribute("maxlength", "200000");
  });

  it("opens file selection from the compact attachment button", () => {
    const props = renderChat();
    const fileInput = props.view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const choose = vi.spyOn(fileInput, "click").mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    expect(choose).toHaveBeenCalledOnce();
    props.view.rerender(<ChatWorkspace {...props} attachmentBusy />);
    expect(screen.getByRole("button", { name: "附件处理中" })).toBeDisabled();
  });

  it("keeps a greeting focused on messages and one model picker", () => {
    const greeting = { ...assistantMessage("你好，有什么可以帮你？"), payload: { model_selection: {
      profile_id: "grok", connection_id: "local", profile_revision: 1, connection_revision: 1, model_name: "grok-4.7"
    } } };
    const props = renderChat([message, greeting]);
    props.view.rerender(<ChatWorkspace {...props} currentModelName="grok-4.7" defaultModelName="grok-4.7" modelConfigured />);
    expect(screen.getAllByText("grok-4.7")).toHaveLength(1);
    expect(screen.queryByText(/生成模型：/)).not.toBeInTheDocument();
    expect(screen.queryByText("模型详情")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "来源详情" })).not.toBeInTheDocument();
    for (const name of ["复制消息", "编辑消息", "复制回答", "重新生成回答", "回答详情"]) {
      expect(screen.getByRole("button", { name })).toHaveTextContent(/^$/);
    }
  });

  it("opens historical model details on demand and closes them with Escape or outside click", () => {
    renderChat([{ ...assistantMessage("历史回答"), payload: { model_selection: {
      profile_id: "old", connection_id: "local", profile_revision: 2, connection_revision: 3, model_name: "历史模型"
    } } }]);
    const button = screen.getByRole("button", { name: "回答详情" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(screen.getByRole("region", { name: "回答详情" })).toHaveTextContent("历史模型");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveFocus();
    expect(screen.queryByRole("region", { name: "回答详情" })).not.toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole("textbox", { name: "输入消息" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("does not repeat an error already present in the answer", () => {
    const errorMessage = "模型服务暂时不可用，请稍后重试。";
    renderChat([{ ...assistantMessage(errorMessage), payload: { agent: {
      provider: "test", platform: "local", rounds: 1, status: "failed",
      events: [{ round: 1, tool_call_id: "provider-1", tool_name: "model_provider", status: "failed", message: errorMessage }],
      error: { code: "model_service_error", message: errorMessage, retryable: true }
    } } }]);
    expect(within(screen.getByRole("log")).getAllByText(errorMessage)).toHaveLength(1);
    expect(screen.getByRole("region", { name: "思考与执行过程" })).not.toHaveTextContent("请先检查设置");
    expect(screen.getByRole("button", { name: "重试回答" })).toHaveTextContent(/^$/);
  });

  it("shows one failure prompt with settings, retry and the retained draft", () => {
    const draft: ChatRetryDraft = { content: "保留的问题", attachmentIds: [], visionAttachmentIds: [], webSearch: false, webSearchTopic: "auto", webSearchSourcePreference: "none", reason: "send_failed" };
    const props = renderChat([], { modelUnavailable: "服务暂时不可用", retryDraft: draft });
    const prompt = screen.getByRole("alert", { name: "模型服务不可用" });
    expect(props.view.container.querySelectorAll(".chat-retry-prompt")).toHaveLength(1);
    expect(screen.queryByText("上一条消息未发送成功")).not.toBeInTheDocument();
    fireEvent.click(within(prompt).getByRole("button", { name: "重试" }));
    expect(props.onRetry).toHaveBeenCalledWith(draft);
    fireEvent.click(within(prompt).getByRole("button", { name: "去设置模型" }));
    expect(props.onOpenModelSettings).toHaveBeenCalledOnce();
    fireEvent.click(within(prompt).getByText("查看保留的内容"));
    expect(within(prompt).getByText(draft.content)).toBeVisible();
  });

  it("shows the live activity and current task in one expanded message process", () => {
    const agent: AgentRunResult = { provider: "test", platform: "local", rounds: 1, status: "done", events: [{
      round: 1, tool_call_id: "search-1", tool_name: "search_library", status: "running", message: "正在查阅项目资料"
    }] };
    renderChat([message, { ...assistantMessage("", -1), payload: { agent } }], { chatBusy: true, latestAgent: agent });
    expect(screen.getAllByText("正在检索资料")).toHaveLength(1);
    expect(screen.getAllByText("正在查阅项目资料")).toHaveLength(1);
    const process = screen.getByRole("region", { name: "思考与执行过程" });
    expect(within(process).getByRole("button", { name: "收起思考与执行过程" })).toHaveAttribute("aria-expanded", "true");
    expect(process.closest(".message.assistant")).not.toBeNull();
    expect(process.closest(".chat-composer")).toBeNull();
    expect(screen.queryByRole("button", { name: "查看过程，打开研究详情" })).not.toBeInTheDocument();
  });

  it("shows the fixed routing version and stage reasons in historical model details", () => {
    renderChat([message, { ...assistantMessage("最终回答"), payload: { model_selection: {
      profile_id: "execute", connection_id: "c", profile_revision: 1, connection_revision: 2,
      model_name: "执行模型", policy_version: 3,
      stage_selections: {
      classify: { model_name: "识别模型", selection_reason: "stage_role", capability_status: "satisfied" },
      plan: { model_name: "规划模型", selection_reason: "default_profile" },
        execute: { model_name: "执行模型", selection_reason: "explicit_profile", capability_status: "unverified" }
      }
    } } }]);
    expect(screen.queryByText("生成模型：执行模型")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回答详情" }));
    expect(screen.getByText("生成模型：执行模型")).toBeVisible();
    expect(screen.getByText(/路由版本 3/)).toBeInTheDocument();
    expect(screen.getByText("意图识别：识别模型 · 阶段分工")).toBeInTheDocument();
  expect(screen.getByText("任务规划：规划模型 · 账号默认 · 本轮未调用")).toBeInTheDocument();
    expect(screen.getByText("执行回答：执行模型 · 手动选模 · 所需能力未验证")).toBeInTheDocument();
  });

  it("puts the model picker in the composer toolbar and reminds the user to configure a model", () => {
    const props = renderChat([message], { modelConfigured: false });
    const toolbar = screen.getByRole("group", { name: "输入选项" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "未配置模型，去设置" }));
    expect(props.onOpenModelSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /切换模型/ })).not.toBeInTheDocument();
  });

  it("reports message copy success and clipboard failure", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderChat();
    fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "复制消息" })).toHaveAttribute("title", "已复制"));
    expect(screen.getByText("已复制")).toHaveClass("message-copy-feedback");
    expect(writeText).toHaveBeenCalledWith(message.content);
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "复制消息" })).toHaveAttribute("title", "复制失败，请重试"));
  });

  it("explains editing impact and preserves a long replacement without sending on cancel", async () => {
    const props = renderChat([message, assistantMessage("原回答")]);
    fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));
    const editor = await screen.findByRole("textbox", { name: "编辑消息" });
    expect(editor).toHaveAttribute("maxlength", "200000");
    expect(screen.getByText("将替换本条消息及后续消息，并重新生成回复")).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: "长消息".repeat(500) } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(props.onEdit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "编辑消息" })).not.toBeInTheDocument());
    expect(within(screen.getByRole("log")).getByText(message.content)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "编辑消息" }), { target: { value: "长消息".repeat(500) } });
    fireEvent.click(screen.getByRole("button", { name: "保存并重新生成" }));
    await waitFor(() => expect(props.onEdit).toHaveBeenCalledWith(message.id, "长消息".repeat(500)));
  });

  it("describes regeneration scope and regenerates from the matching user message", async () => {
    const props = renderChat([message, assistantMessage("原回答")]);
    const regenerate = screen.getByRole("button", { name: "重新生成回答" });
    expect(regenerate).toHaveAccessibleDescription("重新生成将替换本轮及后续消息");
    expect(screen.getByText("重新生成将替换本轮及后续消息")).toHaveClass("sr-only");
    expect(regenerate).toHaveAttribute("title", "重新生成，将替换本轮及后续消息");
    fireEvent.click(regenerate);
    await waitFor(() => expect(props.onRegenerate).toHaveBeenCalledWith(message.id));
  });

  it("copies complete long code and expands its preview", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const code = Array.from({ length: 30 }, (_, i) => `print(${i})`).join("\n");
    renderChat([assistantMessage(["```python", code, "```"].join("\n"))]);
    expect(screen.getByText("python")).toBeInTheDocument();
    const expand = screen.getByRole("button", { name: /展开完整代码/ });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "收起代码" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${code}\n`));
    const copied = await screen.findByRole("button", { name: "已复制" });
    writeText.mockRejectedValueOnce(new Error("clipboard denied"));
    fireEvent.click(copied);
    await waitFor(() => expect(screen.getByRole("button", { name: "复制失败，请重试" })).toBeInTheDocument());
  });

  it("restores each conversation's text draft and keeps new conversations empty", () => {
    const { view, ...props } = renderChat();
    const input = screen.getByRole("textbox", { name: "输入消息" });
    fireEvent.change(input, { target: { value: "项目一的未发送草稿" } });
    view.rerender(<ChatWorkspace {...props} currentConversationId={2} />);
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "项目二的未发送草稿" } });
    view.rerender(<ChatWorkspace {...props} currentConversationId={1} />);
    expect(input).toHaveValue("项目一的未发送草稿");
    view.rerender(<ChatWorkspace {...props} currentConversationId={2} />);
    expect(input).toHaveValue("项目二的未发送草稿");
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("keeps a session draft across workspace unmounts without browser storage", () => {
    const { view, ...props } = renderChat();
    const drafts = new Map<number, string>();
    view.rerender(<ChatWorkspace {...props} composerDrafts={drafts} />);
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "离开工作区再回来" } });
    view.unmount();
    render(<ChatWorkspace {...props} composerDrafts={drafts} />);
    expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveValue("离开工作区再回来");
  });

  it("grows and shrinks the editor, scrolls tall content, and preserves long code input", () => {
    renderChat();
    const input = screen.getByRole("textbox", { name: "输入消息" });
    const text = "const value = 123;\n".repeat(100);
    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 400 });
    fireEvent.change(input, { target: { value: text } });
    expect(input).toHaveValue(text);
    expect(input).toHaveAttribute("maxlength", "200000");
    expect(Number.parseFloat((input as HTMLTextAreaElement).style.height)).toBeLessThanOrEqual(240);
    expect(Number.parseFloat((input as HTMLTextAreaElement).style.height)).toBeGreaterThan(200);
    expect((input as HTMLTextAreaElement).style.overflowY).toBe("auto");
    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 70 });
    fireEvent.change(input, { target: { value: "缩短的输入" } });
    expect(input).toHaveStyle({ height: "70px", overflowY: "hidden" });
    expect(screen.getByText("Enter 发送 · Shift + Enter 换行")).toBeInTheDocument();
  });

  it("waits for attachment processing and does not submit an IME confirmation or Shift+Enter", () => {
    const { view, ...props } = renderChat();
    const input = screen.getByRole("textbox", { name: "输入消息" });
    fireEvent.change(input, { target: { value: "中文输入确认" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(props.onSend).not.toHaveBeenCalled();
    view.rerender(<ChatWorkspace {...props} attachmentBusy />);
    expect(screen.getByRole("button", { name: /^发送$/ })).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(props.onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("中文输入确认");
  });

  beforeEach(() => {
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockReset();
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg data-rendered-mermaid="true" viewBox="0 0 100 60"></svg>'
    });
  });

  afterEach(cleanup);

  it("imports a matching home analysis draft once without sending it", async () => {
    const consumed = vi.fn();
    const draft = { id: "home-1", conversationId: 1, content: "请分析这条资讯，来源：https://example.com/news" };
    const p = renderChat([], { composerDraft: draft, onComposerDraftConsumed: consumed });
    const input = screen.getByRole("textbox", { name: "输入消息" });
    await waitFor(() => expect(input).toHaveValue(draft.content));
    expect(consumed).toHaveBeenCalledOnce();
    expect(p.onSend).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "我编辑后的问题" } });
    p.view.rerender(<ChatWorkspace {...p} composerDraft={draft} />);
    expect(input).toHaveValue("我编辑后的问题");
    expect(consumed).toHaveBeenCalledOnce();
  });

  it("preserves existing text until the user chooses to import a draft", async () => {
    const p = renderChat([]);
    const input = screen.getByRole("textbox", { name: "输入消息" });
    fireEvent.change(input, { target: { value: "未发送的原问题" } });
    const consumed = vi.fn();
    const draft = { id: "home-2", conversationId: 2, content: "资讯分析草稿" };
    p.view.rerender(<ChatWorkspace {...p} composerDraft={draft} onComposerDraftConsumed={consumed} />);
    expect(input).toHaveValue("未发送的原问题");
    expect(screen.queryByLabelText("资讯分析草稿")).not.toBeInTheDocument();
    p.view.rerender(<ChatWorkspace {...p} currentConversationId={2} />);
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "未发送的原问题" } });
    p.view.rerender(<ChatWorkspace {...p} currentConversationId={2} composerDraft={draft} onComposerDraftConsumed={consumed} />);
    expect(input).toHaveValue("未发送的原问题");
    expect(consumed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "替换为资讯草稿" }));
    await waitFor(() => expect(input).toHaveValue("资讯分析草稿"));
    expect(consumed).toHaveBeenCalledOnce();
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("consumes library attachments once without clearing the composer or requeueing on conversation switches", async () => {
    const consumed = vi.fn();
    const p = renderChat([], {
      libraryAttachments: { conversationId: 1, attachments: [{ id: "library-7", kind: "document", original_filename: "资料.txt", parse_status: "parsed" }] },
      onLibraryAttachmentsConsumed: consumed,
    });
    expect(await screen.findByRole("button", { name: "移除 资料.txt" })).toBeInTheDocument();
    expect(consumed).toHaveBeenCalledOnce();
    p.view.rerender(<ChatWorkspace {...p} libraryAttachments={null} />);
    expect(screen.getByRole("button", { name: "移除 资料.txt" })).toBeInTheDocument();
    p.view.rerender(<ChatWorkspace {...p} libraryAttachments={null} currentConversationId={2} />);
    p.view.rerender(<ChatWorkspace {...p} libraryAttachments={null} currentConversationId={1} />);
    expect(screen.queryByRole("button", { name: "移除 资料.txt" })).not.toBeInTheDocument();
  });

  it("offers model settings when service is unavailable", () => {
    const props = renderChat([], { modelUnavailable: "模型连接失败" });
    expect(screen.getByRole("alert")).toHaveTextContent("模型连接失败");
    fireEvent.click(screen.getByRole("button", { name: "去设置模型" }));
    expect(props.onOpenModelSettings).toHaveBeenCalledOnce();
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("announces the pre-send model check", () => {
    renderChat([], { modelChecking: true, chatBusy: true });
    expect(screen.getByText("正在检查模型服务…")).toBeInTheDocument();
  });

  it("keeps conversation actions without a second route heading", () => {
    renderChat();

    expect(screen.getByLabelText("围绕一个项目追问我 · 对话操作")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "对话操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重命名对话" })).toHaveTextContent("围绕一个项目追问我");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("准备中")).not.toBeInTheDocument();
    expect(screen.queryByText("灯灯 · 面试准备")).not.toBeInTheDocument();
  });

  it("continues an interrupted durable run through the retry callback", () => {
    const retryDraft: ChatRetryDraft = {
      content: "继续分析这份材料",
      attachmentIds: ["attachment-1"],
      visionAttachmentIds: [],
      webSearch: true,
      webSearchTopic: "general",
      webSearchSourcePreference: "technical",
      runId: "run-recover-1",
      reason: "interrupted"
    };
    const props = renderChat([message], { retryDraft });

    expect(screen.getByLabelText("任务恢复提示")).toHaveTextContent("可从最近检查点继续");
    fireEvent.click(screen.getByRole("button", { name: "继续执行" }));

    expect(props.onRetry).toHaveBeenCalledWith(retryDraft);
    expect(props.onSend).not.toHaveBeenCalled();
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
    expect(screen.getByLabelText("输入消息")).toHaveAttribute("placeholder", "输入你的问题或任务…");
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

  it("identifies the configured search provider without requiring AgentSearch", () => {
    renderChat([], { webSearchAvailable: true, webSearchProvider: "tavily" });
    expect(screen.getByRole("button", { name: "联网搜索" })).toHaveAttribute("title", "使用 Tavily 搜索公开信息");
    cleanup();
    renderChat([], { webSearchAvailable: false });
    expect(screen.getByRole("button", { name: "联网搜索" })).toHaveAttribute("title", "开启后请读取能力并配置搜索服务");
  });

  it("groups search categories with web search and sends the topic and source preference", async () => {
    const props = renderChat([], { webSearchAvailable: true });

    expect(screen.queryByLabelText("搜索类别")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "联网搜索" }));

    const mode = screen.getByRole("button", { name: "搜索类别" });
    expect(mode.closest(".composer-web-search")).toContainElement(screen.getByRole("button", { name: "联网搜索" }));
    expect(mode).toHaveTextContent("自动");
    fireEvent.click(mode);
    fireEvent.click(screen.getByRole("radio", { name: /新闻/ }));
    expect(mode).toHaveTextContent("新闻");
    fireEvent.click(mode);
    fireEvent.click(screen.getByRole("button", { name: "搜索设置" }));
    fireEvent.click(screen.getByRole("radio", { name: /优先技术资料/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "查一下技术文档" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(props.onSend).toHaveBeenCalledWith("查一下技术文档", [], [], true, "news", "technical"));
  });

  it("shows saved resume and analysis as attached composer context", () => {
    const onOpenLibrary = vi.fn();
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
          onOpenLibrary,
          sessionContext: { sourceLabel: "resume.pdf", analysisLabel: "示例公司 · 后端" }
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
    expect(onOpenLibrary).toHaveBeenCalledOnce();
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
    expect(document.querySelector(".message-run-result")).not.toBeInTheDocument();
    expect(screen.getByLabelText("输出结果")).toHaveTextContent("你指的是哪家公司？");

    fireEvent.click(screen.getByRole("button", { name: "字节跳动" }));
    expect(onSend).toHaveBeenCalledWith("按字节跳动继续", [], [], false, "auto", "none");
    expect(onSuggestedAction).not.toHaveBeenCalled();
  });

  it("opens recorded process summaries inline without offering an empty source panel", () => {
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

    expect(screen.queryByRole("button", { name: "查看过程，打开研究详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "来源详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "来源详情" })).not.toBeInTheDocument();
    expect(screen.getByText("先确认项目范围，再追问取舍。")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
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
                tool_name: "search_public_web",
                status: "running",
                message: "正在检索：腾讯科技",
                data: { arguments: { company_name: "腾讯科技" } }
              }
            ]
          }
        }
      }
    ], { chatBusy: true });

    expect(screen.getAllByText("正在检索公开资料")).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: "收起思考与执行过程" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const body = screen.getByRole("region", { name: "思考与执行过程" });
    expect(body).not.toHaveTextContent("已识别为公司公开信息研究，需要先规划并限制可用工具");
    expect(body).toHaveTextContent("已规划 1 个步骤：核验腾讯科技公开信息");
    expect(body).toHaveTextContent("腾讯科技");
    expect(body.closest(".chat-composer")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "来源详情" })).not.toBeInTheDocument();
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

    expect(screen.getAllByText("正在整理要点").length).toBeGreaterThan(0);
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
              data: { missing_tools: ["search_public_web"] }
            }]
          }
        }
      }
    ], { chatBusy: true });

    expect(screen.getAllByText("正在补齐必要步骤")).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: "收起思考与执行过程" });
    expect(toggle).not.toHaveTextContent("search_public_web");
    expect(screen.getByRole("region", { name: "思考与执行过程" }))
      .toHaveTextContent("必要步骤尚未完成，正在继续执行");
  });

  it("shows loop correction without exposing the tool fingerprint", () => {
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
            rounds: 2,
            status: "done",
            events: [{
              round: 2,
              tool_call_id: "research-repeat",
              tool_name: "agent_loop_guard",
              status: "running",
              message: "已跳过重复工具调用，正在推进下一步",
              data: { tool_name: "search_public_web", fingerprint: "opaque-secret" }
            }]
          }
        }
      }
    ], { chatBusy: true });

    expect(screen.getAllByText("正在纠正重复步骤")).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: "收起思考与执行过程" });
    expect(toggle).not.toHaveTextContent("opaque-secret");
    expect(screen.getByRole("region", { name: "思考与执行过程" }))
      .toHaveTextContent("已跳过重复工具调用，正在推进下一步");
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
              tool_name: "search_public_web",
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

    fireEvent.click(screen.getByRole("button", { name: "展开思考与执行过程" }));
    expect(screen.queryByText(/已识别为/)).not.toBeInTheDocument();
    expect(screen.getByText("已找到并读取 2 条公开公司资料，可生成带来源的公司研究报告")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "查看全部 2 个来源" }));
    const sourcePanel = screen.getByRole("complementary", { name: "来源详情" });
    expect(sourcePanel).not.toHaveTextContent("已找到并读取 2 条公开公司资料，可生成带来源的公司研究报告");
    expect(screen.getByText("2 个来源")).toBeVisible();
    expect(screen.getByRole("button", { name: "来源 1：天眼查" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "来源 2：官网" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /打开原网页/ })).toHaveAttribute("href", "https://www.tianyancha.com/company/1");
  });

  it("shows a specific thinking placeholder while waiting for the first assistant token", async () => {
    const props = renderChat([message], { chatBusy: true });

    expect(screen.getAllByText("正在整理要点")).toHaveLength(1);
    const process = screen.getByRole("region", { name: "思考与执行过程" });
    expect(process.closest(".chat-thread")).not.toBeNull();
    expect(process.closest(".chat-composer")).toBeNull();
    expect(props.view.container.querySelectorAll(".message.assistant")).toHaveLength(1);
    expect(props.view.container.querySelector(".chat-composer .run-process")).not.toBeInTheDocument();
    expect(props.view.container.querySelector(".chat-run-status")).not.toBeInTheDocument();
    expect(screen.getByText("等待模型响应…")).toBeVisible();
    expect(screen.queryByText("正在思考")).not.toBeInTheDocument();
    props.view.rerender(<ChatWorkspace {...props} messages={[message, assistantMessage("", -1)]} />);
    await waitFor(() => expect(screen.getAllByRole("region", { name: "思考与执行过程" })).toHaveLength(1));
    expect(props.view.container.querySelectorAll(".message.assistant")).toHaveLength(1);
    expect(props.view.container.querySelector(".chat-composer .run-process")).not.toBeInTheDocument();
  });

  it("does not append a second placeholder after the terminal assistant arrives while busy clears", () => {
    const agent: AgentRunResult = {
      provider: "test", platform: "local", rounds: 1, status: "done", duration_ms: 3_000,
      events: [{ round: 1, tool_call_id: "thought-1", tool_name: "agent_thinking", status: "done", message: "已核对来源并整理结论。" }]
    };
    const props = renderChat([message, { ...assistantMessage("最终回答"), payload: { agent } }], { chatBusy: true });
    expect(screen.getAllByRole("region", { name: "思考与执行过程" })).toHaveLength(1);
    expect(props.view.container.querySelectorAll(".message.assistant")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "展开思考与执行过程" })).toHaveTextContent("用时 3s");
    expect(screen.queryByText("等待模型响应…")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("最终回答")).toBeVisible();
    expect(props.view.container.querySelector(".run-process .spinning")).not.toBeInTheDocument();
  });

  it("shows the current executing task once inside the message process", () => {
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
                tool_name: "search_public_web",
                status: "running",
                message: "正在执行 search_public_web"
              }
            ],
            plan: {
              goal: "核验公司",
              route: "company_research",
              requires_confirmation: false,
              steps: [{
                id: "s1",
                title: "搜索公司资料",
                tool_name: "search_public_web",
                risk: "read_only",
                status: "running"
              }]
            }
          }
        }
      }
    ], { chatBusy: true });

    const toggle = screen.getByRole("button", { name: "收起思考与执行过程" });
    expect(screen.getAllByText("正在检索公开资料")).toHaveLength(1);
    expect(screen.getAllByText(/正在进行：搜索公司资料/)).toHaveLength(1);
    expect(toggle).not.toHaveTextContent("搜索公司资料");
    expect(toggle).not.toHaveTextContent(thoughtBody);
    expect(screen.getByText(thoughtBody)).toBeVisible();
    expect(toggle.closest(".chat-composer")).toBeNull();
  });

  it("uses the latest tool event message once in the live activity", () => {
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
              tool_name: "search_library",
              status: "running",
              message: "正在从简历中定位项目证据"
            }]
          }
        }
      }
    ], { chatBusy: true });

    expect(screen.getAllByText("正在检索资料")).toHaveLength(1);
    expect(screen.getAllByText("正在从简历中定位项目证据")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "收起思考与执行过程" })).not.toHaveTextContent("正在从简历中定位项目证据");
  });

  it("shows the returned process summary in the dialogue without an empty source panel", () => {
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

    expect(screen.queryByRole("button", { name: "查看过程，打开研究详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "来源详情" })).not.toBeInTheDocument();
    expect(screen.getByText(thoughtBody)).toBeVisible();
    expect(screen.getByText(thoughtBody).closest(".run-process")).not.toBeNull();
  });

  it("renders in-text source links as numbered citation previews", async () => {
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

    const viewport = screen.getByRole("log");
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1500 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 300 });
    viewport.scrollTop = 217;
    fireEvent.scroll(viewport);
    fireEvent.click(citation);
    expect(screen.getByRole("complementary", { name: "来源详情" })).toHaveTextContent("腾讯科技（深圳）有限公司");
    expect(screen.getByRole("link", { name: "打开原网页" })).toHaveAttribute("target", "_blank");
    viewport.scrollTop = 0;
    fireEvent.click(within(screen.getByRole("complementary", { name: "来源详情" })).getByRole("button", { name: "关闭来源详情" }));
    await waitFor(() => expect(citation).toHaveFocus());
    await waitFor(() => expect(viewport.scrollTop).toBe(217));
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
    const panel = screen.getByRole("complementary", { name: "来源详情" });
    expect(panel).toHaveTextContent("asyncio 用于编写并发代码");
    expect(screen.getByRole("link", { name: /打开原网页/ })).toHaveAttribute("href", "https://docs.python.org/3/library/asyncio.html");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "来源详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "来源详情" })).toHaveAttribute("aria-expanded", "false");
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

  it("keeps user copy and edit under the cue bubble", () => {
    renderChat();

    const bubble = document.querySelector(".message.user .message-dialog");
    const copy = screen.getByLabelText("复制消息");
    const edit = screen.getByLabelText("编辑消息");
    expect(bubble).toHaveTextContent("围绕一个项目追问我");
    expect(bubble?.contains(copy)).toBe(false);
    expect(copy.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

 it("keeps the popup welcome in the message area above the composer", () => {
   renderChat([], { density: "dock" });
   const welcome = screen.getByRole("heading", { name: "有什么可以帮你？" });
   expect(welcome.closest(".chat-thread")).not.toBeNull();
   expect(welcome.closest(".chat-composer")).toBeNull();
   expect(screen.getByRole("textbox", { name: "输入消息" })).toBeInTheDocument();
 });
