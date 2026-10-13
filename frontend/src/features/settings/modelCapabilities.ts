import type { ProfileCapabilityName, ProfileCapabilityReport, ProfileCapabilitySource } from "../../types";

export const PROFILE_CAPABILITY_ORDER: ProfileCapabilityName[] = ["vision", "reasoning", "tools", "structured_output", "pdf", "prompt_caching"];

export const CAPABILITY_SOURCE_LABELS: Record<ProfileCapabilitySource, string> = {
  user: "手动",
  probe: "实测",
  litellm: "LiteLLM",
  heuristic: "推测",
  none: "未知"
};

/** 128000 → "128K", 1048576 → "1M". */
export function formatContextTokens(tokens: number | null | undefined) {
  if (!tokens || tokens <= 0) return "未知";
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

export function formatUsd(value: number | null | undefined) {
  if (value == null) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** Whether the reasoning-effort select applies, from merged capability data. */
export function reasoningEffortHint(report: ProfileCapabilityReport | null) {
  const reasoning = report?.capabilities.reasoning;
  if (!reasoning || reasoning.status === "unknown") return "推理强度适用于所有协议；模型不支持时会自动忽略";
  if (reasoning.status === "unsupported") return `该模型不支持推理（来源：${CAPABILITY_SOURCE_LABELS[reasoning.source]}），推理强度不会生效`;
  return `该模型支持推理（来源：${CAPABILITY_SOURCE_LABELS[reasoning.source]}），可调整推理强度`;
}
