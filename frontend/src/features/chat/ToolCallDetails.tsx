import { useId, useState } from "react";
import { ChevronDown, FileText, Search, TriangleAlert, Wrench } from "lucide-react";
import { eventDuration, formatExecutionTime, toolCallDetails, type RunEvent } from "./tool-call-details";

export function ToolCallDetails({ event, title, streaming, stopping = false, now, onInspect }: {
  event: RunEvent; title: string; streaming: boolean; stopping?: boolean; now: number; onInspect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const running = streaming && event.status === "running";
  const failed = event.status === "failed" || event.status === "blocked";
  const Icon = failed ? TriangleAlert : ["search_public_web", "search_library", "research_company"].includes(event.tool_name)
    ? Search : event.tool_name === "get_library_context" ? FileText : Wrench;
  const duration = eventDuration(event, running, now);
  return <div className="tool-call-record" data-tool-call={event.tool_call_id}>
    <button type="button" className={`run-process-tool tool-call-toggle${failed ? " is-failed" : ""}`}
      aria-expanded={open} aria-controls={bodyId} aria-label={`${open ? "收起" : "展开"}${title}的执行说明`}
      onClick={() => { onInspect(); setOpen(value => !value); }}>
      <Icon size={16} aria-hidden="true" />
      <span className={running && !stopping ? "is-current-execution" : undefined}>{title}</span>
      <small><time>{duration === null ? "未记录" : `${running ? "已用 " : ""}${formatExecutionTime(duration)}`}</time><ChevronDown size={13} aria-hidden="true" /></small>
    </button>
    <div id={bodyId} className="tool-call-detail" hidden={!open}>
      {open ? toolCallDetails(event, running).map((item, index) => <p key={index}>{item.label ? `${item.label}：` : ""}{item.text}</p>) : null}
    </div>
  </div>;
}
