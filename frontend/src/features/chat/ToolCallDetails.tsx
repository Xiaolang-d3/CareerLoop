import { useId, useLayoutEffect, useRef } from "react";
import { ChevronDown, FileText, ListChecks, LoaderCircle, Search, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
import { eventDuration, formatExecutionTime, toolCallDetails, type RunEvent } from "./tool-call-details";

export function ToolCallDetails({ event, title, streaming, stopping = false, now, open, onToggle }: {
  event: RunEvent; title: string; streaming: boolean; stopping?: boolean; now: number; open: boolean; onToggle: () => void;
}) {
  const bodyId = useId();
  const recordRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !recordRef.current) return;
    const record = recordRef.current;
    const viewport = record.closest<HTMLElement>(".run-process-scroll");
    if (!viewport) return;
    const node = record.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
    if (node.height > bounds.height || node.top < bounds.top) viewport.scrollTop += node.top - bounds.top;
    else if (node.bottom > bounds.bottom) viewport.scrollTop += node.bottom - bounds.bottom;
  }, [open]);
  const running = streaming && event.status === "running";
  const failed = event.status === "failed" || event.status === "blocked";
  const Icon = failed ? TriangleAlert : running && !stopping ? LoaderCircle : ["search_public_web", "search_library", "research_company"].includes(event.tool_name)
    ? Search : event.tool_name === "get_library_context" ? FileText : event.tool_name === "agent_planner" ? ListChecks : event.tool_name === "citation_validator" ? ShieldCheck : Wrench;
  const duration = eventDuration(event, running, now);
  const details = toolCallDetails(event, running);
  const summary = <>
    <Icon size={16} className={running && !stopping ? "spinning" : undefined} aria-hidden="true" />
    <span title={title} className={running && !stopping ? "is-current-execution" : undefined}>{title}</span>
    {duration !== null || details.length ? <small>{duration !== null ? <time>{`${running ? "已用 " : ""}${formatExecutionTime(duration)}`}</time> : null}{details.length ? <ChevronDown size={13} aria-hidden="true" /> : null}</small> : null}
  </>;
  if (!details.length) return <div className="tool-call-record" data-tool-call={event.tool_call_id}>
    <div className={`run-process-tool tool-call-toggle is-static${failed ? " is-failed" : ""}`}>{summary}</div>
  </div>;
  return <div ref={recordRef} className="tool-call-record" data-tool-call={event.tool_call_id}>
    <button type="button" className={`run-process-tool tool-call-toggle${failed ? " is-failed" : ""}`}
      aria-expanded={open} aria-controls={bodyId} aria-label={`${open ? "收起" : "展开"}${title}的执行说明`}
      onClick={onToggle}>
      {summary}
    </button>
    <div id={bodyId} className="tool-call-detail" hidden={!open}>
      {open ? details.map((item, index) => <p key={index}>{item.label ? `${item.label}：` : ""}{item.text}</p>) : null}
    </div>
  </div>;
}
