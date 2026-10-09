import { describe, expect, it, vi } from "vitest";
import { createHomeAnalysisConversation, homeAnalysisDraft } from "./analysis-draft";
import type { Conversation } from "../../types";
import type { FetchJson } from "./types";

describe("home analysis draft", () => {
  it("keeps a traceable source and distinguishes a summary from unread full text", () => {
    const draft = homeAnalysisDraft({
      id: "article-1", kind: "article", title: "工具调用实践", summary: "参数验证与失败重试",
      source: "官方工程博客", url: "https://example.com/tools", published_at: null
    });
    expect(draft).toContain("原文：https://example.com/tools");
    expect(draft).toContain("发布时间未提供");
    expect(draft).toContain("并非已读取的原文全文");
    expect(draft).toContain("参数验证与失败重试");
  });

  it("fits the composer limit without cutting a valid source URL", () => {
    const url = `https://example.com/${"a".repeat(300)}`;
    const draft = homeAnalysisDraft({
      id: "long-1", kind: "article", title: "标题".repeat(100), summary: "摘要".repeat(1000),
      source: "来源".repeat(100), url, published_at: "2026-10-08T00:00:00Z"
    });
    expect(draft.length).toBeLessThanOrEqual(1000);
    expect(draft).toContain(url);
  });

  it("excludes executable URL schemes", () => {
    expect(homeAnalysisDraft({
      id: "invalid", kind: "article", title: "文章", summary: "摘要", source: "来源",
      url: "javascript:alert(1)", published_at: null
    })).not.toContain("javascript:");
  });

  it("discards a conversation returned after leaving the account, including transports that ignore abort", async () => {
    let finish!: (conversation: Conversation) => void;
    const fetchJson = vi.fn(() => new Promise<Conversation>((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const request = createHomeAnalysisConversation(fetchJson as FetchJson, {
      id: "article-1", kind: "article", title: "Agent 实践", summary: "摘要",
      source: "官方博客", url: "https://example.com/agent", published_at: null
    }, controller.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    finish({ id: 12, title: "资讯分析" } as Conversation);
    await rejection;
    expect(fetchJson).toHaveBeenCalledWith("/conversations", expect.objectContaining({ signal: controller.signal }));
  });
});
