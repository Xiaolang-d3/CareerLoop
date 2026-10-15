import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Globe, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { AgentCapabilities } from "../../types";
import type { WebSearchOptions, WebSearchSourcePreference, WebSearchTopic } from "./types";
import { webSearchConfigurationIssue, webSearchTopicLabels } from "./webSearchOptions";

type Props = {
  options: WebSearchOptions;
  capabilities?: AgentCapabilities["web_research"];
  available: boolean;
  provider?: string;
  busy: boolean;
  capabilitiesBusy?: boolean;
  capabilitiesError?: string;
  inherited?: boolean;
  onChange: (options: WebSearchOptions) => void;
  onRefresh?: () => Promise<unknown>;
};
const descriptions: Record<WebSearchTopic, string> = {
  auto: "按问题自动选择类别", general: "网页、产品与公司资料", news: "新闻、行业事件与最新发布", finance: "财经与市场信息"
};
export function ComposerWebSearch(props: Props) {
  const { options, capabilities, busy } = props;
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [position, setPosition] = useState({ left: 12, bottom: 60, width: 276, maxHeight: 480 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const known = Boolean(capabilities?.supported_topics);
  const provider = props.provider === "tavily" ? "Tavily" : props.provider === "agent_search" ? "AgentSearch" : "搜索服务";
  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => { if (busy || !options.enabled) setOpen(false); }, [busy, options.enabled]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(276, window.innerWidth - 24);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), bottom: window.innerHeight - rect.top + 8,
        width, maxHeight: Math.max(120, Math.min(560, rect.top - 24)) });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]:not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true });
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  function chooseTopic(topic: WebSearchTopic) { props.onChange({ ...options, topic }); close(); }
  function choosePreference(source_preference: WebSearchSourcePreference) { props.onChange({ ...options, source_preference }); close(); }
  const issue = webSearchConfigurationIssue(options, capabilities);
  return <div ref={root} className={`composer-web-search${options.enabled ? " is-active" : ""}`} onKeyDown={onKeyDown}>
    <button type="button" className={`composer-tool web-search-toggle${options.enabled ? " active" : ""}${!props.available ? " unavailable" : ""}`} disabled={busy}
      aria-label="联网搜索" aria-pressed={options.enabled} onClick={() => { props.onChange({ ...options, enabled: !options.enabled }); setOpen(false); }}
      title={props.available ? `允许按需联网搜索公开信息${props.inherited ? "；沿用待确认任务设置，可修改" : ""}` : "开启后请读取能力并配置搜索服务"}>
      <Globe size={16} aria-hidden="true" /><span>联网</span>
    </button>
    {options.enabled ? <>
      <span className="web-search-separator" aria-hidden="true">·</span>
      <button ref={trigger} type="button" className="web-search-category" aria-label="搜索类别" aria-haspopup="dialog" aria-expanded={open} disabled={busy}
        title={issue || `搜索类别：${webSearchTopicLabels[options.topic]}${options.source_preference === "technical" ? "，优先技术资料" : ""}`}
        onClick={() => { setSettings(false); setOpen((value) => !value); }}>
        <span>{webSearchTopicLabels[options.topic]}</span><ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? createPortal(<div ref={popup} className="web-search-popover" style={{ position: "fixed", ...position }} role="dialog" aria-label="联网搜索设置">
        <div className="web-search-popover-heading"><strong>搜索类别</strong><small>{provider}</small></div>
        {!known || props.capabilitiesError ? <div className="web-search-capability-note">
          <span>{props.capabilitiesError || "搜索能力尚未读取，类别暂不可选"}</span>
          {props.onRefresh ? <button type="button" disabled={props.capabilitiesBusy} onClick={() => void props.onRefresh?.()}><RefreshCw size={12} />{props.capabilitiesBusy ? "读取中…" : "重试读取"}</button> : null}
        </div> : null}
        <div role="radiogroup" aria-label="选择搜索类别">
          {(["auto", "general", "news", "finance"] as const).map((topic) => {
            const supported = capabilities?.enabled === true && capabilities.supported_topics?.includes(topic) === true;
            const reason = !known ? "能力尚未确认" : !capabilities?.enabled ? "搜索服务未启用" : !supported ? `${provider} 暂不支持` : descriptions[topic];
            return <button type="button" key={topic} role="radio" aria-checked={options.topic === topic} disabled={!supported} onClick={() => chooseTopic(topic)} title={reason}>
              <span><strong>{webSearchTopicLabels[topic]}</strong><small>{reason}</small></span>{options.topic === topic ? <Check size={14} /> : null}
            </button>;
          })}
        </div>
        <button type="button" className="web-search-settings-toggle" aria-expanded={settings} onClick={() => setSettings((value) => !value)}><SlidersHorizontal size={14} />搜索设置<ChevronDown size={12} /></button>
        {settings ? <div className="web-search-source-settings" role="radiogroup" aria-label="来源偏好">
          <p>来源偏好</p>
          <button type="button" role="radio" aria-checked={options.source_preference === "none"} onClick={() => choosePreference("none")}><span><strong>不限来源</strong><small>搜索所有相关公开网页</small></span>{options.source_preference === "none" ? <Check size={14} /> : null}</button>
          <button type="button" role="radio" aria-checked={options.source_preference === "technical"} disabled={capabilities?.enabled !== true || capabilities.supports_technical_preference !== true} onClick={() => choosePreference("technical")}>
            <span><strong>优先技术资料</strong><small>{capabilities?.supports_technical_preference === true ? "偏好开发资料，也包含其他相关网站" : `${known ? provider : "当前服务"} 暂不支持技术来源偏好`}</small></span>{options.source_preference === "technical" ? <Check size={14} /> : null}
          </button>
        </div> : null}
        <p className="web-search-approval-note">开启后智能体可按需发起搜索；与本地资料混用的任务会在发送每条查询前先向你确认。</p>
        {props.inherited ? <p className="web-search-inherited">沿用待确认任务的联网设置；修改后按新配置执行。</p> : null}
        {issue && known ? <p className="web-search-capability-note">{issue}</p> : null}
      </div>, document.body) : null}
    </> : null}
  </div>;
}
