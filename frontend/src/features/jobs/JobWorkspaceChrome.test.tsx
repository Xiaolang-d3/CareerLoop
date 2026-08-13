import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobStageNav } from "./JobWorkspaceChrome";

describe("JobStageNav", () => {
  it("shows the user-facing job agent workflow", () => {
    render(
      <JobStageNav
        activeStage="analysis"
        analysis={null}
        resumeVersions={[]}
        interviewKits={[]}
        interviewRounds={[]}
        timeline={[]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole("navigation", { name: "岗位工作流" })).toBeInTheDocument();
    for (const stage of ["匹配分析", "定制简历", "面试准备"]) {
      expect(screen.getByRole("button", { name: stage })).toBeInTheDocument();
    }
  });
});
