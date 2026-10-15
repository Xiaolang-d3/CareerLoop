import { ToolCallDetails } from "./ToolCallDetails";
import { formatExecutionTime } from "./tool-call-details";
import "./run-process.css";
import { MarkdownContent, SourceFavicon, sourceDomain, type WebSource } from "./ChatMarkdown";
export type { WebSource } from "./ChatMarkdown";
const STARTER_PROMPTS: Array<{
  draft: string;
  title: string;
  needsSources?: boolean;
  enableWebSearch?: boolean;
}> = [
    { draft: "帮我梳理已保存的资料，先总结重点，再指出还缺什么。", title: "梳理已保存资料", needsSources: true },
    { draft: "帮我分析这份材料，先总结重点，再指出值得继续追问的地方。", title: "分析一份材料" },
    { draft: "帮我查找并核对这个主题的公开信息：", title: "查找公开信息", enableWebSearch: true },
    { draft: "根据我的要求起草一份内容。用途、读者和要点是：", title: "起草一份内容" }
  ];
import type { AgentRunResult, ChatClarification, ChatMessage, ChatSessionContext, ModelSelection } from "./types";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { searchMetadataFromAgent, type SearchMetadata } from "./searchMetadata";
import { webSearchTopicLabels } from "./webSearchOptions";
import { AttachmentPreviewContext } from "./AttachmentPreviewDialog";
import { ResultActionsContext } from "./result-types";
import { HistoryAttachment } from "./HistoryAttachment";
import { GeneratedImage } from "./GeneratedImage";
import { ActionBarPrimitive, ComposerPrimitive, MessagePrimitive, type AppendMessage, type MessageState } from "@assistant-ui/react";
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleHelp, Copy, FileText, FolderPlus, Info, LoaderCircle, PanelRight, Pencil, RefreshCw, Search, X } from "lucide-react";

