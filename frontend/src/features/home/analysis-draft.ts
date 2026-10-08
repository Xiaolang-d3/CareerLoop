import type { Conversation } from "../../types";
import type { FetchJson, HomeReadableItem } from "./types";

export async function createHomeAnalysisConversation(fetchJson: FetchJson, item: HomeReadableItem, signal: AbortSignal): Promise<Conversation> {
  if (signal.aborted) throw new DOMException("已取消资讯分析", "AbortError");
  const conversation = await fetchJson<Conversation>("/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `资讯分析：${item.title.slice(0, 60)}` }),
    signal
  });
  // Desktop transports may finish a request after cancellation; suppress the late result.
  if (signal.aborted) throw new DOMException("已取消资讯分析", "AbortError");
  return conversation;
}

export function homeAnalysisDraft(item: HomeReadableItem): string {
  const title = item.title.trim().slice(0, 120);
  const source = item.source.trim().slice(0, 60);
  const summary = item.summary.trim().slice(0, 420);
  const published = item.published_at || "发布时间未提供";
  let url = "";
  try {
    const parsed = new URL(item.url);
    if (["https:", "http:"].includes(parsed.protocol) && item.url.length <= 500) url = item.url;
  } catch {
    // A missing source link does not turn the provided summary into full text.
  }
  const context = [
    "请分析这条公开资讯与 AI 应用、Agent 开发的关系，概括要点、适用场景和需要核实的问题。",
    "以下是来源元数据与摘要，并非已读取的原文全文；请区分来源事实与推断。",
    "",
    `标题：${title}`,
    `来源：${source}`,
    `发布时间：${published}`,
    ...(url ? [`原文：${url}`] : []),
    "摘要："
  ].join("\n");
  return `${context}\n${summary.slice(0, Math.max(0, 1000 - context.length - 1))}`;
}
