import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type RefObject } from "react";
import type { Conversation } from "../types";
import { ConversationHistoryPanel } from "./ConversationHistoryPanel";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AppendMessage,
  type MessageState,
  type ThreadMessageLike,
  useExternalStoreRuntime
} from "@assistant-ui/react";
import { useAui } from "@assistant-ui/store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  ChevronDown,
  FileText,
  History,
  ImagePlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
  X
} from "lucide-react";

export type AgentRunResult = {
  provider: string;
  platform: string;
  rounds: number;
  status: "done" | "failed" | "waiting_user" | "cancelled";
  error?: { code: string; message: string; retryable: boolean } | null;
  events: Array<{
    round: number;
    tool_call_id: string;
    tool_name: string;
    status: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
  plan?: {
    goal: string;
    route: string;
    requires_confirmation: boolean;
    steps: Array<{
      id: string;
      title: string;
      tool_name: string;
      risk: "read_only" | "analysis" | "local_write" | "user_input";
      status: "pending" | "running" | "done" | "failed" | "blocked";
    }>;
  } | null;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  payload?: { workflow?: unknown; agent?: AgentRunResult; attachments?: ChatAttachment[] };
};

export type ChatAttachment = {
  id: string;
  kind: "job_screenshot" | "resume";
  original_filename: string;
  parse_status: "pending" | "parsed" | "failed";
  vision_status?: "not_requested" | "consented" | "failed";
  parsed_text?: string;
  redacted_text?: string;
  metadata?: { character_count?: number; privacy_findings?: Array<{ entity_type: string; preview: string }> };
};

export type AttachmentConfig = {
  storage: "local" | "minio";
  vision_enabled: boolean;
  vision_ready: boolean;
  vision_url_ttl_seconds: number;
  requires_public_endpoint: boolean;
  checks?: Array<{
    key: string;
    label: string;
    status: "ok" | "warning" | "disabled";
    message: string;
  }>;
};

export type ChatRetryDraft = {
  content: string;
  attachmentIds: string[];
  visionAttachmentIds: string[];
  webSearch: boolean;
};

export type ChatSessionContext = {
  resumeLabel?: string | null;
  analysisLabel?: string | null;
};

const STARTER_PROMPTS = [
  { draft: "帮我梳理这个项目的亮点。项目是：", title: "梳理项目表达", description: "把经历变成可讲的亮点" },
  { draft: "围绕这个项目追问我。项目是：", title: "练习项目追问", description: "从细节到取舍反复演练" },
  { draft: "帮我复盘刚结束的这场面试。岗位和主要问题是：", title: "复盘一次面试", description: "把反馈变成下一步准备" }
];

type ChatWorkspaceProps = {
  conversationTitle?: string;
  messages: ChatMessage[];
  hiddenMessageCount: number;
  chatBusy: boolean;
  currentConversationId: number | null;
  conversations: Conversation[];
  conversationBusy: boolean;
  waitingForUser: boolean;
  latestAgent?: AgentRunResult;
  taskCancelBusy: boolean;
  retryDraft: ChatRetryDraft | null;
  chatEndRef: RefObject<HTMLDivElement | null>;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  onLoadMore: () => void;
  onSelectConversation: (conversationId: number) => void;
  onCreateConversation: () => void;
  onRenameConversation: (conversation: Conversation) => void;
  onArchiveConversation: (conversation: Conversation) => void;
  onRemoveConversation: (conversation: Conversation) => void;
  attachmentBusy: boolean;
  attachmentConfig: AttachmentConfig | null;
  webSearchAvailable: boolean;
  onUploadAttachment: (file: File) => Promise<ChatAttachment>;
  onRemoveAttachment: (attachmentId: string) => Promise<void>;
  onAttachmentInvalid: (message: string) => void;
  onSuggestedAction: () => void;
  onCancelTask: () => void;
  onSend: (content: string, attachmentIds?: string[], visionAttachmentIds?: string[], webSearch?: boolean) => Promise<void>;
  onStop: () => Promise<void>;
  onEdit: (userMessageId: number, content: string) => Promise<void>;
  onRegenerate: (userMessageId: number) => Promise<void>;
  sessionContext?: ChatSessionContext;
};

function resultOnlyContent(content: string, hasThoughtSummary: boolean): string {
  if (!hasThoughtSummary) return content;
  const answerMarker = content.indexOf("可以。");
  if (/^(?:我先|我会先|我将先)/.test(content) && answerMarker > 0 && answerMarker < 220) {
    return content.slice(answerMarker).trim();
  }
  const withoutProcessLead = content.replace(
    /^(?:我先|我会先|我将先)(?:读取|检查|确认|分析|检索|查看|整理|调用)[^。！？]*[。！？]\s*/,
    ""
  ).trim();
  return withoutProcessLead || content;
}

function textFromAppendMessage(message: AppendMessage): string {
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function AgentResultNote({ run }: { run?: AgentRunResult }) {
  if (!run?.events.length) return null;
  const failed = run.status === "failed" || run.events.some((event) => event.status === "failed");
  const waiting = run.status === "waiting_user";
  const cancelled = run.status === "cancelled";
  const waitingForManualImport = run.error?.code === "manual_job_import_required";
  const profileRequired = run.error?.code === "profile_required";
  if (!failed && !waiting && !cancelled) return null;
  const failureHint = profileRequired
    ? "说“开始画像访谈”，我会创建画像并开始补充信息。"
    : run.error?.retryable === false
      ? "请先检查设置或输入后再继续。"
      : "可以修改输入或直接点击下方重试。";
  return (
    <div className={`agent-result-note ${cancelled ? "cancelled" : failed ? "failed" : "waiting"}`}>
      {failed || waiting ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}
      <span>
        <strong>{cancelled ? "任务已结束" : failed ? (profileRequired ? "还需要先建立画像" : "执行已终止") : waitingForManualImport ? "等待你补充资料" : "已暂停，等待你的操作"}</strong>
        {run.error?.message ? <small>{run.error.message}</small> : null}
        {failed ? <small>{failureHint}</small> : null}
      </span>
    </div>
  );
}

function MarkdownContent({ children }: { children: string }) {
  const projectAnalysisAnswer = /(项目(?:经历|经验|解析|背景|亮点)|技术深度|证据完整度|简历版|面试版)/.test(children);
  return (
    <div className={`message-markdown ${projectAnalysisAnswer ? "project-analysis-answer" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noreferrer">{label}</a>
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function EditMessageComposer() {
  return (
    <MessagePrimitive.Root className="message user message-editing">
      <div className="message-content">
        <div className="message-meta"><strong>编辑消息</strong><span>保存后将从这里重新生成</span></div>
        <ComposerPrimitive.Root className="message-edit-composer">
          <ComposerPrimitive.Input rows={2} maxLength={1000} aria-label="编辑消息" autoFocus />
          <div className="message-edit-actions">
            <ComposerPrimitive.Cancel><X size={12} />取消</ComposerPrimitive.Cancel>
            <ComposerPrimitive.Send><Check size={12} />保存并重新生成</ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

function ThoughtProcess({ summary, streaming }: { summary?: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!summary && !streaming) return null;
  return (
    <section className={`thinking-process ${expanded ? "expanded" : ""} ${streaming ? "streaming" : "complete"}`} aria-label="思考过程">
      <button
        type="button"
        className="thinking-process-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="thinking-process-icon"><Sparkles size={12} /></span>
        <strong>{streaming ? "正在思考" : "思考过程"}</strong>
        <ChevronDown className="thinking-process-chevron" size={14} />
      </button>
      {summary ? (
        <div className="thinking-process-collapse">
          <div className="thinking-process-scroll"><p>{summary}</p></div>
        </div>
      ) : null}
    </section>
  );
}

function ChatContextChips({
  context,
  onFill
}: {
  context?: ChatSessionContext;
  onFill: (draft: string) => void;
}) {
  const resumeLabel = context?.resumeLabel?.trim();
  const analysisLabel = context?.analysisLabel?.trim();
  if (!resumeLabel && !analysisLabel) return null;
  return (
    <div className="chat-context-strip" aria-label="当前可用上下文">
      {resumeLabel ? (
        <button type="button" className="chat-context-chip" onClick={() => onFill(`结合我已经保存的简历（${resumeLabel}），`)}>
          <FileText size={12} />
          <span>简历 · {resumeLabel}</span>
        </button>
      ) : null}
      {analysisLabel ? (
        <button type="button" className="chat-context-chip" onClick={() => onFill(`结合刚才对「${analysisLabel}」的分析，继续帮我准备面试。我想先练：`)}>
          <Search size={12} />
          <span>分析 · {analysisLabel}</span>
        </button>
      ) : null}
    </div>
  );
}

type WebSource = {
  title: string;
  url: string;
  domain?: string;
};

function WebSourcesPanel({ sources }: { sources: WebSource[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!sources.length) return null;
  return (
    <section className={`web-sources-panel ${expanded ? "expanded" : ""}`} aria-label="联网搜索来源">
      <button
        type="button"
        className="web-sources-heading"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronDown size={15} />
        <Search size={16} />
        <strong>已搜索 {sources.length} 个网站</strong>
      </button>
      {expanded ? (
        <div className="web-source-grid">
          {sources.map((source, index) => (
            <a
              key={`${source.url}-${index}`}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={source.title}
            >
              <span className="web-source-icon">{(source.domain || source.title).slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{source.title}</strong>
                <small>{source.domain || source.url.replace(/^https?:\/\//, "").split("/")[0]}</small>
              </span>
              <ArrowUpRight size={13} />
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function UserMessageContent({ content }: { content: string }) {
  const hasJobContext = /以下内容来自我保存的岗位项目|岗位项目上下文|目标岗位[:：]|岗位描述[:：]/.test(content);
  const collapsible = content.length > 600 || hasJobContext;
  const [expanded, setExpanded] = useState(false);
  if (!collapsible) return <p>{content}</p>;
  const preview = content.replace(/\s+/g, " ").trim().slice(0, 180);
  return (
    <section className={`user-message-summary ${expanded ? "expanded" : ""}`}>
      <div className="user-message-summary-meta">
        <span>{hasJobContext ? "岗位项目上下文" : "长请求"}</span>
        <em>{content.length.toLocaleString()} 字</em>
      </div>
      <p>{expanded ? content : `${preview}${content.length > 180 ? "…" : ""}`}</p>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? "收起完整请求" : "展开完整请求"}<ChevronDown size={13} />
      </button>
    </section>
  );
}

function ChatTurn({ state, chatBusy }: { state: MessageState; chatBusy: boolean }) {
  const source = state.metadata.custom.source as ChatMessage | undefined;
  if (!source) return null;
  const isCopied = "isCopied" in state && Boolean(state.isCopied);
  const thoughtEvent = source.payload?.agent?.events.find(
    (event) => event.tool_name === "agent_thinking"
  );
  const thoughtSummary = thoughtEvent?.message;
  const isActiveAssistant = chatBusy && source.id < 0;
  const resultContent = resultOnlyContent(source.content, Boolean(thoughtSummary));
  const failed = source.payload?.agent?.status === "failed";
  const webSources = (source.payload?.agent?.events
    .filter((event) => ["search_public_web", "research_company"].includes(event.tool_name))
    .flatMap((event) => Array.isArray(event.data?.sources) ? event.data.sources : [])
    .filter((item): item is WebSource => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<WebSource>;
      return typeof candidate.title === "string"
        && typeof candidate.url === "string"
        && /^https?:\/\//.test(candidate.url);
    }) ?? [])
    .filter((item, index, all) => all.findIndex((candidate) => candidate.url === item.url) === index);

  return (
    <MessagePrimitive.Root className={`message ${source.role}`}>
      <div className="message-content">
        {source.role === "assistant" ? (
          <>
            <ThoughtProcess summary={thoughtSummary} streaming={isActiveAssistant} />
            <section className="message-result" aria-label="输出结果">
              <MarkdownContent>{resultContent}</MarkdownContent>
              <AgentResultNote run={source.payload?.agent} />
              <ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
                <ActionBarPrimitive.Copy aria-label="复制回答">
                  {isCopied ? <Check size={12} /> : <Copy size={12} />}
                  {isCopied ? "已复制" : "复制"}
                </ActionBarPrimitive.Copy>
                <ActionBarPrimitive.Reload aria-label={failed ? "重试回答" : "重新生成回答"}>
                  <RefreshCw size={12} />{failed ? "重试" : "重新生成"}
                </ActionBarPrimitive.Reload>
              </ActionBarPrimitive.Root>
            </section>
            <WebSourcesPanel sources={webSources} />
          </>
        ) : (
          <>
            <UserMessageContent content={source.content} />
            {source.payload?.attachments?.length ? (
              <div className="message-attachments" aria-label="本轮已附加资料">
                {source.payload.attachments.map((attachment) => (
                  <span key={attachment.id}>
                    {attachment.kind === "resume" ? <FileText size={12} /> : <ImagePlus size={12} />}
                    {attachment.original_filename}
                    {attachment.vision_status === "consented" ? <em>模型看图</em> : null}
                  </span>
                ))}
              </div>
            ) : null}
            <ActionBarPrimitive.Root className="message-actions user-message-actions" hideWhenRunning>
              <ActionBarPrimitive.Copy aria-label="复制消息">
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
                {isCopied ? "已复制" : "复制"}
              </ActionBarPrimitive.Copy>
              <ActionBarPrimitive.Edit aria-label="编辑消息"><Pencil size={12} />编辑</ActionBarPrimitive.Edit>
            </ActionBarPrimitive.Root>
          </>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

type ChatWorkspaceContentProps = ChatWorkspaceProps & {
  pendingAttachments: ChatAttachment[];
  previewUrls: Record<string, string>;
  uploadingPreview: { filename: string; url: string } | null;
  onUpload: (file?: File) => Promise<void>;
  onRemovePendingAttachment: (attachmentId: string) => Promise<void>;
  webSearchSelected: boolean;
  onToggleWebSearch: () => void;
};

function ChatWorkspaceContent(props: ChatWorkspaceContentProps) {
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const aui = useAui();
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false);
  const [expandedPreview, setExpandedPreview] = useState<{ filename: string; url: string } | null>(null);
  const [conversationListOpen, setConversationListOpen] = useState(false);

  function fillComposer(draft: string) {
    aui.composer().setText(draft);
    window.requestAnimationFrame(() => {
      const input = props.chatInputRef.current;
      input?.focus();
      const cursor = draft.length;
      input?.setSelectionRange(cursor, cursor);
    });
  }

  useEffect(() => {
    setExpandedPreview(null);
    setConversationListOpen(false);
  }, [props.currentConversationId]);

  useEffect(() => {
    if (!conversationListOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setConversationListOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversationListOpen]);

  async function selectAttachment(file?: File) {
    if (!file || props.attachmentBusy) return;
    const filename = file.name.toLowerCase();
    try {
      if (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/.test(filename)) {
        await props.onUpload(file);
        return;
      }
      if (/\.(pdf|docx|txt|md)$/.test(filename)) {
        await props.onUpload(file);
        return;
      }
      props.onAttachmentInvalid("仅支持图片（PNG、JPG、WEBP）或文档（PDF、DOCX、TXT、MD）。");
    } catch {
      // The parent already exposes the localized upload/parse error to the user.
    }
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    void selectAttachment(event.target.files?.[0]);
    event.currentTarget.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!props.attachmentBusy) setIsDraggingAttachment(true);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingAttachment(false);
    void selectAttachment(event.dataTransfer.files?.[0]);
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardFile = Array.from(event.clipboardData.files)[0];
    if (!clipboardFile || props.attachmentBusy) return;
    const filename = clipboardFile.name.toLowerCase();
    const supported = clipboardFile.type.startsWith("image/") || /\.(pdf|docx|txt|md)$/.test(filename);
    if (!supported) return;
    event.preventDefault();
    const file = clipboardFile.name
      ? clipboardFile
      : new File([clipboardFile], `粘贴的图片.${clipboardFile.type.split("/")[1] || "png"}`, { type: clipboardFile.type });
    void selectAttachment(file);
  }

  return (
    <section className={`chat-workspace ${props.messages.length ? "has-history" : "is-empty"} ${props.chatBusy ? "is-running" : ""}`}>
      <ThreadPrimitive.Root className="chat-main">
        <header className="chat-session-header">
          <h1>{props.conversationTitle || "新对话"}</h1>
          <button
            className="chat-history-toggle"
            type="button"
            onClick={() => setConversationListOpen((open) => !open)}
            aria-label="对话记录"
            aria-expanded={conversationListOpen}
            aria-controls="conversation-history-drawer"
          >
            <History size={16} />
          </button>
          {props.messages.length ? <ChatContextChips context={props.sessionContext} onFill={fillComposer} /> : null}
        </header>
        <ThreadPrimitive.Viewport className="chat-thread" role="log" aria-live="polite" aria-relevant="additions">
          {props.hiddenMessageCount > 0 ? (
            <button className="load-history-button" onClick={props.onLoadMore}>
              查看更早消息 · 还有 {props.hiddenMessageCount} 条
            </button>
          ) : null}

          {props.messages.length === 0 ? (
            <div className="chat-welcome">
              <h2>从一个具体问题开始。</h2>
              <p>围绕真实经历练表达、补知识点，或复盘一次面试。</p>
              <ChatContextChips context={props.sessionContext} onFill={fillComposer} />
              <div className="starter-prompt-list" aria-label="快捷开始">
                {STARTER_PROMPTS.map(({ draft, title, description }) => (
                  <button key={draft} type="button" onClick={() => fillComposer(draft)}>
                    <strong>{title}</strong><small>{description}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ThreadPrimitive.Messages>
              {({ message }) => message.composer.isEditing
                ? <EditMessageComposer />
                : <ChatTurn state={message} chatBusy={props.chatBusy} />}
            </ThreadPrimitive.Messages>
          )}

          {props.chatBusy && !props.messages.some((message) => message.id < 0 && message.role === "assistant") ? (
            <article className="message assistant is-loading">
              <div className="message-content thinking-state">
                <div className="thinking-indicator">
                  <LoaderCircle size={14} />
                  <span>正在思考</span>
                  <span className="thinking-dots"><i /><i /><i /></span>
                </div>
              </div>
            </article>
          ) : null}
          <div ref={props.chatEndRef} />
        </ThreadPrimitive.Viewport>

        <div className="chat-composer">
          {props.waitingForUser ? (
            <section className="task-prompt attention" aria-label="当前任务提醒">
              <span className="task-prompt-icon"><TriangleAlert size={16} /></span>
              <div className="task-prompt-copy">
                <span>需要你完成一步</span>
                <strong>当前任务正在等待你的确认</strong>
                <small>{props.latestAgent?.error?.message ?? "完成提示步骤后，Agent 会继续处理。"}</small>
              </div>
              <div className="task-prompt-actions">
                <button className="task-action-button" onClick={props.onSuggestedAction}>
                  继续处理<ArrowUpRight size={14} />
                </button>
                <button className="task-cancel-button" onClick={props.onCancelTask} disabled={props.taskCancelBusy}>
                  {props.taskCancelBusy ? "结束中…" : "结束任务"}
                </button>
              </div>
            </section>
          ) : null}

          {props.retryDraft && !props.chatBusy ? (
            <section className="chat-retry-prompt" aria-label="消息发送失败">
              <TriangleAlert size={14} /><span>上一条消息未发送成功</span>
              <button onClick={() => {
                const draft = props.retryDraft;
                if (draft) void props.onSend(draft.content, draft.attachmentIds, draft.visionAttachmentIds, draft.webSearch);
              }}><RefreshCw size={12} />重试</button>
            </section>
          ) : null}

          <div
            className={`composer-dropzone ${isDraggingAttachment ? "is-dragging" : ""}`}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDraggingAttachment(false); }}
            onDrop={handleDrop}
          >
            <input
              ref={attachmentInputRef}
              className="composer-file-input"
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp,application/pdf"
              onChange={handleAttachmentChange}
            />
            <ComposerPrimitive.Root className="composer-input">
              <ComposerPrimitive.Input
                ref={props.chatInputRef}
                rows={1}
                maxLength={1000}
                aria-label="输入消息"
                placeholder="输入一个项目、知识点，或一场需要复盘的面试…"
                submitMode="enter"
                onPaste={handleComposerPaste}
              />
              <div className="composer-bottom-row">
              <div className="composer-shortcuts" aria-label="添加资料">
                  <button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={props.attachmentBusy} title="上传图片或文档，也可直接粘贴图片">
                    {props.attachmentBusy ? <LoaderCircle className="spinning" size={15} /> : <ImagePlus size={15} />}
                    <span>{props.attachmentBusy ? "处理中…" : "资料"}</span>
                  </button>
                  <button
                    type="button"
                    className={`web-search-toggle ${props.webSearchSelected ? "active" : ""} ${!props.webSearchAvailable ? "unavailable" : ""}`.trim()}
                    onClick={props.onToggleWebSearch}
                    disabled={props.chatBusy}
                    aria-pressed={props.webSearchSelected}
                    aria-label="联网搜索"
                    title={props.webSearchAvailable ? "为下一条消息补充公开信息" : "可以选中；发送后会提示配置 AgentSearch"}
                  >
                    <Search size={15} />
                    <span>联网</span>
                  </button>
                </div>
                {props.chatBusy ? (
                  <ComposerPrimitive.Cancel className="send-button stop-button" disabled={props.taskCancelBusy}>
                    <Square size={14} fill="currentColor" /><span>停止</span>
                  </ComposerPrimitive.Cancel>
                ) : (
                  <ComposerPrimitive.Send className="send-button">
                    <Send size={16} /><span>发送</span>
                  </ComposerPrimitive.Send>
                )}
              </div>
            </ComposerPrimitive.Root>
            {props.uploadingPreview ? (
              <div className="composer-attachments" aria-label="正在处理的附件">
                <article className="composer-image-attachment uploading">
                  <img className="composer-attachment-preview" src={props.uploadingPreview.url} alt={`${props.uploadingPreview.filename} 预览`} />
                </article>
              </div>
            ) : null}
            {props.pendingAttachments.length ? (
              <div className="composer-attachments" aria-label="待发送附件">
                {props.pendingAttachments.map((attachment) => (
                  <article key={attachment.id} className={attachment.kind === "job_screenshot" ? "composer-image-attachment" : "composer-file-attachment"}>
                    {attachment.kind === "job_screenshot" && props.previewUrls[attachment.id]
                      ? <button
                        type="button"
                        className="composer-attachment-preview-button"
                        onClick={() => setExpandedPreview({ filename: attachment.original_filename, url: props.previewUrls[attachment.id] })}
                        aria-label={`查看 ${attachment.original_filename}`}
                      ><img className="composer-attachment-preview" src={props.previewUrls[attachment.id]} alt={`${attachment.original_filename} 预览`} /></button>
                      : <span className="composer-attachment-icon">
                        {attachment.kind === "resume" ? <FileText size={15} /> : <ImagePlus size={15} />}
                      </span>}
                    {attachment.kind === "resume" ? <span>
                      <strong>{attachment.original_filename}</strong>
                      <small>随本轮消息发送</small>
                    </span> : null}
                    <button className="composer-attachment-remove" type="button" onClick={() => void props.onRemovePendingAttachment(attachment.id)} aria-label={`移除 ${attachment.original_filename}`}>
                      <X size={14} />
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
            {isDraggingAttachment ? <div className="composer-drop-hint" aria-live="polite">松开即可添加图片或文档</div> : null}
          </div>
          {expandedPreview ? (
            <div className="attachment-preview-dialog" role="dialog" aria-modal="true" aria-label={`${expandedPreview.filename} 预览`} onClick={() => setExpandedPreview(null)}>
              <img src={expandedPreview.url} alt={`${expandedPreview.filename} 大图预览`} onClick={(event) => event.stopPropagation()} />
              <button type="button" onClick={() => setExpandedPreview(null)} aria-label="关闭图片预览"><X size={18} /></button>
            </div>
          ) : null}
        </div>
      </ThreadPrimitive.Root>
      <ConversationHistoryPanel
        conversations={props.conversations}
        currentConversationId={props.currentConversationId}
        busy={props.conversationBusy}
        open={conversationListOpen}
        onClose={() => setConversationListOpen(false)}
        onSelect={props.onSelectConversation}
        onCreate={props.onCreateConversation}
        onRename={props.onRenameConversation}
        onArchive={props.onArchiveConversation}
        onRemove={props.onRemoveConversation}
      />
      {conversationListOpen ? <button className="conversation-history-backdrop" type="button" aria-label="关闭对话记录" onClick={() => setConversationListOpen(false)} /> : null}
    </section>
  );
}

export function ChatWorkspace(props: ChatWorkspaceProps) {
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [uploadingPreview, setUploadingPreview] = useState<{ filename: string; url: string } | null>(null);
  const previewUrlsRef = useRef<Record<string, string>>({});
  const [visionAttachmentIds, setVisionAttachmentIds] = useState<string[]>([]);
  const [webSearchSelected, setWebSearchSelected] = useState(false);

  useEffect(() => {
    Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = {};
    setPendingAttachments([]);
    setPreviewUrls({});
    setUploadingPreview(null);
    setVisionAttachmentIds([]);
    setWebSearchSelected(false);
  }, [props.currentConversationId]);

  useEffect(() => () => {
    Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const uploadAttachment = useCallback(async (file?: File) => {
    if (!file) return;
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (previewUrl) setUploadingPreview({ filename: file.name || "粘贴的图片", url: previewUrl });
    try {
      const attachment = await props.onUploadAttachment(file);
      if (previewUrl) {
        previewUrlsRef.current[attachment.id] = previewUrl;
        setPreviewUrls({ ...previewUrlsRef.current });
      }
      setPendingAttachments((current) => [...current, attachment]);
      if (attachment.kind === "job_screenshot") {
        setVisionAttachmentIds((current) => [...current, attachment.id]);
      }
      setUploadingPreview(null);
    } catch (error) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setUploadingPreview(null);
      throw error;
    }
  }, [props]);

  const removePendingAttachment = useCallback(async (attachmentId: string) => {
    await props.onRemoveAttachment(attachmentId);
    const previewUrl = previewUrlsRef.current[attachmentId];
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      delete previewUrlsRef.current[attachmentId];
      setPreviewUrls({ ...previewUrlsRef.current });
    }
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    setVisionAttachmentIds((current) => current.filter((id) => id !== attachmentId));
  }, [props]);

  const convertMessage = useCallback((message: ChatMessage): ThreadMessageLike => ({
    id: String(message.id),
    role: message.role,
    content: [{ type: "text", text: message.content }],
    createdAt: new Date(message.created_at),
    metadata: { custom: { source: message } }
  }), []);

  const runtime = useExternalStoreRuntime({
    messages: props.messages,
    convertMessage,
    isRunning: props.chatBusy,
    isDisabled: !props.currentConversationId,
    onNew: async (message) => {
      const content = textFromAppendMessage(message);
      if (content) {
        await props.onSend(
          content,
          pendingAttachments.map((attachment) => attachment.id),
          visionAttachmentIds,
          webSearchSelected,
        );
        setPendingAttachments([]);
        setVisionAttachmentIds([]);
        setWebSearchSelected(false);
      }
    },
    onEdit: async (message) => {
      const content = textFromAppendMessage(message);
      const sourceId = Number(message.sourceId);
      if (content && Number.isSafeInteger(sourceId)) await props.onEdit(sourceId, content);
    },
    onReload: async (parentId) => {
      const userMessageId = Number(parentId);
      if (Number.isSafeInteger(userMessageId)) await props.onRegenerate(userMessageId);
    },
    onCancel: props.onStop
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatWorkspaceContent
        {...props}
        pendingAttachments={pendingAttachments}
        previewUrls={previewUrls}
        uploadingPreview={uploadingPreview}
        onUpload={uploadAttachment}
        onRemovePendingAttachment={removePendingAttachment}
        webSearchSelected={webSearchSelected}
        onToggleWebSearch={() => setWebSearchSelected((selected) => !selected)}
      />
    </AssistantRuntimeProvider>
  );
}
