import type { AgentRunResult, WebSearchSourcePreference, WebSearchTopic } from "./types";
import { isWebSearchSourcePreference, isWebSearchTopic } from "./webSearchOptions";

export type SearchMetadata = {
  provider: string;
  requested_topic: WebSearchTopic;
  sent_topic: string | null;
  effective_topic: string | null;
  source_preference: WebSearchSourcePreference;
  warnings: string[];
};
function resultTopic(value: unknown): string | null {
  return value === "general" || value === "news" || value === "finance" || value === "company" ? value : null;
}
export function searchMetadataFromAgent(agent?: AgentRunResult): SearchMetadata[] {
  return (agent?.events ?? []).flatMap((event) => {
    const raw = event.data?.search_metadata;
    if (event.tool_name !== "search_public_web" || !raw || typeof raw !== "object") return [];
    const data = raw as Record<string, unknown>;
    if (typeof data.provider !== "string" || !isWebSearchTopic(data.requested_topic) || !isWebSearchSourcePreference(data.source_preference)) return [];
    return [{ provider: data.provider, requested_topic: data.requested_topic, sent_topic: resultTopic(data.sent_topic),
      effective_topic: resultTopic(data.effective_topic), source_preference: data.source_preference,
      warnings: Array.isArray(data.warnings) ? data.warnings.filter((warning): warning is string => typeof warning === "string") : [] }];
  });
}