const modelStageLabels: Record<string, string> = { classify: "意图识别", plan: "任务规划", execute: "执行回答" };
const modelSelectionReasons: Record<string, string> = {
  explicit_profile: "手动选模", conversation_profile: "会话选模", stage_role: "阶段分工",
  default_profile: "账号默认", restored_stage: "原任务配置"
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

export function textFromAppendMessage(message: AppendMessage): string {
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function RunErrorNote({ run, content }: { run?: AgentRunResult; content: string }) {
  if (!run) return null;
  const failed = run.status === "failed";
  if (!failed) return null;
  const errorMessage = run.error?.message?.trim();
  const errorAlreadyShown = errorMessage && content.replace(/\s+/g, " ").includes(errorMessage.replace(/\s+/g, " "));
  if (!errorMessage || errorAlreadyShown) return null;
  return <p className="run-process-error">{errorMessage}</p>;
}

export function webSourcesFromAgent(agent?: AgentRunResult): WebSource[] {
  return (agent?.events
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
}

type ResearchPanelActions = {
  openDetails: (agent: AgentRunResult | undefined, sources: WebSource[], selectedSource?: number) => void;
};

export const ResearchPanelActionsContext = createContext<ResearchPanelActions | null>(null);

export function EditMessageComposer() {
  return (
    <MessagePrimitive.Root className="message user message-editing">
      <div className="message-content">
        <div className="message-meta"><strong>编辑消息</strong><span>将替换本条消息及后续消息，并重新生成回复</span></div>
        <ComposerPrimitive.Root className="message-edit-composer">
          <ComposerPrimitive.Input rows={3} maxLength={200_000} aria-label="编辑消息" aria-describedby="message-edit-impact" autoFocus />
          <p className="message-edit-impact" id="message-edit-impact">沿用本轮联网设置；资料不会自动附加，需要重新添加资料时请取消编辑，另发新消息。</p>
          <div className="message-edit-actions">
            <ComposerPrimitive.Cancel><X size={12} />取消</ComposerPrimitive.Cancel>
            <ComposerPrimitive.Send><Check size={12} />保存并重新生成</ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

const STREAMING_THINKING_TITLE = "正在整理要点";

const GENERIC_TASK_MESSAGE = /^(?:正在执行(?:\s+\S+)?|running|in progress)$/i;

const ROUTE_SUMMARY_MESSAGE = /^已识别为/;

const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  search_public_web: "正在检索公开资料",
  image_generation: "正在生成图片",
  get_library_context: "正在读取知识库",
  search_library: "正在检索资料",
  propose_library_knowledge: "正在添加待确认知识",
  agent_thinking: STREAMING_THINKING_TITLE,
  agent_planner: "正在规划步骤",
  model_provider: "正在生成回答",
  completion_validator: "正在补齐必要步骤",
  citation_validator: "正在核对引用",
  agent_loop_guard: "正在纠正重复步骤",
  agent_run_state: "正在同步任务状态",
  ask_user: "需要你确认",
  agent_tool: "正在执行任务"
};

function truncateTask(text: string, max = 36): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function isGenericTaskMessage(message: string, toolName: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (GENERIC_TASK_MESSAGE.test(trimmed)) return true;
  return trimmed === toolName || trimmed === `正在执行 ${toolName}`;
}

function planStepsFromAgent(agent?: AgentRunResult): Array<{ title: string; tool_name: string; status: string }> {
  if (agent?.plan?.steps?.length) return agent.plan.steps;
  const rawPlan = agent?.events?.find((event) => event.tool_name === "agent_planner")?.data?.plan;
  if (!rawPlan || typeof rawPlan !== "object" || !("steps" in rawPlan) || !Array.isArray(rawPlan.steps)) return [];
  return rawPlan.steps.flatMap((step) => {
    if (!step || typeof step !== "object") return [];
    const record = step as Record<string, unknown>;
    if (typeof record.title !== "string" || typeof record.tool_name !== "string") return [];
    return [{
      title: record.title,
      tool_name: record.tool_name,
      status: typeof record.status === "string" ? record.status : "pending"
    }];
  });
}

function eventArguments(event: AgentRunResult["events"][number]): Record<string, unknown> {
  const data = event.data;
  if (!data || typeof data !== "object") return {};
  const nested = data.arguments;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return data;
}

function hostnameFromUnknown(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return value.replace(/^https?:\/\//i, "").split("/")[0]?.replace(/^www\./i, "") || "";
  }
}

function workLineFromEvent(
  event: AgentRunResult["events"][number],
  steps: Array<{ title: string; tool_name: string; status: string }>
): string {
  if (event.tool_name === "agent_thinking") return "";
  if (!isGenericTaskMessage(event.message, event.tool_name)) {
    return event.message.trim();
  }
  const args = eventArguments(event);
  const company = typeof args.company_name === "string" ? args.company_name.trim() : "";
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const host = hostnameFromUnknown(args.url || args.official_website);
  if (company) return `正在检索：${company}`;
  if (query) return `正在检索：${query}`;
  if (host) return `正在阅读 ${host}`;
  const step = steps.find((item) => item.tool_name === event.tool_name);
  if (step?.title.trim()) {
    if (event.status === "running") return `正在进行：${step.title.trim()}`;
    if (event.status === "done") return `已完成：${step.title.trim()}`;
    if (event.status === "failed") return `失败：${step.title.trim()}`;
    return step.title.trim();
  }
  return TOOL_ACTIVITY_LABELS[event.tool_name] || "";
}

export function thinkingHeaderCopy(agent: AgentRunResult | undefined, streaming: boolean): { title: string; currentTask?: string } {
  if (!streaming) return { title: "思考过程" };

  const events = agent?.events ?? [];
  const steps = planStepsFromAgent(agent);
  const runningEvent = [...events].reverse().find((event) => event.status === "running");
  const runningStep = [...steps].reverse().find((step) => step.status === "running")
    ?? steps.find((step) => step.tool_name === runningEvent?.tool_name);
  const currentTool = runningEvent?.tool_name || runningStep?.tool_name;
  const title = currentTool
    ? (TOOL_ACTIVITY_LABELS[currentTool] ?? "正在执行任务")
    : STREAMING_THINKING_TITLE;

  const eventForTask = runningEvent && runningEvent.tool_name !== "agent_thinking" ? runningEvent : undefined;
  const liveWork = eventForTask ? workLineFromEvent(eventForTask, steps) : "";
  const usefulEventMessage = liveWork && liveWork !== title ? truncateTask(liveWork) : "";
  const stepTitle = (runningStep?.title || "").trim();
  const currentTask = [usefulEventMessage, stepTitle].find((value) => value && value !== title);
  return currentTask ? { title, currentTask } : { title };
}

const COMPLETED_ACTIVITY_LABELS: Record<string, string> = {
  image_generation: "已生成图片",
  search_public_web: "已检索公开资料", get_library_context: "已读取知识库",
  search_library: "已检索资料", propose_library_knowledge: "已提交待确认知识",
  agent_planner: "已规划步骤", model_provider: "已生成回答",
  completion_validator: "已核对执行步骤", citation_validator: "已核对引用",
  agent_loop_guard: "已调整执行步骤", agent_run_state: "已同步任务状态",
  ask_user: "等待你的确认", agent_tool: "已执行工具"
};

function processEntries(agent: AgentRunResult | undefined, streaming: boolean) {
  const steps = planStepsFromAgent(agent);
  const merged = new Map<string, AgentRunResult["events"][number]>();
  for (const event of agent?.events ?? []) {
    const previous = merged.get(event.tool_call_id);
    merged.set(event.tool_call_id, { ...previous, ...event, data: { ...previous?.data, ...event.data } });
  }
  return [...merged.values()].flatMap((event) => {
    if (event.tool_name === "agent_thinking") {
      const text = event.message.trim();
      return text && !ROUTE_SUMMARY_MESSAGE.test(text)
        ? [{ id: event.tool_call_id, text, thought: true, status: event.status, tool: event.tool_name, event }]
        : [];
    }
    const isRunning = streaming && event.status === "running";
    const neutral = (TOOL_ACTIVITY_LABELS[event.tool_name] || "执行任务").replace(/^正在/, "");
    let text = isGenericTaskMessage(event.message, event.tool_name)
      ? isRunning ? workLineFromEvent(event, steps)
        : event.status === "done" ? COMPLETED_ACTIVITY_LABELS[event.tool_name] || neutral : neutral
      : event.message.trim();
    if (!streaming && event.status === "running") text = text.replace(/^正在/, "");
    return text ? [{ id: event.tool_call_id, text, thought: false, status: event.status, tool: event.tool_name, event }] : [];
  });
}

export function RunProcess({ agent, streaming, stopping = false, content = "" }: {
  agent?: AgentRunResult;
  streaming: boolean;
  stopping?: boolean;
  content?: string;
}) {
  const bodyId = useId();
  const [expanded, setExpanded] = useState(streaming);
  const previousStreaming = useRef(streaming);
  const [now, setNow] = useState(Date.now);
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const previousIds = useRef(new Set<string>());
  const startedAt = agent?.started_at ? Date.parse(agent.started_at) : NaN;
  useEffect(() => {
    if (previousStreaming.current && !streaming) setExpanded(false);
    previousStreaming.current = streaming;
  }, [streaming]);
  useEffect(() => {
    if (!streaming) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);
  const elapsed = streaming && Number.isFinite(startedAt) ? Math.max(0, now - startedAt)
    : !streaming && typeof agent?.duration_ms === "number" && Number.isFinite(agent.duration_ms)
      ? Math.max(0, agent.duration_ms) : null;
  const current = thinkingHeaderCopy(agent, streaming);
  const generating = content.trim() && !agent?.events.some((event) => event.status === "running" && event.tool_name !== "agent_thinking");
  const terminalError = !streaming && agent?.status === "failed" ? agent.error?.message?.trim() : undefined;
  const entries = processEntries(agent, streaming).flatMap((entry) => {
    if (!terminalError || entry.thought || entry.text !== terminalError) return [entry];
    // Keep a failed tool inspectable without repeating the error already shown in the answer.
    if (entry.tool === "model_provider") return [];
    const activity = (TOOL_ACTIVITY_LABELS[entry.tool] || "执行任务").replace(/^正在/, "");
    return [{ ...entry, text: `${activity}失败` }];
  });
  const liveEntry = [...entries].reverse().find(entry => !entry.thought && entry.status === "running");
  const title = streaming ? stopping ? "正在停止生成" : generating ? "正在生成回复" : liveEntry?.text || current.currentTask || current.title
    : elapsed !== null ? `用时 ${formatExecutionTime(elapsed)}` : "思考与执行过程";
  const imageFailure = agent?.events.some(event => event.tool_name === "image_generation") && !agent?.assets?.length;
  const outcome = !streaming ? agent?.status === "failed" ? imageFailure ? "未生成图片" : "生成失败"
    : agent?.status === "cancelled" ? "已停止" : agent?.status === "waiting_user" ? "等待确认" : "" : "";
  const signature = JSON.stringify(entries);
  function jumpToLatest() {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    following.current = true;
    setFollow(true);
    setUnseen(0);
  }
  useLayoutEffect(() => {
    if (expanded) jumpToLatest();
  }, [expanded]);
  useLayoutEffect(() => {
    const ids = new Set(entries.map(entry => entry.id));
    if (expanded) {
      if (following.current) {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      } else {
        const added = [...ids].filter(id => !previousIds.current.has(id)).length;
        if (added) setUnseen(count => count + added);
      }
    }
    previousIds.current = ids;
  }, [signature, expanded]);
  function inspect() {
    following.current = false;
    setFollow(false);
  }
  if (!streaming && !entries.length && !outcome && elapsed === null) return null;
  return (
    <section className={`run-process${streaming ? " is-running" : ""}${expanded ? " is-expanded" : ""}`} aria-label="思考与执行过程">
      <button type="button" className="run-process-toggle" aria-expanded={expanded} aria-controls={bodyId}
        aria-label={`${expanded ? "收起" : "展开"}思考与执行过程`} onClick={() => setExpanded((open) => !open)}>
        {streaming ? <LoaderCircle size={14} className="spinning" aria-hidden="true" /> : null}
        <span className={`run-current-content${streaming && !stopping ? " is-current-execution" : ""}`} role={streaming ? "status" : undefined} title={title}>{title}</span>
        {streaming && elapsed !== null ? <small>已用时 {formatExecutionTime(elapsed)}</small> : null}
        {outcome ? <span className={`run-process-outcome${agent?.status === "failed" ? " is-failed" : ""}`}>{outcome}</span> : null}
        <ChevronDown size={15} className="run-process-chevron" aria-hidden="true" />
      </button>
      <div id={bodyId} className="run-process-fixed" hidden={!expanded}>
        <div ref={scrollRef} className="run-process-scroll" tabIndex={0} role="region" aria-label="执行记录，可滚动查看"
          onScroll={() => {
            const node = scrollRef.current;
            if (!node) return;
            const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 24;
            following.current = atBottom;
            setFollow(atBottom);
            if (atBottom) setUnseen(0);
          }}>
          {entries.map((entry) => entry.thought
            ? <p key={entry.id} className="run-process-thought">{entry.text}</p>
            : <ToolCallDetails key={entry.id} event={entry.event} title={entry.text} streaming={streaming} stopping={stopping} now={now} onInspect={inspect} />)}
          {!entries.length ? <p className="run-process-empty">{streaming ? "等待模型响应…" : "未记录更多过程信息。"}</p> : null}
        </div>
        {!follow ? <div className="run-process-followbar"><small>{unseen ? `有 ${unseen} 条新记录` : "已暂停跟随"}</small>
          <button type="button" onClick={jumpToLatest}>回到最新{unseen ? `（${unseen}）` : ""}</button>
        </div> : null}
      </div>
      {!streaming ? <RunErrorNote run={agent} content={content} /> : null}
    </section>
  );
}

export function ComposerClarification({
  clarification,
  busy,
  onChoose,
  onCancel
}: {
  clarification: ChatClarification;
  busy: boolean;
  onChoose: (text: string) => void;
  onCancel: () => void;
}) {
  return (
    <section className="composer-clarification" aria-label="需要你确认后继续">
      <div className="composer-clarification-head">
        <span className="composer-clarification-icon"><CircleHelp size={16} /></span>
        <div className="composer-clarification-copy">
          <span>需要你确认</span>
          <strong>{clarification.question || "选一项后继续，或直接说下一件"}</strong>
        </div>
        <button className="task-cancel-button" type="button" onClick={onCancel} disabled={busy}>
          {busy ? "结束中…" : "结束任务"}
        </button>
      </div>
      {clarification.options.length ? (
        <div className="composer-clarification-options" role="group" aria-label="可选回复">
          {clarification.options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={busy}
              onClick={() => onChoose(option.send)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {clarification.allowCustom ? (
        <p className="composer-clarification-hint">答当前问题则继续；换一件事直接说，或点结束任务</p>
      ) : null}
    </section>
  );
}

export function StarterPromptList({
  onFill,
  hasSources
}: {
  onFill: (draft: string, enableWebSearch?: boolean) => void;
  hasSources: boolean;
}) {
  const prompts = STARTER_PROMPTS.filter((item) => !item.needsSources || hasSources);
  if (!prompts.length) return null;
  return (
    <div className="composer-drafts" aria-label="可选草稿">
      {prompts.map(({ draft, enableWebSearch, title }) => (
        <button key={title} type="button" onClick={() => onFill(draft, enableWebSearch)}>
          {title}
        </button>
      ))}
    </div>
  );
}

export function ChatContextChips({
  context,
  onOpenLibrary
}: {
  context?: ChatSessionContext;
  onOpenLibrary?: () => void;
}) {
  const sourceLabel = context?.sourceLabel?.trim();
  const analysisLabel = context?.analysisLabel?.trim();
  if (!sourceLabel && !analysisLabel) return null;
  return (
    <span className="composer-context-hint">
      {sourceLabel ? (
        <button
          type="button"
          className="composer-context-status is-source"
          onClick={onOpenLibrary}
          title="查看已保存资料，提问时会自动参考"
          aria-label="查看已保存资料"
        >
          <FileText size={15} aria-hidden="true" />
          <span>已保存资料</span>
        </button>
      ) : null}
      {analysisLabel ? (
        <span
          className="composer-context-status is-analysis"
          role="status"
          title={`提问时会参考：${analysisLabel}`}
        >
          <span>{analysisLabel}</span>
        </span>
      ) : null}
    </span>
  );
}

function WebSourcesPanel({ sources, onOpen }: { sources: WebSource[]; onOpen?: () => void }) {
  if (!sources.length) return null;
  return (
    <section className="web-sources-panel" aria-label="联网搜索来源">
      <button
        type="button"
        className="web-sources-heading"
        onClick={onOpen}
      >
        <Search size={16} />
        <strong>查看全部 {sources.length} 个来源</strong>
        <PanelRight size={14} />
      </button>
    </section>
  );
}

function sourceConfidence(source: WebSource): "high" | "review" {
  const host = sourceDomain(source).toLowerCase();
  return /\.(?:gov|edu)(?:\.[a-z]{2})?$/.test(host) || /(?:^|\.)docs\./.test(host) ? "high" : "review";
}

function sourceDisplaySummary(source: WebSource): string {
  const summary = source.content?.trim() || source.snippet?.trim() || "";
  const compactness = summary.length ? summary.replace(/\s/g, "").length / summary.length : 0;
  if (!summary) return "暂无摘要，可打开原网页核对完整内容。";
  if (summary.length > 1200 && compactness > .92) return "页面返回的摘要不可读，请打开原网页核对完整内容。";
  return `${summary.slice(0, 520)}${summary.length > 520 ? "…" : ""}`;
}

export function ResearchPanel({
  open,
  agent,
  sources,
  selectedSource,
  streaming,
  onSelectSource,
  onClose
}: {
  open: boolean;
  agent?: AgentRunResult;
  sources: WebSource[];
  selectedSource: number;
  streaming: boolean;
  onSelectSource: (index: number) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sourceSectionRef = useRef<HTMLElement>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const activeSource = sources[Math.min(selectedSource, Math.max(0, sources.length - 1))];

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus({ preventScroll: true });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !sources.length || !sourceSectionRef.current || !panelScrollRef.current) return;
    panelScrollRef.current.scrollTop = sourceSectionRef.current.offsetTop - panelScrollRef.current.offsetTop;
  }, [open, selectedSource, sources.length]);

  if (!open) return null;
  return (
    <aside id="chat-research-panel" className="research-panel" aria-label="来源详情">
      <header className="research-panel-header">
        <div>
          <span className={`research-live-dot${streaming ? " is-live" : ""}`} aria-hidden="true" />
          <strong>来源详情</strong>
          <small>{sources.length}</small>
        </div>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭来源详情" title="关闭来源详情">
          <X size={17} />
        </button>
      </header>

      <div className="research-panel-scroll" ref={panelScrollRef}>
        <section className="research-section research-sources" aria-labelledby="research-sources-title" ref={sourceSectionRef}>
          <div className="research-section-heading">
            <span>引用</span>
            <small>{sources.length ? `${sources.length} 个来源` : "暂无来源"}</small>
          </div>
          <h2 id="research-sources-title">用于回答的公开资料</h2>
          {sources.length ? (
            <>
              {activeSource ? (
                <article className="research-source-detail" aria-label={`来源详情：${activeSource.title}`}>
                  <div>
                    <span>来源 {Math.min(selectedSource, sources.length - 1) + 1}</span>
                    <a href={activeSource.url} target="_blank" rel="noreferrer">打开原网页<ArrowUpRight size={13} /></a>
                  </div>
                  <strong title={activeSource.title}>{activeSource.title}</strong>
                  {activeSource.published_at ? <small>{activeSource.published_at}</small> : null}
                  <p>{sourceDisplaySummary(activeSource)}</p>
                </article>
              ) : null}
              <div className="research-source-list" aria-label="来源列表">
                {sources.map((source, index) => {
                  const confidence = sourceConfidence(source);
                  return (
                    <button
                      type="button"
                      className={activeSource?.url === source.url ? "is-active" : ""}
                      key={`${source.url}-${index}`}
                      onClick={() => onSelectSource(index)}
                      aria-label={`来源 ${index + 1}：${source.title}`}
                    >
                      <span className="research-source-number">{index + 1}</span>
                      <SourceFavicon domain={sourceDomain(source)} title={source.title} />
                      <span className="research-source-copy">
                        <strong title={source.title}>{source.title}</strong>
                        <small>{sourceDomain(source)}</small>
                      </span>
                      <em className={`is-${confidence}`}>{confidence === "high" ? "高可信" : "待核验"}</em>
                    </button>
                  );
                })}
              </div>

            </>
          ) : (
            <div className="research-empty-state">
              <Search size={16} />
              <p>联网搜索返回的引用来源会显示在这里。</p>
            </div>
          )}
        </section>
        {searchMetadataFromAgent(agent).length ? <details className="research-search-details"><summary>搜索参数</summary><SearchMetadataContent metadata={searchMetadataFromAgent(agent)} /></details> : null}
      </div>
    </aside>
  );
}

function UserMessageContent({ content }: { content: string }) {
  const hasJobContext = /以下内容来自我保存的岗位项目|岗位项目上下文|目标岗位[:：]|岗位描述[:：]/.test(content);
  const collapsible = content.length > 600 || hasJobContext;
  const [expanded, setExpanded] = useState(false);
  if (!collapsible) return <p className="message-dialog">{content}</p>;
  const preview = content.replace(/\s+/g, " ").trim().slice(0, 180);
  return (
    <section className={`user-message-summary message-dialog ${expanded ? "expanded" : ""}`}>
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

function MessageCopyButton({ content, label }: { content: string; label: string }) {
  const [feedback, setFeedback] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setFeedback(""); }, [content]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(content); setFeedback("已复制"); }
    catch { setFeedback("复制失败，请重试"); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(""), 3000);
  }
  return <><button type="button" className="message-icon-action" aria-label={label} title={feedback || label} onClick={() => void copy()} disabled={!content}>{feedback === "已复制" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button><span className="message-copy-feedback" role="status">{feedback}</span></>;
}

function SearchMetadataContent({ metadata }: { metadata: SearchMetadata[] }) {
  const topicLabel = (value: string | null) => value === "company" ? "公司" : value && value in webSearchTopicLabels ? webSearchTopicLabels[value as keyof typeof webSearchTopicLabels] : "未知";
  return <>{metadata.map((item, index) => <span key={index} className="search-metadata-entry">
    <strong>搜索服务：{item.provider === "tavily" ? "Tavily" : item.provider === "agent_search" ? "AgentSearch" : item.provider}</strong>
    <span>请求类别：{webSearchTopicLabels[item.requested_topic]} · 发送类别：{item.sent_topic ? topicLabel(item.sent_topic) : "由服务判断"}</span>
    <span>服务实际类别：{topicLabel(item.effective_topic)} · 来源偏好：{item.source_preference === "technical" ? "优先技术资料" : "不限来源"}</span>
    {item.warnings.map((warning, warningIndex) => <span key={warningIndex}>{warning}</span>)}
  </span>)}</>;
}

function MessageModelDetails({ selection, messageId, metadata }: { selection?: ModelSelection; messageId: number; metadata: SearchMetadata[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function outsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", outsideClick);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outsideClick);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <span ref={rootRef} className="message-details-disclosure">
      <button ref={buttonRef} type="button" className="message-icon-action" aria-label="回答详情" title="回答详情" aria-expanded={open} aria-controls={`message-details-${messageId}`} onClick={() => setOpen((value) => !value)}>
        <Info size={14} aria-hidden="true" />
      </button>
      {open ? <span id={`message-details-${messageId}`} className="message-model-details" role="region" aria-label="回答详情">
        {selection ? <><strong>生成模型：{selection.model_name}</strong>
        <span>模型版本 {selection.profile_revision} · 连接版本 {selection.connection_revision}
          {selection.policy_version ? ` · 路由版本 ${selection.policy_version}` : ""}</span>
        {selection.stage_selections ? Object.entries(selection.stage_selections).map(([stage, stageSelection]) => (
          <span key={stage}>{modelStageLabels[stage] || stage}：{stageSelection.model_name || "未记录"} · {modelSelectionReasons[stageSelection.selection_reason || ""] || "原任务配置"}
            {stageSelection.capability_status === "unverified" ? " · 所需能力未验证" : stageSelection.capability_status ? "" : " · 本轮未调用"}</span>
        )) : null}</> : null}
        <SearchMetadataContent metadata={metadata} />
      </span> : null}
    </span>
  );
}

export function ChatTurn({ state, chatBusy, stopping = false }: { state: MessageState; chatBusy: boolean; stopping?: boolean }) {
  const researchPanel = useContext(ResearchPanelActionsContext);
  const openAttachment = useContext(AttachmentPreviewContext);
  const openResult = useContext(ResultActionsContext);
  const source = state.metadata.custom.source as ChatMessage | undefined;
  if (!source) return null;
  const modelSelection = source.payload?.agent?.model_selection ?? source.payload?.model_selection;
  const thoughtEvent = source.payload?.agent?.events.find(
    (event) => event.tool_name === "agent_thinking"
  );
  const isActiveAssistant = chatBusy && source.id < 0;
  const resultContent = resultOnlyContent(source.content, Boolean(thoughtEvent?.message));
  const failed = source.payload?.agent?.status === "failed";
  const errorOnly = failed && Boolean(source.payload?.agent?.error?.message?.trim()) && resultContent.trim() === source.payload?.agent?.error?.message.trim();
  const assets = source.payload?.agent?.assets ?? [];
  const blocks = source.payload?.agent?.output_blocks ?? [];
  const seenAssets = new Set<string>();
  const imageBlock = (id: string) => {
    const asset = assets.find(item => item.id === id);
    if (!asset || seenAssets.has(id)) return null;
    seenAssets.add(id);
    return <GeneratedImage key={id} asset={asset} messageId={source.id} />;
  };
  const webSources = webSourcesFromAgent(source.payload?.agent);
  const searchMetadata = searchMetadataFromAgent(source.payload?.agent);
  const openResearch = (selectedSource?: number) => {
    researchPanel?.openDetails(source.payload?.agent, webSources, selectedSource);
  };

  return (
    <MessagePrimitive.Root className={`message ${source.role}`}>
      <div className="message-content">
        {source.role === "assistant" ? (
          <>
            <RunProcess agent={source.payload?.agent} streaming={isActiveAssistant} stopping={stopping && isActiveAssistant} content={resultContent} />
            {assets.length && blocks.length ? <section className="message-result message-dialog" aria-label="输出结果">{blocks.map((block, index) => block.type === "image" ? imageBlock(block.asset_id) : <MarkdownContent key={`text-${index}`} sources={webSources} streaming={isActiveAssistant} onOpenSource={openResearch}>{block.text}</MarkdownContent>)}{assets.filter(asset => !seenAssets.has(asset.id)).map(asset => imageBlock(asset.id))}</section> : <>
              {resultContent ? <section className="message-result message-dialog" aria-label="输出结果"><MarkdownContent sources={webSources} streaming={isActiveAssistant} onOpenSource={openResearch}>{resultContent}</MarkdownContent></section> : null}
              {assets.map(asset => imageBlock(asset.id))}
            </>}
            {modelSelection?.fallback_used && modelSelection.answered_model_name ? <p className="message-model-selection">由备用模型 {modelSelection.answered_model_name} 回答</p> : null}
            <ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
              <MessageCopyButton content={resultContent} label="复制回答" />
              {openResult && ((!errorOnly && resultContent) || assets.length > 0) && source.id > 0 && source.payload?.agent?.status !== "waiting_user" ? <button type="button" className="message-result-action" aria-label="查看与保存成果" title="独立阅读、下载或保存到文件库" onClick={() => openResult(source.id)}><FolderPlus size={14} aria-hidden="true" /><span>成果</span></button> : null}
              <ActionBarPrimitive.Reload className="message-icon-action" aria-label={failed ? "重试回答" : "重新生成回答"} title={failed ? "重试回答，将替换本轮及后续消息" : "重新生成，将替换本轮及后续消息"} aria-describedby={`regenerate-impact-${source.id}`}>
                <RefreshCw size={14} aria-hidden="true" />
              </ActionBarPrimitive.Reload>
              {modelSelection?.model_name || searchMetadata.length ? <MessageModelDetails key={source.id} selection={modelSelection} messageId={source.id} metadata={searchMetadata} /> : null}
            </ActionBarPrimitive.Root>
            <span className="message-action-hint sr-only" id={`regenerate-impact-${source.id}`}>重新生成将替换本轮及后续消息</span>
            <WebSourcesPanel sources={webSources} onOpen={() => openResearch()} />
          </>
        ) : (
          <>
            <UserMessageContent content={source.content} />
            {source.payload?.attachments?.length ? (
              <div className="message-attachments" aria-label="本轮已附加资料">
                {source.payload.attachments.map((attachment) => (
                  <HistoryAttachment key={attachment.id} attachment={attachment} onPreview={() => openAttachment?.(attachment)} onSave={openResult && source.id > 0 ? () => openResult(source.id, `attachment:${attachment.id}`, true) : undefined} />
                ))}
              </div>
            ) : null}
            <ActionBarPrimitive.Root className="message-actions user-message-actions" hideWhenRunning>
              <MessageCopyButton content={source.content} label="复制消息" />
              <ActionBarPrimitive.Edit className="message-icon-action" aria-label="编辑消息" title="编辑消息"><Pencil size={14} aria-hidden="true" /></ActionBarPrimitive.Edit>
            </ActionBarPrimitive.Root>
          </>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}
