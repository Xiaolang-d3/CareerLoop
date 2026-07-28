import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type RefObject } from "react";
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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { XMarkdown } from "@ant-design/x-markdown";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  ChevronDown,
  FileText,
  ImagePlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  SquareCheck,
  Sparkles,
  Square,
  TriangleAlert,
  UserRound,
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

type ChatWorkspaceProps = {
  messages: ChatMessage[];
  hiddenMessageCount: number;
  chatBusy: boolean;
  currentConversationId: number | null;
  waitingForUser: boolean;
  latestAgent?: AgentRunResult;
  taskCancelBusy: boolean;
  retryDraft: ChatRetryDraft | null;
  chatEndRef: RefObject<HTMLDivElement | null>;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  onLoadMore: () => void;
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
};

function formatDate(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

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
  if (!failed && !waiting && !cancelled) return null;
  return (
    <div className={`agent-result-note ${cancelled ? "cancelled" : failed ? "failed" : "waiting"}`}>
      {failed || waiting ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}
      <span>{cancelled ? "任务已结束" : failed ? "执行已终止，可以修复后重试" : waitingForManualImport ? "等待你手动导入岗位" : "已暂停，等待你的操作"}</span>
    </div>
  );
}

function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="message-markdown">
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

function ThinkingProcess({ content, currentNode }: { content: string; currentNode: string }) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const frame = window.requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content, expanded]);

  return (
    <section className={`thinking-process ${expanded ? "expanded" : ""} streaming`}>
      <button
        className="thinking-process-header"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="thinking-process-icon">
          <LoaderCircle size={14} />
        </span>
        <strong>{currentNode}</strong>
        <ChevronDown className="thinking-process-chevron" size={14} />
      </button>
      <div className="thinking-process-collapse" aria-hidden={!expanded}>
        <div className="thinking-process-scroll" ref={scrollRef}>
          {content ? (
            <XMarkdown
              content={content}
              streaming={{
                hasNextChunk: true,
                enableAnimation: true,
                animationConfig: { fadeDuration: 180, easing: "ease-out" },
                tail: false
              }}
            />
          ) : (
            <p className="thinking-process-placeholder">正在分析当前请求…</p>
          )}
        </div>
      </div>
    </section>
  );
}

