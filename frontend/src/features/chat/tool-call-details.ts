import type { AgentRunResult } from "./types";

export type RunEvent = AgentRunResult["events"][number];
type Detail = { label?: string; text: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit = 200) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const list = (value: unknown) => Array.isArray(value) ? value.map(object) : [];

export function formatExecutionTime(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

export function eventDuration(event: RunEvent, running: boolean, now: number): number | null {
  const data = event.data ?? {};
  const duration = event.duration_ms ?? data.duration_ms;
  if (!running && typeof duration === "number" && Number.isFinite(duration) && duration >= 0) return duration;
  const start = Date.parse(String(event.started_at ?? data.started_at ?? ""));
  const end = running ? now : Date.parse(String(event.completed_at ?? data.completed_at ?? ""));
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

/** Project known user-facing fields only; never render a raw tool payload. */
export function toolCallDetails(event: RunEvent, running: boolean): Detail[] {
  const data = event.data ?? {};
  const args = object(data.arguments);
  const details: Detail[] = [];
  const query = text(data.query ?? args.query ?? args.company_name);
  if (["search_public_web", "research_company", "search_library"].includes(event.tool_name) && query) {
    details.push({ label: "检索", text: query });
  }
  if (event.status === "failed" || event.status === "blocked") {
    return [...details, { label: "原因", text: text(event.message, 300) || "本次调用未记录失败原因。" }];
  }
  if (running) return details;
  if (event.status === "running") return details;
  if (event.tool_name === "search_public_web" || event.tool_name === "research_company") {
    const sources = list(data.sources);
    const count = typeof data.source_count === "number" && Number.isFinite(data.source_count) && data.source_count >= 0 ? data.source_count : Array.isArray(data.sources) ? sources.length : null;
    const titles = sources.slice(0, 3).map(item => text(item.title, 80)).filter(Boolean);
    if (count !== null) details.push({ text: `找到 ${count} 条公开来源${titles.length ? `：${titles.join("；")}` : "。"}` });
  } else if (event.tool_name === "get_library_context") {
    if (data.disabled === true) details.push({ text: "知识库读取已关闭。" });
    else if (Array.isArray(data.sources) || Array.isArray(data.confirmed_facts)) {
      const sources = list(data.sources);
      const titles = sources.slice(0, 3).map(item => text(item.title, 60)).filter(Boolean);
      const counts = [Array.isArray(data.sources) ? `${sources.length} 份资料` : "", Array.isArray(data.confirmed_facts) ? `${data.confirmed_facts.length} 条已确认知识` : ""].filter(Boolean);
      details.push({ text: `已读取 ${counts.join("、")}${titles.length ? `：${titles.join("；")}` : "。"}` });
    }
  } else if (event.tool_name === "search_library") {
    if (data.disabled === true) details.push({ text: "知识库读取已关闭。" });
    else if (Array.isArray(data.excerpts) || Array.isArray(data.facts)) {
      const excerpts = list(data.excerpts), facts = list(data.facts);
      const titles = [...new Set(excerpts.map(item => text(item.title, 60)).filter(Boolean))].slice(0, 3);
      details.push({ text: `找到 ${excerpts.length + facts.length} 条相关资料${titles.length ? `：${titles.join("；")}` : "。"}` });
    }
  } else if (event.tool_name === "agent_planner") {
    const steps = list(object(data.plan).steps).map(step => text(step.title, 80)).filter(Boolean).slice(0, 5);
    if (steps.length) details.push({ text: steps.join(" → ") });
  } else if (event.tool_name === "propose_library_knowledge") {
    const statements = list(data.proposals).map(item => text(item.statement, 150)).filter(Boolean).slice(0, 3);
    if (statements.length) details.push({ text: statements.join("；") });
  } else if (["citation_validator", "completion_validator", "image_generation"].includes(event.tool_name)) {
    const summary = text(data.summary);
    if (summary) details.push({ text: summary });
  }
  return details;
}
