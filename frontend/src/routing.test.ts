import { describe, expect, it } from "vitest";
import { appRouteHash, initialAppRoute, parseAppHash, routeForSection } from "./routing";

describe("home route", () => {
  it("opens the job workbench when no route is specified", () => {
    expect(initialAppRoute("", null)).toEqual({ section: "workbench", page: "index" });
    expect(initialAppRoute("#", "dashboard")).toEqual({ section: "workbench", page: "index" });
    expect(routeForSection("workbench")).toEqual({ section: "workbench", page: "index" });
  });
});

describe("workbench route hierarchy", () => {
  it("keeps the project index, creation page, and detail page distinct", () => {
    expect(parseAppHash("#/workbench")).toEqual({ section: "workbench", page: "index" });
    expect(parseAppHash("#/workbench/new")).toEqual({ section: "workbench", page: "index" });
    expect(parseAppHash("#/workbench/resume")).toEqual({ section: "workbench", page: "resume" });
    expect(parseAppHash("#/workbench/interview")).toEqual({ section: "workbench", page: "interview" });
    expect(parseAppHash("#/workbench/jobs/42/resume")).toEqual({ section: "workbench", page: "resume", jobId: 42 });
    expect(parseAppHash("#/workbench/jobs/42/interview")).toEqual({ section: "workbench", page: "interview", jobId: 42 });
    expect(appRouteHash({ section: "workbench", page: "new" })).toBe("#/workbench");
    expect(appRouteHash({ section: "workbench", page: "resume", jobId: 42 })).toBe("#/workbench/jobs/42/resume");
    expect(appRouteHash({ section: "workbench", page: "interview" })).toBe("#/workbench/interview");
    expect(parseAppHash("#/workbench/jobs/42")).toEqual({ section: "workbench", page: "detail", jobId: 42 });
    expect(appRouteHash({ section: "workbench", page: "detail", jobId: 42 })).toBe("#/workbench/jobs/42");
    expect(parseAppHash("#/workbench/jobs/42/evaluation")).toEqual({ section: "workbench", page: "evaluation", jobId: 42 });
    expect(parseAppHash("#/workbench/jobs/42/evaluation/g")).toEqual({ section: "workbench", page: "evaluation_section", jobId: 42, sectionKey: "g" });
    expect(parseAppHash("#/workbench/jobs/42/evaluation/deep")).toEqual({ section: "workbench", page: "evaluation", jobId: 42 });
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

describe("interview preparation route", () => {
  it("keeps personal preparation independent of a specific job and separates its three areas", () => {
    expect(parseAppHash("#/interview-prep")).toEqual({ section: "interview-prep", page: "projects" });
    expect(parseAppHash("#/knowledge")).toEqual({ section: "interview-prep", page: "knowledge" });
    expect(parseAppHash("#/interview-records")).toEqual({ section: "interview-prep", page: "records" });
    expect(appRouteHash({ section: "interview-prep", page: "projects" })).toBe("#/projects");
    expect(appRouteHash({ section: "interview-prep", page: "knowledge" })).toBe("#/knowledge");
  });

  it("preserves the active experience, preparation focus, and node in deep links", () => {
    expect(parseAppHash("#/projects/experience-1/questions/experience-1-contribution")).toEqual({
      section: "interview-prep", page: "projects", experienceId: "experience-1", focus: "questions", nodeId: "experience-1-contribution"
    });
    expect(appRouteHash({
      section: "interview-prep", page: "projects", experienceId: "experience-1", focus: "knowledge", nodeId: "experience-1-skill-fastapi"
    })).toBe("#/projects/experience-1/knowledge/experience-1-skill-fastapi");
    expect(parseAppHash("#/knowledge/experience-1/experience-1-skill-fastapi")).toEqual({
      section: "interview-prep", page: "knowledge", experienceId: "experience-1", nodeId: "experience-1-skill-fastapi"
    });
  });
});

describe("conversation route", () => {
  it("keeps a specific conversation addressable", () => {
    expect(parseAppHash("#/chat/42")).toEqual({ section: "chat", conversationId: 42 });
    expect(appRouteHash({ section: "chat", conversationId: 42 })).toBe("#/chat/42");
  });
});
