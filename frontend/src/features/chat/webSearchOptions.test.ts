import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./types";
import { pendingWebSearchOptions, webSearchOptionsFromMessage } from "./webSearchOptions";
import { searchMetadataFromAgent } from "./searchMetadata";

const message: ChatMessage = { id: 1, role: "user", content: "查资料", created_at: "2026-10-11T00:00:00Z" };
describe("search configuration compatibility", () => {
  it("converts the old technical mode into a general topic and soft preference", () => {
    expect(webSearchOptionsFromMessage({ ...message, payload: { web_search: true, web_search_mode: "technical" } })).toEqual({ version: 1, enabled: true, topic: "general", source_preference: "technical" });
  });
  it("uses explicit new options before legacy values, including disabling search", () => {
    expect(webSearchOptionsFromMessage({ ...message, payload: { web_search: true, web_search_mode: "technical", web_search_options: { version: 1, enabled: false, topic: "finance", source_preference: "none", provider: "tavily" } } })).toEqual({ version: 1, enabled: false, topic: "finance", source_preference: "none", provider: "tavily" });
    expect(webSearchOptionsFromMessage({ ...message, payload: { web_search: false, web_search_mode: "technical", web_search_topic: "auto", web_search_source_preference: "none" } })).toEqual({ version: 1, enabled: false, topic: "auto", source_preference: "none" });
  });
  it("never assumes search permission for historical messages without saved options", () => {
    expect(webSearchOptionsFromMessage(message).enabled).toBe(false);
    expect(webSearchOptionsFromMessage().enabled).toBe(false);
  });
  it("closes search for an invalid legacy mode even when the old permission is true", () => {
    const invalid = "unknown" as unknown as NonNullable<ChatMessage["payload"]>["web_search_mode"];
    expect(webSearchOptionsFromMessage({ ...message, payload: { web_search: true, web_search_mode: invalid } })).toEqual({ version: 1, enabled: false, topic: "auto", source_preference: "none" });
    expect(webSearchOptionsFromMessage({ ...message, payload: { web_search: true, web_search_mode: invalid, web_search_topic: "news", web_search_source_preference: "none" } }).enabled).toBe(false);
  });
  it("closes search for invalid new snapshots instead of falling back to old permission", () => {
    const invalid = { version: 2, enabled: true, topic: "news", source_preference: "none" } as unknown as NonNullable<ChatMessage["payload"]>["web_search_options"];
    expect(webSearchOptionsFromMessage({ ...message, payload: { web_search: true, web_search_mode: "technical", web_search_options: invalid } })).toEqual({ version: 1, enabled: false, topic: "auto", source_preference: "none" });
    expect(webSearchOptionsFromMessage({ ...message, payload: { web_search: true, web_search_options: { version: 1, enabled: true, topic: "news", source_preference: "none", provider: "unknown_service" } } }).enabled).toBe(false);
  });
  it("inherits only the user turn immediately before the active clarification", () => {
    const pending: ChatMessage = { ...message, id: 2, role: "assistant", payload: { agent: { provider: "test", platform: "local", rounds: 1, status: "waiting_user", events: [] } } };
    expect(pendingWebSearchOptions([{ ...message, payload: { web_search: true, web_search_topic: "news" } }, pending])).toMatchObject({ enabled: true, topic: "news" });
    expect(pendingWebSearchOptions([pending, message])).toBeNull();
  });
});
describe("actual search metadata", () => {
  it("keeps the service topic unknown rather than inferring from request or result titles", () => {
    const metadata = searchMetadataFromAgent({ provider: "test", platform: "local", rounds: 1, status: "done", events: [{ round: 1, tool_call_id: "s1", tool_name: "search_public_web", status: "done", message: "找到新闻", data: { search_metadata: { provider: "tavily", requested_topic: "auto", sent_topic: null, effective_topic: null, source_preference: "none", warnings: ["服务未返回类别", 123] } } }] });
    expect(metadata).toEqual([{ provider: "tavily", requested_topic: "auto", sent_topic: null, effective_topic: null, source_preference: "none", warnings: ["服务未返回类别"] }]);
  });
  it("does not present malformed metadata as confirmed service capabilities", () => {
    expect(searchMetadataFromAgent({ provider: "test", platform: "local", rounds: 1, status: "done", events: [{ round: 1, tool_call_id: "s1", tool_name: "search_public_web", status: "done", message: "", data: { search_metadata: { provider: "tavily", requested_topic: "made_up", source_preference: "none" } } }] })).toEqual([]);
  });
});
