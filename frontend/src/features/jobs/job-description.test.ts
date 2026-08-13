import { describe, expect, it } from "vitest";
import { composeJobDescription, splitJobDescription } from "./job-description";

describe("job description composition", () => {
  it("keeps description and requirements as separate sections", () => {
    const combined = composeJobDescription("负责 Agent 产品规划。", "熟悉 Python。");
    expect(combined).toBe("负责 Agent 产品规划。\n\n任职要求\n熟悉 Python。");
    expect(splitJobDescription(combined)).toEqual({
      description: "负责 Agent 产品规划。",
      requirements: "熟悉 Python。"
    });
  });

  it("treats a legacy single blob as description only", () => {
    expect(splitJobDescription("岗位职责：负责需求。要求熟悉 Python。")).toEqual({
      description: "岗位职责：负责需求。要求熟悉 Python。",
      requirements: ""
    });
  });
});
