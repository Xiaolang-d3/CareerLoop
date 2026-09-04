import { describe, expect, it } from "vitest";
import { appRouteHash, initialAppRoute, parseAppHash, routeForSection } from "./routing";

describe("primary route", () => {
  it("opens conversation after login when no route is specified", () => {
    expect(initialAppRoute("", null)).toEqual({ section: "chat" });
    expect(initialAppRoute("#", "workbench")).toEqual({ section: "chat" });
    expect(parseAppHash("#/home")).toEqual({ section: "dashboard" });
    expect(parseAppHash("#/dashboard")).toEqual({ section: "dashboard" });
    expect(parseAppHash("#/search")).toEqual({ section: "chat" });
    expect(parseAppHash("#/library")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/workspace")).toEqual({ section: "workbench", page: "resume" });
    expect(appRouteHash({ section: "dashboard" })).toBe("#/home");
    expect(routeForSection("dashboard")).toEqual({ section: "dashboard" });
    expect(routeForSection("workbench")).toEqual({ section: "workbench", page: "index" });
  });
});

describe("workbench route hierarchy", () => {
  it("keeps the project index, creation page, and detail page distinct", () => {
    expect(parseAppHash("#/workbench")).toEqual({ section: "workbench", page: "index" });
    expect(parseAppHash("#/workbench/new")).toEqual({ section: "workbench", page: "index" });
    expect(parseAppHash("#/workbench/resume")).toEqual({ section: "workbench", page: "resume" });
    expect(parseAppHash("#/workbench/interview")).toEqual({ section: "chat" });
    expect(parseAppHash("#/workbench/jobs/42/resume")).toEqual({ section: "workbench", page: "resume", jobId: 42 });
    expect(parseAppHash("#/workbench/jobs/42/interview")).toEqual({ section: "chat" });
    expect(appRouteHash({ section: "workbench", page: "resume", jobId: 42 })).toBe("#/workbench/jobs/42/resume");
    expect(appRouteHash({ section: "workbench", page: "interview", jobId: 42 })).toBe("#/chat");
    expect(appRouteHash({ section: "workbench", page: "interview" })).toBe("#/chat");
    expect(appRouteHash({ section: "workbench", page: "resume" })).toBe("#/workspace");
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

describe("retired opportunity routes", () => {
  it("keeps old links usable by routing them into conversation", () => {
    expect(parseAppHash("#/opportunities")).toEqual({ section: "chat" });
    expect(parseAppHash("#/opportunities/new")).toEqual({ section: "chat" });
    expect(parseAppHash("#/opportunities/pipeline")).toEqual({ section: "chat" });
    expect(parseAppHash("#/opportunities/runs/7")).toEqual({ section: "chat" });
    expect(parseAppHash("#/opportunities/jobs/9")).toEqual({ section: "chat" });
    expect(appRouteHash({ section: "opportunities", page: "run", runId: 7 })).toBe("#/chat");
  });
});

describe("retired preparation routes", () => {
  it("routes preparation into conversation and knowledge into the library", () => {
    expect(parseAppHash("#/interview-prep")).toEqual({ section: "chat" });
    expect(parseAppHash("#/knowledge")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/interview-records")).toEqual({ section: "chat" });
    expect(appRouteHash({ section: "interview-prep", page: "projects" })).toBe("#/chat");
    expect(appRouteHash({ section: "interview-prep", page: "knowledge" })).toBe("#/chat");
  });

  it("routes old project and knowledge deep links into the library", () => {
    expect(parseAppHash("#/projects/experience-1/questions/experience-1-contribution")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/knowledge/experience-1/experience-1-skill-fastapi")).toEqual({ section: "settings", page: "profile" });
  });
});

describe("retired project studio routes", () => {
  it("routes project links into the library", () => {
    expect(parseAppHash("#/project")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/project/project-1")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/project/project-1/architecture")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/project/project-1/materials")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/project/project-1/interview")).toEqual({ section: "settings", page: "profile" });
    expect(appRouteHash({ section: "project-lab" })).toBe("#/library");
    expect(appRouteHash({ section: "project-lab", projectId: "project-1", page: "overview" })).toBe("#/library");
    expect(routeForSection("project-lab")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/projects")).toEqual({ section: "settings", page: "profile" });
  });
});

describe("conversation route", () => {
  it("keeps a specific conversation addressable", () => {
    expect(parseAppHash("#/chat/42")).toEqual({ section: "chat", conversationId: 42 });
    expect(appRouteHash({ section: "chat", conversationId: 42 })).toBe("#/chat/42");
  });
});

describe("account settings route", () => {
  it("keeps account settings distinct from the library", () => {
    expect(parseAppHash("#/settings/account")).toEqual({ section: "settings", page: "account" });
    expect(appRouteHash({ section: "settings", page: "account" })).toBe("#/settings/account");
    expect(parseAppHash("#/settings/profile")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/evidence")).toEqual({ section: "settings", page: "profile" });
    expect(parseAppHash("#/library?return=workbench")).toEqual({ section: "settings", page: "profile", returnTo: "workbench" });
    expect(appRouteHash({ section: "settings", page: "profile" })).toBe("#/library");
  });
});

describe("model settings route", () => {
  it("keeps model settings addressable inside settings", () => {
    expect(parseAppHash("#/settings/model")).toEqual({ section: "settings", page: "model" });
    expect(parseAppHash("#/settings/models")).toEqual({ section: "settings", page: "model" });
    expect(appRouteHash({ section: "settings", page: "model" })).toBe("#/settings/model");
  });
});
