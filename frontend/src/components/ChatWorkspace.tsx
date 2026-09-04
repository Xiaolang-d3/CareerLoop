import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type ComponentPropsWithoutRef, type DragEvent, type ReactNode, type RefObject } from "react";
import type { Conversation } from "../types";
import { ConversationHistoryPanel } from "./ConversationHistoryPanel";
import { ChatWorkspaceMermaid } from "./ChatWorkspaceMermaid";
import { ChatWorkspaceMindmap } from "./ChatWorkspaceMindmap";
import { isMermaidMindmap } from "./mindmap-source";
import "./ChatWorkspace.css";
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
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleHelp,
  Copy,
  ChevronDown,
  FileText,
  History,
  ImagePlus,
  LoaderCircle,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Square,
  TriangleAlert,
  X
} from "lucide-react";

export type AgentRunResult = {
  provider: string;
  platform: string;
  rounds: number;
  status: "done" | "failed" | "waiting_user" | "cancelled";
  stop_reason?: string;
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
  webSearchMode: WebSearchMode;
};

export type WebSearchMode = "auto" | "technical" | "general";

export type ChatClarificationOption = {
  id: string;
  label: string;
  send: string;
};

export type ChatClarification = {
  question: string;
  options: ChatClarificationOption[];
  allowCustom: boolean;
};

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

export type ChatSessionContext = {
  resumeLabel?: string | null;
  analysisLabel?: string | null;
};

const STARTER_PROMPTS: Array<{
  draft: string;
  title: string;
  needsResume?: boolean;
  enableWebSearch?: boolean;
}> = [
  { draft: "帮我梳理已保存的资料，先总结重点，再指出还缺什么。", title: "梳理已保存资料", needsResume: true },
  { draft: "帮我分析这份材料，先总结重点，再指出值得继续追问的地方。", title: "分析一份材料" },
  { draft: "帮我查找并核对这个主题的公开信息：", title: "查找公开信息", enableWebSearch: true },
  { draft: "根据我的要求起草一份内容。用途、读者和要点是：", title: "起草一份内容" }
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
  onSend: (content: string, attachmentIds?: string[], visionAttachmentIds?: string[], webSearch?: boolean, webSearchMode?: WebSearchMode) => Promise<void>;
  onStop: () => Promise<void>;
  onEdit: (userMessageId: number, content: string) => Promise<void>;
  onRegenerate: (userMessageId: number) => Promise<void>;
  sessionContext?: ChatSessionContext;
  onOpenResume?: () => void;
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
  const cancelled = run.status === "cancelled";
  if (!failed && !cancelled) return null;
  const profileRequired = run.error?.code === "profile_required";
  const failureHint = profileRequired
    ? "说“开始画像访谈”，我会创建画像并开始补充信息。"
    : run.error?.retryable === false
      ? "请先检查设置或输入后再继续。"
      : "可以修改输入或直接点击下方重试。";
  return (
    <div className={`agent-result-note ${cancelled ? "cancelled" : "failed"}`}>
      {failed ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}
      <span>
        <strong>{cancelled ? "任务已结束" : profileRequired ? "还需要先建立画像" : "执行已终止"}</strong>
        {run.error?.message ? <small>{run.error.message}</small> : null}
        {failed ? <small>{failureHint}</small> : null}
      </span>
    </div>
  );
}

type WebSource = {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
  content?: string;
  published_at?: string;
};

function webSourcesFromAgent(agent?: AgentRunResult): WebSource[] {
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

const ResearchPanelActionsContext = createContext<ResearchPanelActions | null>(null);

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
  const child = renderedChildren.length === 1 && isValidElement<{ className?: string }>(renderedChildren[0])
    ? renderedChildren[0]
    : null;
  const containsMermaid = child?.props.className?.split(/\s+/).includes("language-mermaid");
  return containsMermaid ? children : <pre {...props}>{children}</pre>;
}

