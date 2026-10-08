import { useConversationScroll } from "../features/chat/useConversationScroll";
import { RunStatus } from "../features/chat/RunStatus";
import { textFromAppendMessage, WebSource, webSourcesFromAgent, ResearchPanelActionsContext, EditMessageComposer, thinkingHeaderCopy, ComposerClarification, StarterPromptList, ChatContextChips, ResearchPanel, ChatTurn } from "../features/chat/MessagePresentation";

import type { AgentRunResult, ChatMessage, ChatAttachment, WebSearchMode, ChatClarificationOption, ChatClarification, ChatWorkspaceProps } from "../features/chat/types";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";

import { ConversationHistoryPanel } from "./ConversationHistoryPanel";

import "./ChatWorkspace.css";
import "./ChatComposer.css";

import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, type ThreadMessageLike, useExternalStoreRuntime } from "@assistant-ui/react";

import { useAui, useAuiState } from "@assistant-ui/store";

import { ArrowUpRight, FileText, History, ImagePlus, LoaderCircle, PanelRight, Pencil, Plus, RefreshCw, Search, Send, Square, TriangleAlert, X } from "lucide-react";

function asClarificationOption(value: unknown, index: number): ChatClarificationOption | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!label) return null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `opt_${index + 1}`;
  const send = typeof record.send === "string" && record.send.trim() ? record.send.trim() : label;
  return { id, label, send };
}

export function clarificationFromAgent(run?: AgentRunResult): ChatClarification | null {
  if (!run || run.status !== "waiting_user") return null;
  for (const event of [...run.events].reverse()) {
    const raw = event.data?.clarification;
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const question = typeof record.question === "string" ? record.question.trim() : "";
    const options = Array.isArray(record.options)
      ? record.options.flatMap((item, index) => {
        const option = asClarificationOption(item, index);
        return option ? [option] : [];
      })
      : [];
    if (!question && !options.length) continue;
    return { question, options, allowCustom: record.allow_custom !== false };
  }
  return null;
}

type ChatWorkspaceContentProps = ChatWorkspaceProps & {
  pendingAttachments: ChatAttachment[];
  previewUrls: Record<string, string>;
  uploadingPreview: { filename: string; url: string } | null;
  onUpload: (file?: File) => Promise<void>;
  onRemovePendingAttachment: (attachmentId: string) => Promise<void>;
  webSearchSelected: boolean;
  webSearchMode: WebSearchMode;
  onToggleWebSearch: () => void;
  onWebSearchModeChange: (mode: WebSearchMode) => void;
};

