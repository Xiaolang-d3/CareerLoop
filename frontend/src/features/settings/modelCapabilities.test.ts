import { describe, expect, it } from "vitest";
import type { ProfileCapabilityReport } from "../../types";
import { formatContextTokens, formatUsd, reasoningEffortHint } from "./modelCapabilities";

function report(status: "supported" | "unsupported" | "unknown", source: "litellm" | "user" = "litellm") {
  return { capabilities: { reasoning: { status, source } } } as unknown as ProfileCapabilityReport;
}

describe("model capability helpers", () => {
  it("formats context lengths and costs compactly", () => {
    expect(formatContextTokens(128000)).toBe("128K");
    expect(formatContextTokens(1048576)).toBe("1M");
    expect(formatContextTokens(2_000_000)).toBe("2M");
    expect(formatContextTokens(null)).toBe("未知");
    expect(formatUsd(0.000126)).toBe("$0.0001");
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(null)).toBe("—");
  });

  it("explains reasoning effort from the merged capability source", () => {
    expect(reasoningEffortHint(null)).toContain("所有协议");
    expect(reasoningEffortHint(report("supported"))).toContain("LiteLLM");
    expect(reasoningEffortHint(report("unsupported", "user"))).toContain("手动");
    expect(reasoningEffortHint(report("unsupported"))).toContain("不会生效");
  });
});
