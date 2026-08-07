import { describe, expect, it } from "vitest";
import { appRouteHash, initialAppRoute, parseAppHash } from "./routing";

describe("home route", () => {
  it("opens the Agent conversation when no route is specified", () => {
    expect(initialAppRoute("", null)).toEqual({ section: "chat" });
    expect(initialAppRoute("#", "dashboard")).toEqual({ section: "chat" });
  });
});

describe("workbench route hierarchy", () => {
  it("keeps the project index, creation page, and detail page distinct", () => {
    expect(parseAppHash("#/workbench")).toEqual({ section: "workbench", page: "index" });
    expect(parseAppHash("#/workbench/new")).toEqual({ section: "workbench", page: "new" });
    expect(parseAppHash("#/workbench/jobs/42")).toEqual({ section: "workbench", page: "detail", jobId: 42 });
    expect(appRouteHash({ section: "workbench", page: "detail", jobId: 42 })).toBe("#/workbench/jobs/42");
    expect(parseAppHash("#/workbench/jobs/42/evaluation")).toEqual({ section: "workbench", page: "evaluation", jobId: 42 });
    expect(parseAppHash("#/workbench/jobs/42/evaluation/g")).toEqual({ section: "workbench", page: "evaluation_section", jobId: 42, sectionKey: "g" });
    expect(parseAppHash("#/workbench/jobs/42/evaluation/deep")).toEqual({ section: "workbench", page: "evaluation_deep", jobId: 42 });
    expect(parseAppHash("#/workbench/comparisons/8")).toEqual({ section: "workbench", page: "comparison", comparisonId: 8 });
  });

  it("rejects malformed detail identifiers", () => {
    expect(parseAppHash("#/workbench/jobs/not-a-number")).toBeNull();
  });
});

describe("opportunity discovery route hierarchy", () => {
  it("separates the home, task creation, queue, run, and job detail pages", () => {
    expect(parseAppHash("#/opportunities")).toEqual({ section: "opportunities", page: "index" });
    expect(parseAppHash("#/opportunities/new")).toEqual({ section: "opportunities", page: "new" });
    expect(parseAppHash("#/opportunities/pipeline")).toEqual({ section: "opportunities", page: "pipeline" });
    expect(parseAppHash("#/opportunities/runs/7")).toEqual({ section: "opportunities", page: "run", runId: 7 });
    expect(parseAppHash("#/opportunities/jobs/9")).toEqual({ section: "opportunities", page: "job", discoveredJobId: 9 });
    expect(appRouteHash({ section: "opportunities", page: "run", runId: 7 })).toBe("#/opportunities/runs/7");
  });
});