const INTERVIEW_QUESTION_RE = /^(Q\d+)\s*[|｜]\s*(.+)$/s;
const INTERVIEW_HINT_RE = /^(Hint|提示)\s*[:：]\s*(.+)$/s;
const INTERVIEW_FOLLOWUP_RE = /^(追问|跟进|继续问)\s*[:：]\s*(.+)$/s;
const INTERVIEW_DRILL_RE = /(?:^|\n)(?:\*\*)?Q\d+\s*[|｜]|(?:^|\n)(?:\*\*)?(?:Hint|提示)\s*[:：]/;

export function interviewQuestionParts(text: string): { index: string; title: string } | null {
  const match = INTERVIEW_QUESTION_RE.exec(text.trim());
  return match ? { index: match[1], title: match[2].trim() } : null;
}

export function interviewHintParts(text: string): { label: string; body: string } | null {
  const match = INTERVIEW_HINT_RE.exec(text.trim());
  return match ? { label: match[1], body: match[2].trim() } : null;
}

function InterviewQuestionStem({
  index,
  title,
  as: Tag = "p"
}: {
  index: string;
  title: string;
  as?: "p" | "h2" | "h3";
}) {
  return (
    <Tag className="interview-question-stem">
      <span className="interview-question-index">{index}</span>
      <strong>{title}</strong>
    </Tag>
  );
}