function EditMessageComposer() {
  return (
    <MessagePrimitive.Root className="message user message-editing">
      <span className="avatar"><UserRound size={17} /></span>
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

type WebSource = {
  title: string;
  url: string;
  domain?: string;
};

function WebSourcesPanel({ sources }: { sources: WebSource[] }) {
  const [expanded, setExpanded] = useState(true);
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
  const liveEvents = chatBusy && source.id < 0
    ? source.payload?.agent?.events.filter((event) => event.tool_name !== "agent_thinking") ?? []
    : [];
  const currentNode = [...liveEvents].reverse().find((event) => event.status === "running")?.message
    || (thoughtEvent?.status === "running" ? "正在分析" : "正在生成回复");
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
      <span className="avatar">{source.role === "user" ? <UserRound size={17} /> : <Sparkles size={17} />}</span>
      <div className="message-content">
        <div className="message-meta">
          <strong>{source.role === "user" ? "你" : "BossCopilot"}</strong>
          <time>{formatDate(source.created_at)}</time>
        </div>
        {source.role === "assistant" ? (
          <>
            {isActiveAssistant ? (
              <ThinkingProcess content={thoughtSummary || ""} currentNode={currentNode} />
            ) : null}
            <WebSourcesPanel sources={webSources} />
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
          </>
        ) : (
          <>
            <p>{source.content}</p>
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
  visionAttachmentIds: string[];
  onUpload: (file?: File) => Promise<void>;
  onRemovePendingAttachment: (attachmentId: string) => Promise<void>;
  onToggleVisionAttachment: (attachmentId: string) => void;
  webSearchSelected: boolean;
  onToggleWebSearch: () => void;
};

function ChatWorkspaceContent(props: ChatWorkspaceContentProps) {
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false);

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
      props.onAttachmentInvalid("仅支持岗位截图（PNG、JPG、WEBP）或简历（PDF、DOCX、TXT、MD）。");
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

  return (
    <section className="chat-workspace">
      <ThreadPrimitive.Root className="chat-main">
        <ThreadPrimitive.Viewport className="chat-thread" role="log" aria-live="polite" aria-relevant="additions">
          {props.hiddenMessageCount > 0 ? (
            <button className="load-history-button" onClick={props.onLoadMore}>
              查看更早消息 · 还有 {props.hiddenMessageCount} 条
            </button>
          ) : null}

          {props.messages.length === 0 ? (
            <div className="chat-welcome">
              <h2>今天想聊点什么？</h2>
              <p>可以聊经历、岗位、简历，或下一步计划。</p>
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
                  {props.latestAgent?.error?.code === "manual_job_import_required" ? "手动导入岗位" : "继续处理"}<ArrowUpRight size={14} />
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
                placeholder="输入消息…"
                submitMode="enter"
              />
              <div className="composer-bottom-row">
                <div className="composer-shortcuts" aria-label="添加求职资料">
                  <button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={props.attachmentBusy} title="上传岗位截图或简历">
                    {props.attachmentBusy ? <LoaderCircle className="spinning" size={15} /> : <ImagePlus size={15} />}
                    <span>{props.attachmentBusy ? "处理中…" : "上传资料"}</span>
                  </button>
                  <button
                    type="button"
                    className={`${props.webSearchSelected ? "active" : ""} ${!props.webSearchAvailable ? "unavailable" : ""}`.trim()}
                    onClick={props.onToggleWebSearch}
                    disabled={props.chatBusy}
                    aria-pressed={props.webSearchSelected}
                    title={props.webSearchAvailable ? "仅为下一条消息启用公开互联网搜索" : "可以选中；发送后会提示配置 AgentSearch"}
                  >
                    <Search size={15} />
                    <span>联网搜索</span>
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
            {props.pendingAttachments.length ? (
              <div className="composer-attachments" aria-label="待发送附件">
                {props.pendingAttachments.map((attachment) => (
                  <article key={attachment.id}>
                    <span className="composer-attachment-icon">
                      {attachment.kind === "resume" ? <FileText size={15} /> : <ImagePlus size={15} />}
                    </span>
                    <span>
                      <strong>{attachment.original_filename}</strong>
                      <small>
                        {attachment.kind === "resume"
                          ? "已本地解析，将使用脱敏文本"
                          : props.visionAttachmentIds.includes(attachment.id)
                            ? "已授权本轮模型看图，同时使用本地 OCR"
                            : "已本地识别，将使用识别文本"}
                      </small>
                    </span>
                    {attachment.kind === "job_screenshot" ? (
                      <button
                        type="button"
                        className={props.visionAttachmentIds.includes(attachment.id) ? "vision-toggle active" : "vision-toggle"}
                        onClick={() => props.onToggleVisionAttachment(attachment.id)}
                        disabled={!props.attachmentConfig?.vision_ready}
                        aria-pressed={props.visionAttachmentIds.includes(attachment.id)}
                        title={props.attachmentConfig?.vision_ready ? "仅本轮把这张岗位截图通过短期链接发给模型识别" : "图片直传未启用：需要 MinIO、公网 HTTPS endpoint 和 ATTACHMENT_VISION_ENABLED=true"}
                      >
                        {props.visionAttachmentIds.includes(attachment.id) ? <SquareCheck size={14} /> : <ShieldCheck size={14} />}
                        <span>模型看图</span>
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void props.onRemovePendingAttachment(attachment.id)} aria-label={`移除 ${attachment.original_filename}`}>
                      <X size={14} />
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
            {isDraggingAttachment ? <div className="composer-drop-hint" aria-live="polite">松开即可本地解析岗位截图或简历</div> : null}
          </div>
        </div>
      </ThreadPrimitive.Root>
    </section>
  );
}

export function ChatWorkspace(props: ChatWorkspaceProps) {
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [visionAttachmentIds, setVisionAttachmentIds] = useState<string[]>([]);
  const [webSearchSelected, setWebSearchSelected] = useState(false);

  useEffect(() => {
    setPendingAttachments([]);
    setVisionAttachmentIds([]);
    setWebSearchSelected(false);
  }, [props.currentConversationId]);

  const uploadAttachment = useCallback(async (file?: File) => {
    if (!file) return;
    const attachment = await props.onUploadAttachment(file);
    setPendingAttachments((current) => [...current, attachment]);
  }, [props]);

  const removePendingAttachment = useCallback(async (attachmentId: string) => {
    await props.onRemoveAttachment(attachmentId);
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    setVisionAttachmentIds((current) => current.filter((id) => id !== attachmentId));
  }, [props]);

  const toggleVisionAttachment = useCallback((attachmentId: string) => {
    setVisionAttachmentIds((current) => current.includes(attachmentId)
      ? current.filter((id) => id !== attachmentId)
      : [...current, attachmentId]);
  }, []);

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
        visionAttachmentIds={visionAttachmentIds}
        onUpload={uploadAttachment}
        onRemovePendingAttachment={removePendingAttachment}
        onToggleVisionAttachment={toggleVisionAttachment}
        webSearchSelected={webSearchSelected}
        onToggleWebSearch={() => setWebSearchSelected((selected) => !selected)}
      />
    </AssistantRuntimeProvider>
  );
}
