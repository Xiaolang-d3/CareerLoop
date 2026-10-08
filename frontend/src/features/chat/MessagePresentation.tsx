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
import type { AgentRunResult, ChatClarification, ChatMessage, ChatSessionContext } from "./types";
import { Children, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { ChatWorkspaceMermaid } from "../../components/ChatWorkspaceMermaid";
import { ChatWorkspaceMindmap } from "../../components/ChatWorkspaceMindmap";
import { isMermaidMindmap } from "../../components/mindmap-source";
import { ActionBarPrimitive, ComposerPrimitive, MessagePrimitive, type AppendMessage, type MessageState } from "@assistant-ui/react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleHelp, Copy, FileText, ImagePlus, LoaderCircle, PanelRight, Pencil, RefreshCw, Search, TriangleAlert, X } from "lucide-react";

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

function AgentResultNote({ run }: { run?: AgentRunResult }) {
  if (!run?.events.length) return null;
  const failed = run.status === "failed" || run.events.some((event) => event.status === "failed");
  const cancelled = run.status === "cancelled";
  if (!failed && !cancelled) return null;
  const failureHint = run.error?.retryable === false
      ? "请先检查设置或输入后再继续。"
      : "可以修改输入或直接点击下方重试。";
  return (
    <div className={`agent-result-note ${cancelled ? "cancelled" : "failed"}`}>
      {failed ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}
      <span>
        <strong>{cancelled ? "任务已结束" : "执行已终止"}</strong>
        {run.error?.message ? <small>{run.error.message}</small> : null}
        {failed ? <small>{failureHint}</small> : null}
      </span>
    </div>
  );
}

export type WebSource = {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
  content?: string;
  published_at?: string;
};

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

function childrenToText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) return childrenToText(children.props.children);
  return "";
}

