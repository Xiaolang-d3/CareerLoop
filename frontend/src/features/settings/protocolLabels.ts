import type { ModelProtocol, ReasoningEffort, ResolvedModelProtocol } from "../../types";

export const PROTOCOL_LABELS: Record<ResolvedModelProtocol, string> = {
  openai: "OpenAI 兼容 Chat Completions",
  responses: "OpenAI Responses API",
  anthropic: "Anthropic Messages API",
  gemini: "Google Gemini generateContent",
  ollama: "Ollama Chat API"
};

/** Label for a saved connection: explicit protocol, or what auto mode actually uses. */
export function connectionProtocolLabel(configured: ModelProtocol, detected?: ResolvedModelProtocol | null) {
  if (configured !== "auto") return PROTOCOL_LABELS[configured];
  return detected ? `自动 · 实际使用 ${PROTOCOL_LABELS[detected]}` : "自动匹配";
}

export const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffort | ""; label: string }> = [
  { value: "", label: "默认" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" }
];
