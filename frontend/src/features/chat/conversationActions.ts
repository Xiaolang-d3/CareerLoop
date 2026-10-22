import type { ChatMessage } from "./types";

export function quoteForComposer(selected: string, current: string): string {
  const quote = selected.trim();
  if (!quote) return current;
  const block = `> ${quote.replace(/\n/g, "\n> ")}\n\n针对这段：`;
  const existing = current.replace(/\s+$/, "");
  return existing ? `${existing}\n\n${block}` : block;
}

export function conversationMarkdown(title: string, messages: ChatMessage[]): string {
  const lines = [`# ${title.trim() || "对话"}`, ""];
  for (const message of messages) {
    if (message.id < 0) continue;
    lines.push(message.role === "user" ? "## 你" : "## 灯灯", "", message.content.trim(), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function downloadConversationMarkdown(title: string, messages: ChatMessage[]) {
  const blob = new Blob([conversationMarkdown(title, messages)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safe = (title.trim() || "对话").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 80) || "对话";
  link.href = url;
  link.download = `${safe}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