function MarkdownParagraph({
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"p"> & ExtraProps) {
  const text = childrenToText(children);
  const question = interviewQuestionParts(text);
  if (question) {
    return <InterviewQuestionStem index={question.index} title={question.title} />;
  }
  const hint = interviewHintParts(text);
  if (hint) {
    return (
      <aside className="interview-hint">
        <span className="interview-hint-label">{hint.label}</span>
        <p>{hint.body}</p>
      </aside>
    );
  }
  const followup = INTERVIEW_FOLLOWUP_RE.exec(text.trim());
  if (followup) {
    return (
      <p className="interview-followup" {...props}>
        <span className="interview-followup-label">{followup[1]}</span>
        {followup[2]}
      </p>
    );
  }
  return <p {...props}>{children}</p>;
}

function MarkdownHeading({
  children,
  node,
  ...props
}: ComponentPropsWithoutRef<"h2"> & ExtraProps) {
  const text = childrenToText(children);
  const question = interviewQuestionParts(text);
  const Tag = node?.tagName === "h3" ? "h3" : "h2";
  if (question) {
    return <InterviewQuestionStem as={Tag} index={question.index} title={question.title} />;
  }
  return <Tag {...props}>{children}</Tag>;
}

const MARKDOWN_COMPONENTS: Components = {
  a: MarkdownLinkRenderer,
  code: MarkdownCodeRenderer,
  pre: MarkdownPreRenderer,
  p: MarkdownParagraph,
  h2: MarkdownHeading,
  h3: MarkdownHeading
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
  const projectAnalysisAnswer = /(项目(?:经历|经验|解析|背景|亮点)|技术深度|证据完整度|简历版|面试版)/.test(children);
  const interviewDrill = INTERVIEW_DRILL_RE.test(children);
  return (
    <div className={`message-markdown${projectAnalysisAnswer ? " project-analysis-answer" : ""}${interviewDrill ? " interview-drill" : ""}`}>
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

const STREAMING_THINKING_TITLE = "正在整理要点";
const GENERIC_TASK_MESSAGE = /^(?:正在执行(?:\s+\S+)?|running|in progress)$/i;
const ROUTE_SUMMARY_MESSAGE = /^已识别为/;
const SYSTEM_THINKING_TOOLS = new Set([
  "agent_thinking",
  "agent_planner",
  "model_provider",
  "completion_validator",
  "citation_validator",
  "agent_loop_guard"
]);
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  search_public_web: "正在检索公开资料",
  research_company: "正在检索公司资料",
  search_resume_evidence: "正在读取简历",
  get_candidate_context: "正在读取画像",
  search_candidate_evidence: "正在检索经历证据",
  analyze_resume_against_jd: "正在对比简历与岗位",
  generate_tailored_resume_content: "正在整理简历要点",
  generate_interview_advice: "正在准备面试建议",
  generate_candidate_material: "正在整理求职材料",
  analyze_job_against_strategy: "正在评估岗位匹配",
  create_job_evaluation: "正在生成岗位评估",
  get_job_evaluation: "正在读取岗位评估",
  review_job_evaluation: "正在审核岗位评估",
  compare_job_evaluations: "正在比较岗位评估",
  propose_candidate_knowledge: "正在补充候选人信息",
  start_profile_interview: "正在开始画像访谈",
  record_profile_interview_answer: "正在记录访谈回答",
  pause_profile_interview: "正在暂停画像访谈",
  record_interview_debrief: "正在记录面试复盘",
  agent_thinking: STREAMING_THINKING_TITLE,
  agent_planner: "正在规划步骤",
  model_provider: "正在生成回答",
  completion_validator: "正在补齐必要步骤",
  citation_validator: "正在核对引用",
  agent_loop_guard: "正在纠正重复步骤",
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

function thinkingHeaderCopy(agent: AgentRunResult | undefined, streaming: boolean): { title: string; currentTask?: string } {
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

function ComposerClarification({
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

function StarterPromptList({
  onFill,
  hasResume
}: {
  onFill: (draft: string, enableWebSearch?: boolean) => void;
  hasResume: boolean;
}) {
  const prompts = STARTER_PROMPTS.filter((item) => !item.needsResume || hasResume);
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

function ChatContextChips({
  context,
  onOpenResume
}: {
  context?: ChatSessionContext;
  onOpenResume?: () => void;
}) {
  const resumeLabel = context?.resumeLabel?.trim();
  const analysisLabel = context?.analysisLabel?.trim();
  if (!resumeLabel && !analysisLabel) return null;
  return (
    <span className="composer-context-hint">
      {resumeLabel ? (
        <button
          type="button"
          className="composer-context-status is-resume"
          onClick={onOpenResume}
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

function ResearchPanel({
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
    if (!open || typeof window === "undefined" || window.innerWidth > 820) return;
    closeButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setExpandedStep(null);
  }, [agent]);

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

      <div className="research-panel-scroll">
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

        <section className="research-section research-sources" aria-labelledby="research-sources-title">
          <div className="research-section-heading">
            <span>引用</span>
            <small>{sources.length ? `${sources.length} 个来源` : "暂无来源"}</small>
          </div>
          <h2 id="research-sources-title">用于回答的公开资料</h2>
          {sources.length ? (
            <>
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
                        <strong>{source.title}</strong>
                        <small>{sourceDomain(source)}</small>
                      </span>
                      <em className={`is-${confidence}`}>{confidence === "high" ? "高可信" : "待核验"}</em>
                    </button>
                  );
                })}
              </div>
              {activeSource ? (
                <article className="research-source-detail" aria-label={`来源详情：${activeSource.title}`}>
                  <div>
                    <span>来源 {Math.min(selectedSource, sources.length - 1) + 1}</span>
                    <a href={activeSource.url} target="_blank" rel="noreferrer">打开原网页<ArrowUpRight size={13} /></a>
                  </div>
                  <strong>{activeSource.title}</strong>
                  {activeSource.published_at ? <small>{activeSource.published_at}</small> : null}
                  <p>{sourceDisplaySummary(activeSource)}</p>
                </article>
              ) : null}
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

function ChatTurn({ state, chatBusy }: { state: MessageState; chatBusy: boolean }) {
  const researchPanel = useContext(ResearchPanelActionsContext);
  const source = state.metadata.custom.source as ChatMessage | undefined;
  if (!source) return null;
  const isCopied = "isCopied" in state && Boolean(state.isCopied);
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
              <ActionBarPrimitive.Copy aria-label="复制回答">
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
                {isCopied ? "已复制" : "复制"}
              </ActionBarPrimitive.Copy>
              <ActionBarPrimitive.Reload aria-label={failed ? "重试回答" : "重新生成回答"}>
                <RefreshCw size={12} />{failed ? "重试" : "重新生成"}
              </ActionBarPrimitive.Reload>
            </ActionBarPrimitive.Root>
            <WebSourcesPanel sources={webSources} onOpen={() => openResearch()} />
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
  webSearchMode: WebSearchMode;
  onToggleWebSearch: () => void;
  onWebSearchModeChange: (mode: WebSearchMode) => void;
};

function ChatWorkspaceContent(props: ChatWorkspaceContentProps) {
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const researchToggleRef = useRef<HTMLButtonElement>(null);
  const aui = useAui();
  const placeholderThinking = thinkingHeaderCopy(props.latestAgent, true);
  const clarification = clarificationFromAgent(props.latestAgent);
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false);
  const [expandedPreview, setExpandedPreview] = useState<{ filename: string; url: string } | null>(null);
  const [conversationListOpen, setConversationListOpen] = useState(false);
  const [researchPanelOpen, setResearchPanelOpen] = useState(false);
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
    setConversationListOpen(false);
    setResearchSelection({ agent, sources, selectedSource });
    setResearchPanelOpen(true);
  }

  function closeResearchDetails(restoreFocus = true) {
    setResearchPanelOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => researchToggleRef.current?.focus());
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

  useEffect(() => {
    setExpandedPreview(null);
    setConversationListOpen(false);
    setResearchPanelOpen(false);
    setResearchSelection(null);
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
    <section className={`chat-workspace ${props.messages.length ? "has-history" : "is-empty"} ${props.chatBusy ? "is-running" : ""} ${researchPanelOpen ? "has-research-panel" : ""}`}>
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
              <Plus size={16} />
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
              <History size={16} />
            </button>
          </div>
        </header>
        <ThreadPrimitive.Viewport className="chat-thread" role="log" aria-live="polite" aria-relevant="additions">
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

          {props.chatBusy && !props.messages.some((message) => message.id < 0 && message.role === "assistant") ? (
            <article className="message assistant is-loading">
              <div className="message-content thinking-state">
                <div className="thinking-indicator">
                  <LoaderCircle size={14} />
                  <span className="thinking-indicator-copy">
                    <strong><span className="thinking-process-title">{placeholderThinking.title}</span></strong>
                    {placeholderThinking.currentTask ? (
                      <small className="thinking-process-current" title={placeholderThinking.currentTask}>{placeholderThinking.currentTask}</small>
                    ) : null}
                  </span>
                  <span className="thinking-dots"><i /><i /><i /></span>
                </div>
              </div>
            </article>
          ) : null}
          <div ref={props.chatEndRef} />
        </ThreadPrimitive.Viewport>

        <div className="chat-composer">
          {props.messages.length === 0 ? (
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

          {props.retryDraft && !props.chatBusy ? (
            <section className="chat-retry-prompt" aria-label="消息发送失败">
              <TriangleAlert size={14} /><span>上一条消息未发送成功</span>
              <button onClick={() => {
                const draft = props.retryDraft;
                if (draft) void props.onSend(draft.content, draft.attachmentIds, draft.visionAttachmentIds, draft.webSearch, draft.webSearchMode);
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
                placeholder={clarification ? "回答上面的问题，或直接说下一件…" : "描述任务，或添加一份资料…"}
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
                  <ChatContextChips context={props.sessionContext} onOpenResume={props.onOpenResume} />
                </div>
                {props.chatBusy ? (
                  <ComposerPrimitive.Cancel className="send-button stop-button" disabled={props.taskCancelBusy} aria-label="停止">
                    <Square size={14} fill="currentColor" /><span>停止</span>
                  </ComposerPrimitive.Cancel>
                ) : (
                  <ComposerPrimitive.Send className="send-button" aria-label="发送">
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
          {showStarters ? (
            <StarterPromptList
              onFill={fillComposer}
              hasResume={Boolean(props.sessionContext?.resumeLabel?.trim())}
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
          webSearchMode,
        );
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