function ChatWorkspaceContent(props: ChatWorkspaceContentProps) {
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const researchToggleRef = useRef<HTMLButtonElement>(null);
  const aui = useAui();
  const composerText = useAuiState((state) => state.composer.text);
  const localDrafts = useRef(new Map<number, string>());
  const drafts = props.composerDrafts ?? localDrafts.current;
  useLayoutEffect(() => {
    const id = props.currentConversationId;
    aui.composer().setText(id ? drafts.get(id) ?? "" : "");
    return () => {
      if (!id) return;
      const text = aui.composer().getState().text;
      if (text) drafts.set(id, text);
      else drafts.delete(id);
    };
  }, [aui, drafts, props.currentConversationId]);

  useLayoutEffect(() => {
    const input = props.chatInputRef.current;
    if (!input) return;
    const resize = () => {
      const style = window.getComputedStyle(input);
      const min = Number.parseFloat(style.minHeight) || 52;
      const max = Number.parseFloat(style.maxHeight) || Math.min(240, window.innerHeight * .3);
      input.style.height = "0px";
      const height = Math.max(min, input.scrollHeight);
      input.style.height = `${Math.min(max, height)}px`;
      input.style.overflowY = height > max ? "auto" : "hidden";
    };
    resize();
    let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = input.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(input);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, [composerText, props.chatInputRef]);
  const appliedDraftId = useRef<string | null>(null);
  const placeholderThinking = thinkingHeaderCopy(props.latestAgent, true);
  const generatingReply = props.messages.some((message) => message.id < 0 && message.role === "assistant" && message.content.trim())
    && !props.latestAgent?.events.some((event) => event.status === "running" && event.tool_name !== "agent_thinking");
  const clarification = clarificationFromAgent(props.latestAgent);
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false);
  const [expandedPreview, setExpandedPreview] = useState<{ filename: string; url: string } | null>(null);
  const [conversationListOpen, setConversationListOpen] = useState(false);
  const [researchPanelOpen, setResearchPanelOpen] = useState(false);
  const scrolling = useConversationScroll(props.currentConversationId, props.messages, researchPanelOpen);
  const researchReturn = useRef<{ top: number; element: HTMLElement | null } | null>(null);
  const [researchSelection, setResearchSelection] = useState<{
    agent?: AgentRunResult;
    sources: WebSource[];
    selectedSource: number;
  } | null>(null);
  const currentConversation = props.conversations.find((item) => item.id === props.currentConversationId);
  const sessionTitle = props.conversationTitle?.trim() || currentConversation?.title || "新对话";
  const showStarters = props.messages.length === 0 && !props.chatBusy && !clarification;
  const isFreshUntitled = props.messages.length === 0 && (!currentConversation || sessionTitle === "新对话");
  const latestAssistant = [...props.messages].reverse().find((message) => message.role === "assistant");
  const defaultResearchAgent = props.latestAgent ?? latestAssistant?.payload?.agent;
  const defaultResearchSources = webSourcesFromAgent(defaultResearchAgent);
  const activeResearch = researchSelection ?? {
    agent: defaultResearchAgent,
    sources: defaultResearchSources,
    selectedSource: 0
  };

  function openResearchDetails(agent = defaultResearchAgent, sources = defaultResearchSources, selectedSource = 0) {
    if (!researchPanelOpen) researchReturn.current = {
      top: scrolling.viewportRef.current?.scrollTop ?? 0,
      element: document.activeElement instanceof HTMLElement ? document.activeElement : null
    };
    setConversationListOpen(false);
    setResearchSelection({ agent, sources, selectedSource });
    setResearchPanelOpen(true);
  }

  function closeResearchDetails(restoreFocus = true) {
    setResearchPanelOpen(false);
    const saved = researchReturn.current;
    window.requestAnimationFrame(() => {
      if (researchReturn.current !== saved) return;
      if (saved) scrolling.restorePosition(saved.top);
      if (restoreFocus) (saved?.element?.isConnected ? saved.element : researchToggleRef.current)?.focus({ preventScroll: true });
    });
  }

  function fillComposer(draft: string, enableWebSearch = false) {
    if (enableWebSearch && props.webSearchAvailable && !props.webSearchSelected) {
      props.onToggleWebSearch();
    }
    aui.composer().setText(draft);
    window.requestAnimationFrame(() => {
      const input = props.chatInputRef.current;
      input?.focus();
      const cursor = draft.length;
      input?.setSelectionRange(cursor, cursor);
    });
  }

  const incomingDraft = props.composerDraft?.conversationId === props.currentConversationId
    ? props.composerDraft
    : null;

  function importIncomingDraft() {
    if (!incomingDraft || props.chatBusy) return;
    fillComposer(incomingDraft.content);
    appliedDraftId.current = incomingDraft.id;
    props.onComposerDraftConsumed?.();
  }

  useEffect(() => {
    if (!incomingDraft || props.chatBusy || appliedDraftId.current === incomingDraft.id) return;
    // Existing composer text remains editable; importing over it is an explicit action.
    if (aui.composer().getState().text.trim()) return;
    aui.composer().setText(incomingDraft.content);
    appliedDraftId.current = incomingDraft.id;
    props.onComposerDraftConsumed?.();
    window.requestAnimationFrame(() => props.chatInputRef.current?.focus());
  }, [aui, incomingDraft, props.chatBusy, props.chatInputRef, props.onComposerDraftConsumed]);

  useEffect(() => {
    setExpandedPreview(null);
    setConversationListOpen(false);
    setResearchPanelOpen(false);
    setResearchSelection(null);
    researchReturn.current = null;
  }, [props.currentConversationId]);

  useEffect(() => {
    if (props.messages.length > 0 || props.chatBusy || !props.currentConversationId) return;
    const timer = window.setTimeout(() => props.chatInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [props.chatBusy, props.chatInputRef, props.currentConversationId, props.messages.length]);

  useEffect(() => {
    if (!conversationListOpen && !researchPanelOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (conversationListOpen) setConversationListOpen(false);
      if (researchPanelOpen) closeResearchDetails();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversationListOpen, researchPanelOpen]);

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
    <section className={`chat-workspace ${props.density === "dock" ? "is-dock" : "is-page"} ${props.focused ? "is-focused" : ""} ${props.messages.length ? "has-history" : "is-empty"} ${props.chatBusy ? "is-running" : ""} ${researchPanelOpen ? "has-research-panel" : ""}`}>
      <ResearchPanelActionsContext.Provider value={{ openDetails: openResearchDetails }}>
      <ThreadPrimitive.Root className="chat-main">
        <header
          className={`chat-session-header${isFreshUntitled ? " is-untitled" : " has-session"}`}
          aria-label={`${sessionTitle} · 对话操作`}
        >
          <div className="chat-session-identity">
            {currentConversation ? (
              <button
                type="button"
                className="chat-session-title"
                onClick={() => props.onRenameConversation(currentConversation)}
                aria-label="重命名对话"
                title="重命名对话"
              >
                <span className="chat-session-mark" aria-hidden="true" />
                <span>{sessionTitle}</span>
                <Pencil size={13} aria-hidden="true" />
              </button>
            ) : (
              <p className="chat-session-title is-static">
                <span className="chat-session-mark" aria-hidden="true" />
                <span>{sessionTitle}</span>
              </p>
            )}
          </div>
          <div className="chat-session-tools" role="toolbar" aria-label="对话操作">
            {props.messages.length || props.chatBusy ? (
              <button
                ref={researchToggleRef}
                className={`chat-session-tool chat-research-toggle${researchPanelOpen ? " is-open" : ""}`}
                type="button"
                onClick={() => researchPanelOpen ? closeResearchDetails(false) : openResearchDetails()}
                aria-label="研究详情"
                aria-expanded={researchPanelOpen}
                aria-controls="chat-research-panel"
                title="查看搜索过程与引用来源"
              >
                <PanelRight size={15} />
                <span>研究详情</span>
                {defaultResearchSources.length ? <em>{defaultResearchSources.length}</em> : null}
              </button>
            ) : null}
            <button
              className="chat-session-tool"
              type="button"
              onClick={props.onCreateConversation}
              disabled={props.conversationBusy}
              aria-label="新建对话"
              title="新建对话"
            >
              <Plus size={16} /><span>新建</span>
            </button>
            <button
              className={`chat-session-tool chat-history-toggle${conversationListOpen ? " is-open" : ""}`}
              type="button"
              onClick={() => setConversationListOpen((open) => !open)}
              aria-label="对话记录"
              aria-expanded={conversationListOpen}
              aria-controls="conversation-history-drawer"
              title="对话记录"
            >
              <History size={16} /><span>记录</span>
            </button>
          </div>
        </header>
        <ThreadPrimitive.Viewport ref={scrolling.viewportRef} onScroll={scrolling.onScroll} autoScroll={false} scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false} scrollToBottomOnRunStart={false} className="chat-thread" role="log" aria-live="polite" aria-relevant="additions">
          <div ref={scrolling.contentRef} className="chat-thread-content">
          {props.messages.length === 0 && props.density === "dock" ? (
            <div className="chat-welcome"><span className="assistant-welcome-mark" aria-hidden="true">✦</span><h2>有什么可以帮你？</h2><p>提问、整理资料，或一起完成一段创作。</p></div>
          ) : null}
          {props.hiddenMessageCount > 0 ? (
            <button className="load-history-button" onClick={props.onLoadMore}>
              查看更早消息 · 还有 {props.hiddenMessageCount} 条
            </button>
          ) : null}

          {props.messages.length === 0 ? null : (
            <ThreadPrimitive.Messages>
              {({ message }) => message.composer.isEditing
                ? <EditMessageComposer />
                : <ChatTurn state={message} chatBusy={props.chatBusy} />}
            </ThreadPrimitive.Messages>
          )}

          <div ref={props.chatEndRef} />
          </div>
        </ThreadPrimitive.Viewport>

        <div className="chat-composer">
          {scrolling.away ? <button type="button" className="chat-jump-latest" onClick={scrolling.jumpToLatest}>{scrolling.unread ? "有新内容 · 回到最新 ↓" : "回到最新 ↓"}</button> : null}
          {props.chatBusy ? <RunStatus key={props.currentConversationId} title={generatingReply ? "正在生成回复" : placeholderThinking.title} task={placeholderThinking.currentTask} /> : null}
          {props.messages.length === 0 && props.density !== "dock" ? (
            <div className="chat-welcome">
              <h2>你想完成什么？</h2>
              <p>在这里搜索公开信息、核对来源、分析资料并生成内容，不用在多个工具之间来回切换。</p>
            </div>
          ) : null}
          {clarification && !props.chatBusy ? (
            <ComposerClarification
              clarification={clarification}
              busy={props.taskCancelBusy}
              onChoose={(text) => { void props.onSend(text); }}
              onCancel={props.onCancelTask}
            />
          ) : props.waitingForUser ? (
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

          {props.modelChecking ? <div className="chat-retry-prompt" role="status">正在检查模型服务…</div> : null}
          {props.modelUnavailable ? (
            <section className="chat-retry-prompt" role="alert" aria-label="模型服务不可用">
              <TriangleAlert size={14} />
              <span>{props.modelUnavailable} 输入内容已保留。</span>
              <button type="button" onClick={props.onOpenModelSettings}>去设置模型</button>
              {props.retryDraft ? <details><summary>查看保留的内容</summary><p style={{ whiteSpace: "pre-wrap" }}>{props.retryDraft.content}</p></details> : null}
            </section>
          ) : null}
          {props.retryDraft && !props.chatBusy ? (
            <section
              className="chat-retry-prompt"
              aria-label={props.retryDraft.reason === "interrupted" ? "任务恢复提示" : "消息发送失败"}
            >
              <TriangleAlert size={14} />
              <span>{props.retryDraft.reason === "interrupted" ? "上次任务意外中断，可从最近检查点继续" : "上一条消息未发送成功"}</span>
              <button onClick={() => {
                const draft = props.retryDraft;
                if (!draft) return;
                if (props.onRetry) {
                  void props.onRetry(draft);
                  return;
                }
                void props.onSend(draft.content, draft.attachmentIds, draft.visionAttachmentIds, draft.webSearch, draft.webSearchMode);
              }}><RefreshCw size={12} />{props.retryDraft.reason === "interrupted" ? "继续执行" : "重试"}</button>
            </section>
          ) : null}

          {incomingDraft && appliedDraftId.current !== incomingDraft.id ? (
            <section className="chat-retry-prompt" aria-label="资讯分析草稿">
              <FileText size={14} />
              <span>资讯分析草稿已准备，当前输入已保留。</span>
              <button type="button" disabled={props.chatBusy} onClick={importIncomingDraft}>替换为资讯草稿</button>
              <button type="button" onClick={props.onComposerDraftConsumed}>保留当前输入</button>
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
                  <article key={attachment.id} className={attachment.kind === "image" ? "composer-image-attachment" : "composer-file-attachment"}>
                    {attachment.kind === "image" && props.previewUrls[attachment.id]
                      ? <button
                        type="button"
                        className="composer-attachment-preview-button"
                        onClick={() => setExpandedPreview({ filename: attachment.original_filename, url: props.previewUrls[attachment.id] })}
                        aria-label={`查看 ${attachment.original_filename}`}
                      ><img className="composer-attachment-preview" src={props.previewUrls[attachment.id]} alt={`${attachment.original_filename} 预览`} /></button>
                      : <span className="composer-attachment-icon">
                        {attachment.kind === "document" ? <FileText size={15} /> : <ImagePlus size={15} />}
                      </span>}
                    {attachment.kind === "document" ? <span>
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
            <ComposerPrimitive.Root className="composer-input composer-input--enhanced" onSubmit={(event) => { if (props.attachmentBusy) event.preventDefault(); }}>
              <ComposerPrimitive.Input
                ref={props.chatInputRef}
                rows={1}
                maxLength={200_000}
                aria-label="输入消息"
                aria-describedby="composer-input-hint"
                placeholder={clarification ? "回答上面的问题，或直接说下一件…" : "描述任务，或添加一份资料…"}
                submitMode="enter"
                unstable_insertNewlineOnTouchEnter
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
                  {props.webSearchSelected ? (
                    <select
                      className="web-search-mode"
                      aria-label="联网搜索模式"
                      value={props.webSearchMode}
                      disabled={props.chatBusy}
                      onChange={(event) => props.onWebSearchModeChange(event.target.value as WebSearchMode)}
                    >
                      <option value="auto">自动来源</option>
                      <option value="technical">技术来源</option>
                      <option value="general">通用来源</option>
                    </select>
                  ) : null}
                  <ChatContextChips context={props.sessionContext} onOpenLibrary={props.onOpenLibrary} />
                </div>
                {props.chatBusy ? (
                  <ComposerPrimitive.Cancel className="send-button stop-button" disabled={props.taskCancelBusy} aria-label="停止">
                    <Square size={14} fill="currentColor" /><span>停止</span>
                  </ComposerPrimitive.Cancel>
                ) : (
                  <ComposerPrimitive.Send className="send-button" aria-label="发送" disabled={props.attachmentBusy} title={props.attachmentBusy ? "资料处理完成后即可发送" : "发送消息"}>
                    <Send size={16} /><span>发送</span>
                  </ComposerPrimitive.Send>
                )}
              </div>
            </ComposerPrimitive.Root>
            <div className="composer-input-hint" id="composer-input-hint"><span className="composer-keyboard-hint">Enter 发送 · Shift + Enter 换行</span><span className="composer-touch-hint">支持多行输入，点击按钮发送</span>{composerText.length >= 180_000 && <span role="status">{composerText.length.toLocaleString()} / 200,000 字</span>}</div>
            {isDraggingAttachment ? <div className="composer-drop-hint" aria-live="polite">松开即可添加图片或文档</div> : null}
          </div>
          {showStarters ? (
            <StarterPromptList
              onFill={fillComposer}
              hasSources={Boolean(props.sessionContext?.sourceLabel?.trim())}
            />
          ) : null}
          {expandedPreview ? (
            <div className="attachment-preview-dialog" role="dialog" aria-modal="true" aria-label={`${expandedPreview.filename} 预览`} onClick={() => setExpandedPreview(null)}>
              <img src={expandedPreview.url} alt={`${expandedPreview.filename} 大图预览`} onClick={(event) => event.stopPropagation()} />
              <button type="button" onClick={() => setExpandedPreview(null)} aria-label="关闭图片预览"><X size={18} /></button>
            </div>
          ) : null}
        </div>
      </ThreadPrimitive.Root>
      <ResearchPanel
        open={researchPanelOpen}
        agent={activeResearch.agent}
        sources={activeResearch.sources}
        selectedSource={activeResearch.selectedSource}
        streaming={props.chatBusy && activeResearch.agent === props.latestAgent}
        onSelectSource={(selectedSource) => setResearchSelection({
          agent: activeResearch.agent,
          sources: activeResearch.sources,
          selectedSource
        })}
        onClose={() => closeResearchDetails()}
      />
      </ResearchPanelActionsContext.Provider>
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
      {researchPanelOpen ? <button className="research-panel-backdrop" type="button" aria-label="关闭研究详情" onClick={() => closeResearchDetails()} /> : null}
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
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>("auto");

  useEffect(() => {
    Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = {};
    setPendingAttachments([]);
    setPreviewUrls({});
    setUploadingPreview(null);
    setVisionAttachmentIds([]);
    setWebSearchSelected(false);
    setWebSearchMode("auto");
  }, [props.currentConversationId]);

  useEffect(() => {
    const imported = props.libraryAttachments;
    if (!imported || imported.conversationId !== props.currentConversationId) return;
    setPendingAttachments(current => [...current, ...imported.attachments.filter(item => !current.some(existing => existing.id === item.id))]);
    props.onLibraryAttachmentsConsumed?.();
  }, [props.currentConversationId, props.libraryAttachments, props.onLibraryAttachmentsConsumed]);

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
      if (attachment.kind === "image") {
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
          webSearchMode,
        );
        // Failed sends keep content and attachment IDs in retryDraft; do not
        // leave a second copy queued in the composer after a successful retry.
        setPendingAttachments([]);
        setVisionAttachmentIds([]);
        setWebSearchSelected(false);
        setWebSearchMode("auto");
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
        webSearchMode={webSearchMode}
        onToggleWebSearch={() => setWebSearchSelected((selected) => !selected)}
        onWebSearchModeChange={setWebSearchMode}
      />
    </AssistantRuntimeProvider>
  );
}
