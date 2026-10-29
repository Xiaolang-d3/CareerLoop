import { describe, expect, it } from "vitest";
import { conversationMarkdown, quoteForComposer } from "./conversationActions";
import type { ChatMessage } from "./types";

const message = (id: number, role: ChatMessage["role"], content: string): ChatMessage => ({
  id, role, content, created_at: "2026-10-22T00:00:00Z"
});

describe("conversation text actions", () => {
  it("turns a selected passage into the next question without dropping the draft", () => {
    expect(quoteForComposer("  第一行\n第二行  ", "")).toBe("> 第一行\n> 第二行\n\n针对这段：");
    expect(quoteForComposer("这一段", "已有草稿  ")).toBe("已有草稿\n\n> 这一段\n\n针对这段：");
    expect(quoteForComposer("   ", "保持")).toBe("保持");
  });

  it("exports the whole conversation and skips unsaved placeholders", () => {
    const markdown = conversationMarkdown(" 项目 ", [
      message(3, "user", "问题"),
      message(-1, "assistant", "还在生成"),
      message(4, "assistant", "回答")
    ]);
    expect(markdown).toBe("# 项目\n\n## 你\n\n问题\n\n## 团团\n\n回答\n");
  });
});