function sourceDomain(source: Pick<WebSource, "url" | "domain" | "title">): string {
  return source.domain || source.url.replace(/^https?:\/\//, "").split("/")[0] || source.title;
}

function faviconHost(domain: string): string | null {
  try {
    const host = domain.includes("://") ? new URL(domain).hostname : domain.split("/")[0];
    const normalized = host.replace(/^www\./i, "").toLowerCase();
    return normalized.includes(".") ? normalized : null;
  } catch {
    return null;
  }
}

function SourceFavicon({ domain, title }: { domain: string; title: string }) {
  const host = faviconHost(domain);
  const letter = (domain || title).slice(0, 1).toUpperCase();
  const [failed, setFailed] = useState(false);
  if (host && !failed) {
    return (
      <span className="web-source-icon" aria-hidden="true">
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
          alt=""
          width={16}
          height={16}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return <span className="web-source-icon" aria-hidden="true">{letter}</span>;
}

function canonicalCitationUrl(value: string): string {
  try {
    const parsed = new URL(value.trim());
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function CitationLink({
  href,
  sources,
  children,
  onOpenSource
}: {
  href?: string;
  sources: WebSource[];
  children?: ReactNode;
  onOpenSource?: (index: number) => void;
}) {
  const label = childrenToText(children);
  if (!href || !/^https?:\/\//i.test(href)) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  }
  const index = sources.findIndex((source) => canonicalCitationUrl(source.url) === canonicalCitationUrl(href));
  const source = index >= 0 ? sources[index] : undefined;
  const title = source?.title || label || href;
  const domain = sourceDomain(source ?? { title, url: href });
  const letter = (domain || title).slice(0, 1).toUpperCase();
  const citationNo = index >= 0 ? index + 1 : null;
  return (
    <a
      className="md-citation"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={citationNo ? `来源 ${citationNo}：${title}` : `来源：${title}`}
      onClick={citationNo && onOpenSource ? (event) => {
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        onOpenSource(index);
      } : undefined}
    >
      <span className="md-citation-badge">{citationNo ?? letter}</span>
      <span className="md-citation-card" aria-hidden="true">
        <SourceFavicon domain={domain} title={title} />
        <span className="md-citation-card-copy">
          <strong>{title}</strong>
          <small>{domain}</small>
        </span>
      </span>
    </a>
  );
}

const MarkdownRenderContext = createContext<{ sources: WebSource[]; streaming: boolean; onOpenSource?: (index: number) => void }>({
  sources: [],
  streaming: false
});

function MarkdownLinkRenderer({ children, href }: { children?: ReactNode; href?: string }) {
  const { sources, onOpenSource } = useContext(MarkdownRenderContext);
  return <CitationLink href={href} sources={sources} onOpenSource={onOpenSource}>{children}</CitationLink>;
}

function MarkdownCodeRenderer({
  children,
  className,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"code"> & ExtraProps) {
  const { streaming } = useContext(MarkdownRenderContext);
  if (className?.split(/\s+/).includes("language-mermaid")) {
    const source = childrenToText(children);
    return isMermaidMindmap(source)
      ? <ChatWorkspaceMindmap source={source} streaming={streaming} />
      : <ChatWorkspaceMermaid source={source} streaming={streaming} />;
  }
  return <code className={className} {...props}>{children}</code>;
}

function MarkdownPreRenderer({
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  const renderedChildren = Children.toArray(children);
  const child = renderedChildren.length === 1 && isValidElement<{ className?: string; children?: ReactNode }>(renderedChildren[0])
    ? renderedChildren[0]
    : null;
  const containsMermaid = child?.props.className?.split(/\s+/).includes("language-mermaid");
  const source = childrenToText(child?.props.children ?? children);
  const language = child?.props.className?.match(/language-([\w+-]+)/)?.[1] ?? "代码";
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState("复制");
  useEffect(() => { setCopyState("复制"); }, [source]);
  const { streaming } = useContext(MarkdownRenderContext);
  const long = source.trimEnd().split("\n").length > 24;
  async function copyCode() {
    try { await navigator.clipboard.writeText(source); setCopyState("已复制"); }
    catch { setCopyState("复制失败，请重试"); }
  }
  return containsMermaid ? children : <div className="chat-code-block">
    <div className="chat-code-toolbar"><span>{language}</span><button type="button" onClick={() => void copyCode()}>{copyState}</button></div>
    <pre {...props} className={long && !expanded && !streaming ? "is-collapsed" : undefined}>{children}</pre>
    {long && !streaming ? <button className="chat-code-expand" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起代码" : `展开完整代码（${source.trimEnd().split("\n").length} 行）`}</button> : null}
    <span className="sr-only" role="status">{copyState === "复制" ? "" : copyState}</span>
  </div>;
}

const MARKDOWN_COMPONENTS: Components = {
  a: MarkdownLinkRenderer,
  code: MarkdownCodeRenderer,
  pre: MarkdownPreRenderer,
  table: ({ node: _node, ...props }) => <div className="chat-table-scroll" role="region" aria-label="表格，支持横向滚动" tabIndex={0}><table {...props} /></div>,
};

function MarkdownContent({
  children,
  sources = [],
  streaming = false,
  onOpenSource
}: {
  children: string;
  sources?: WebSource[];
  streaming?: boolean;
  onOpenSource?: (index: number) => void;
}) {
  return (
    <div className="message-markdown">
      <MarkdownRenderContext.Provider value={{ sources, streaming, onOpenSource }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={MARKDOWN_COMPONENTS}
        >
          {children}
        </ReactMarkdown>
      </MarkdownRenderContext.Provider>
    </div>
  );
}

export function EditMessageComposer() {
  return (
    <MessagePrimitive.Root className="message user message-editing">
      <div className="message-content">
        <div className="message-meta"><strong>编辑消息</strong><span>将替换本条消息及后续消息，并重新生成回复</span></div>
        <ComposerPrimitive.Root className="message-edit-composer">
          <ComposerPrimitive.Input rows={3} maxLength={200_000} aria-label="编辑消息" aria-describedby="message-edit-impact" autoFocus />
          <p className="message-edit-impact" id="message-edit-impact">本轮资料与联网选项不会自动沿用；需要时请取消编辑，另发新消息。</p>
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

const SYSTEM_THINKING_TOOLS = new Set([
  "agent_thinking",
  "agent_planner",
  "model_provider",
  "completion_validator",
  "citation_validator",
  "agent_loop_guard",
  "agent_run_state"
]);

const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  search_public_web: "正在检索公开资料",
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

function thoughtSources(events: AgentRunResult["events"]): Array<{ host: string; url?: string; title?: string }> {
  const seen = new Set<string>();
  const sources: Array<{ host: string; url?: string; title?: string }> = [];
  for (const event of events) {
    const items = event.data?.sources;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const host = hostnameFromUnknown(record.domain || record.url);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      const url = typeof record.url === "string" && /^https?:\/\//i.test(record.url) ? record.url : undefined;
      const title = typeof record.title === "string" ? record.title : undefined;
      sources.push({ host, url, title });
    }
  }
  return sources;
}

function clipThoughtLine(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (!line) return "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

function thoughtProcessContent(agent?: AgentRunResult): {
  thoughts: string[];
  steps: Array<{ text: string; status: string }>;
  sources: Array<{ host: string; url?: string; title?: string }>;
} {
  const events = agent?.events ?? [];
  const planSteps = planStepsFromAgent(agent);
  const thoughts = events
    .filter((event) => event.tool_name === "agent_thinking")
    .map((event) => clipThoughtLine(event.message))
    .filter((message) => message && !ROUTE_SUMMARY_MESSAGE.test(message));
  const steps: Array<{ text: string; status: string }> = [];
  const seen = new Set<string>();
  const addStep = (value: string, status: string) => {
    const text = clipThoughtLine(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    steps.push({ text, status });
  };

  for (const event of events) {
    if (event.tool_name === "agent_thinking") continue;
    addStep(workLineFromEvent(event, planSteps), event.status);
  }

  for (const step of planSteps) {
    if (events.some((event) => event.tool_name === step.tool_name && !SYSTEM_THINKING_TOOLS.has(event.tool_name))) {
      continue;
    }
    if (step.status === "pending") continue;
    if (step.status === "running") addStep(`正在进行：${step.title}`, step.status);
    else if (step.status === "done") addStep(`已完成：${step.title}`, step.status);
    else if (step.status === "failed") addStep(`失败：${step.title}`, step.status);
  }

  return { thoughts, steps, sources: thoughtSources(events) };
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

function ThinkingMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.05 12.7A5.55 5.55 0 1 1 11.85 5.7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M12.55 7.05a5.55 5.55 0 0 1 .05 2.2"
        stroke="#6557dc"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M12.4 9.85A5.55 5.55 0 0 1 10.7 12.7"
        stroke="#8B9BFF"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ThinkingSourceChip({ host, url, title }: { host: string; url?: string; title?: string }) {
  const inner = (
    <>
      <SourceFavicon domain={host} title={title || host} />
      <span>{host}</span>
    </>
  );
  if (url) {
    return (
      <a className="thinking-source-chip" href={url} target="_blank" rel="noreferrer" title={title || host}>
        {inner}
      </a>
    );
  }
  return <span className="thinking-source-chip">{inner}</span>;
}

function ThoughtProcess({
  streaming,
  agent,
  onOpen
}: {
  streaming: boolean;
  agent?: AgentRunResult;
  onOpen?: () => void;
}) {
  const { title, currentTask } = thinkingHeaderCopy(agent, streaming);
  const { thoughts, steps, sources } = thoughtProcessContent(agent);
  const hasBody = thoughts.length + steps.length + sources.length > 0;
  if (!hasBody && !streaming) return null;
  const headerCopy = (
    <>
      <span className="thinking-process-icon"><ThinkingMark /></span>
      <span className="thinking-process-copy">
        <strong><span className="thinking-process-title">{title}</span></strong>
        {currentTask ? <small className="thinking-process-current" title={currentTask}>{currentTask}</small> : null}
      </span>
    </>
  );
  return (
    <section className={`thinking-process ${streaming ? "streaming" : "complete"} ${hasBody ? "has-body" : "is-status"}`} aria-label="研究过程">
      {hasBody && onOpen ? (
        <button
          type="button"
          className="thinking-process-header"
          onClick={onOpen}
          aria-label={`${title}，打开研究详情`}
        >
          {headerCopy}
          <PanelRight className="thinking-process-chevron" size={14} />
        </button>
      ) : (
        <div className="thinking-process-header is-static">
          {headerCopy}
        </div>
      )}
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

function researchStepTitle(text: string): string {
  return text.replace(/^(?:正在进行|已完成|失败|正在检索)[:：]\s*/, "").trim() || "处理信息";
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
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const process = thoughtProcessContent(agent);
  const planSteps = planStepsFromAgent(agent);
  const steps = process.steps.length
    ? process.steps
    : planSteps.map((step) => ({ text: step.title, status: step.status }));
  const totalSteps = Math.max(steps.length, sources.length ? 4 : 1);
  const completedSteps = agent?.status === "done"
    ? totalSteps
    : Math.min(totalSteps, steps.filter((step) => step.status === "done").length);
  const progress = Math.max(streaming ? 8 : 0, Math.round((completedSteps / totalSteps) * 100));
  const current = thinkingHeaderCopy(agent, streaming);
  const activeSource = sources[Math.min(selectedSource, Math.max(0, sources.length - 1))];

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    setExpandedStep(null);
  }, [agent]);

  useLayoutEffect(() => {
    if (!open || !sources.length || !sourceSectionRef.current || !panelScrollRef.current) return;
    panelScrollRef.current.scrollTop = sourceSectionRef.current.offsetTop - panelScrollRef.current.offsetTop;
  }, [open, selectedSource, sources.length]);

  if (!open) return null;
  return (
    <aside id="chat-research-panel" className="research-panel" aria-label="研究详情">
      <header className="research-panel-header">
        <div>
          <span className={`research-live-dot${streaming ? " is-live" : ""}`} aria-hidden="true" />
          <strong>{streaming ? current.title : agent?.status === "failed" ? "研究未完成" : "研究详情"}</strong>
          <small>{completedSteps}/{totalSteps}</small>
        </div>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭研究详情" title="关闭研究详情">
          <X size={17} />
        </button>
        <div className="research-progress" aria-label={`研究进度 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className="research-panel-scroll" ref={panelScrollRef}>
        <section className="research-section" aria-labelledby="research-process-title">
          <div className="research-section-heading">
            <span>过程</span>
            <small>{streaming ? "实时更新" : "已完成"}</small>
          </div>
          <h2 id="research-process-title">这次回答是怎样形成的</h2>
          {steps.length ? (
            <ol className="research-process-list">
              {steps.map((step, index) => {
                const expanded = expandedStep === index;
                const status = step.status === "failed" ? "failed" : step.status === "running" ? "running" : "done";
                return (
                  <li key={`${step.text}-${index}`} className={`is-${status}`}>
                    <button type="button" aria-expanded={expanded} onClick={() => setExpandedStep(expanded ? null : index)}>
                      <span className="research-step-state" aria-hidden="true">
                        {status === "done" ? <Check size={12} /> : status === "failed" ? <TriangleAlert size={12} /> : <LoaderCircle size={12} />}
                      </span>
                      <span className="research-step-copy">
                        <strong>{researchStepTitle(step.text)}</strong>
                        <small>{status === "running" ? "进行中" : status === "failed" ? "需要检查" : "已完成"}</small>
                      </span>
                      <ChevronDown size={14} />
                    </button>
                    {expanded ? <p>{step.text}</p> : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="research-empty-state">
              <ThinkingMark size={16} />
              <p>{streaming ? "正在拆解问题并准备下一步。" : "这条回答没有调用外部研究工具。"}</p>
            </div>
          )}
        </section>

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
              <p>开启“联网”后，搜索节点与引用会集中显示在这里。</p>
            </div>
          )}
        </section>
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
  return <><button type="button" aria-label={label} onClick={() => void copy()} disabled={!content}>{feedback === "已复制" ? <Check size={12} /> : <Copy size={12} />}{feedback || "复制"}</button><span className="message-copy-feedback" role="status">{feedback}</span></>;
}

export function ChatTurn({ state, chatBusy }: { state: MessageState; chatBusy: boolean }) {
  const researchPanel = useContext(ResearchPanelActionsContext);
  const source = state.metadata.custom.source as ChatMessage | undefined;
  if (!source) return null;
  const thoughtEvent = source.payload?.agent?.events.find(
    (event) => event.tool_name === "agent_thinking"
  );
  const isActiveAssistant = chatBusy && source.id < 0;
  const resultContent = resultOnlyContent(source.content, Boolean(thoughtEvent?.message));
  const failed = source.payload?.agent?.status === "failed";
  const webSources = webSourcesFromAgent(source.payload?.agent);
  const openResearch = (selectedSource?: number) => {
    researchPanel?.openDetails(source.payload?.agent, webSources, selectedSource);
  };

  return (
    <MessagePrimitive.Root className={`message ${source.role}`}>
      <div className="message-content">
        {source.role === "assistant" ? (
          <>
            <ThoughtProcess streaming={isActiveAssistant} agent={source.payload?.agent} onOpen={() => openResearch()} />
            <section className="message-result message-dialog" aria-label="输出结果">
              <MarkdownContent sources={webSources} streaming={isActiveAssistant} onOpenSource={openResearch}>{resultContent}</MarkdownContent>
              <AgentResultNote run={source.payload?.agent} />
            </section>
            <ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
              <MessageCopyButton content={resultContent} label="复制回答" />
              <ActionBarPrimitive.Reload aria-label={failed ? "重试回答" : "重新生成回答"} title="从本轮开始重新生成，后续消息将被替换" aria-describedby={`regenerate-impact-${source.id}`}>
                <RefreshCw size={12} />{failed ? "重试" : "重新生成"}
              </ActionBarPrimitive.Reload>
            </ActionBarPrimitive.Root>
            {!chatBusy ? <small className="message-action-hint" id={`regenerate-impact-${source.id}`}>重新生成将替换本轮及后续消息</small> : null}
            <WebSourcesPanel sources={webSources} onOpen={() => openResearch()} />
          </>
        ) : (
          <>
            <UserMessageContent content={source.content} />
            {source.payload?.attachments?.length ? (
              <div className="message-attachments" aria-label="本轮已附加资料">
                {source.payload.attachments.map((attachment) => (
                  <span key={attachment.id}>
                    {attachment.kind === "document" ? <FileText size={12} /> : <ImagePlus size={12} />}
                    {attachment.original_filename}
                    {attachment.vision_status === "consented" ? <em>模型看图</em> : null}
                  </span>
                ))}
              </div>
            ) : null}
            <ActionBarPrimitive.Root className="message-actions user-message-actions" hideWhenRunning>
              <MessageCopyButton content={source.content} label="复制消息" />
              <ActionBarPrimitive.Edit aria-label="编辑消息" title="编辑后重发会替换本条及后续消息"><Pencil size={12} />编辑</ActionBarPrimitive.Edit>
            </ActionBarPrimitive.Root>
          </>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}
