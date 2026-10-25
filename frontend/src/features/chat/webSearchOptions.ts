import type { ChatMessage, WebSearchOptions, WebSearchSourcePreference, WebSearchTopic } from "./types";
import type { AgentCapabilities } from "../../types";

export const webSearchTopicLabels: Record<WebSearchTopic, string> = { auto: "自动", general: "通用", news: "新闻", finance: "金融" };
export function webSearchConfigurationIssue(options: WebSearchOptions, capabilities?: AgentCapabilities["web_research"]): string {
  if (!options.enabled) return "";
  if (!capabilities?.supported_topics) return "尚未读取搜索服务能力，请重试";
  if (!capabilities.enabled) return "联网搜索尚未启用，请配置搜索服务";
  if (!capabilities.supported_topics.includes(options.topic)) return `当前搜索服务不支持${webSearchTopicLabels[options.topic]}类别，请修改搜索类别`;
  if (options.source_preference === "technical" && capabilities.supports_technical_preference !== true) return "当前搜索服务不支持优先技术资料，请改为不限来源";
  return "";
}
export function defaultWebSearchOptions(): WebSearchOptions {
  return { version: 1, enabled: false, topic: "auto", source_preference: "none" };
}
export function isWebSearchTopic(value: unknown): value is WebSearchTopic {
  return value === "auto" || value === "general" || value === "news" || value === "finance";
}
export function isWebSearchSourcePreference(value: unknown): value is WebSearchSourcePreference {
  return value === "none" || value === "technical";
}
/** Read old records without rewriting them or inventing permission to search. */
export function webSearchOptionsFromMessage(message?: ChatMessage): WebSearchOptions {
  const payload = message?.payload;
  const stored = payload?.web_search_options;
  if (stored && typeof stored === "object" && !Array.isArray(stored) && Object.keys(stored).every((key) => ["version", "enabled", "topic", "source_preference", "provider"].includes(key))
    && stored.version === 1 && typeof stored.enabled === "boolean" && isWebSearchTopic(stored.topic) && isWebSearchSourcePreference(stored.source_preference)
    && (stored.provider === undefined || stored.provider === null || stored.provider === "tavily" || stored.provider === "agent_search")) {
    return { version: 1, enabled: stored.enabled, topic: stored.topic, source_preference: stored.source_preference,
      ...(typeof stored.provider === "string" ? { provider: stored.provider } : {}) };
  }
  if (payload && "web_search_options" in payload) return defaultWebSearchOptions();
  if (payload && (("web_search_topic" in payload && !isWebSearchTopic(payload.web_search_topic)) || ("web_search_source_preference" in payload && !isWebSearchSourcePreference(payload.web_search_source_preference)))) return defaultWebSearchOptions();
  const legacy = payload?.web_search_mode;
  if (legacy != null && legacy !== "auto" && legacy !== "general" && legacy !== "technical") return defaultWebSearchOptions();
  return { version: 1, enabled: payload?.web_search === true,
    topic: isWebSearchTopic(payload?.web_search_topic) ? payload.web_search_topic : legacy === "technical" || legacy === "general" ? "general" : "auto",
    source_preference: isWebSearchSourcePreference(payload?.web_search_source_preference) ? payload.web_search_source_preference : legacy === "technical" ? "technical" : "none" };
}
export function pendingWebSearchOptions(messages: ChatMessage[]): WebSearchOptions | null {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || last.payload?.agent?.status !== "waiting_user") return null;
  return webSearchOptionsFromMessage([...messages.slice(0, -1)].reverse().find((message) => message.role === "user"));
}
