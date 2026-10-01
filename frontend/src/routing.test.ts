import { describe, expect, it } from "vitest";
import { appRouteHash, initialAppRoute, parseAppHash, routeForSection } from "./routing";

describe("primary route", () => {
  it("opens home after login when no route is specified", () => {
    expect(initialAppRoute("", null)).toEqual({ section: "dashboard" });
    expect(initialAppRoute("#", "workbench")).toEqual({ section: "dashboard" });
    expect(parseAppHash("#/home")).toEqual({ section: "dashboard" });
    expect(parseAppHash("#/dashboard")).toEqual({ section: "dashboard" });
    expect(parseAppHash("#/search")).toEqual({ section: "chat" });
    expect(parseAppHash("#/library")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/workspace")).toEqual({ section: "chat" });
    expect(appRouteHash({ section: "dashboard" })).toBe("#/home");
    expect(routeForSection("dashboard")).toEqual({ section: "dashboard" });
  });
});

describe("retired career workbench routes", () => {
  it.each(["workbench", "workbench/new", "workbench/resume", "workbench/interview", "workbench/jobs/42", "workbench/jobs/42/resume", "workbench/jobs/42/evaluation", "workbench/comparisons/8"])("redirects %s to the AI workspace", (path) => {
    expect(parseAppHash(`#/${path}`)).toEqual({ section: "chat" });
  });
});

describe("retired opportunity routes", () => {
  it("keeps old links usable by routing them into conversation", () => {
    expect(parseAppHash("#/opportunities")).toEqual({ section: "chat" });
    expect(parseAppHash("#/opportunities/new")).toEqual({ section: "chat" });
    expect(parseAppHash("#/opportunities/pipeline")).toEqual({ section: "chat" });
    expect(parseAppHash("#/opportunities/runs/7")).toEqual({ section: "chat" });
    expect(parseAppHash("#/opportunities/jobs/9")).toEqual({ section: "chat" });
  });
});

describe("retired preparation routes", () => {
  it("routes preparation into conversation and knowledge into the library", () => {
    expect(parseAppHash("#/interview-prep")).toEqual({ section: "chat" });
    expect(parseAppHash("#/knowledge")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/interview-records")).toEqual({ section: "chat" });
  });

  it("routes old project and knowledge deep links into the library", () => {
    expect(parseAppHash("#/projects/experience-1/questions/experience-1-contribution")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/knowledge/experience-1/experience-1-skill-fastapi")).toEqual({ section: "settings", page: "library" });
  });
});

describe("retired project studio routes", () => {
  it("routes project links into the library", () => {
    expect(parseAppHash("#/project")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/project/project-1")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/project/project-1/architecture")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/project/project-1/materials")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/project/project-1/interview")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/projects")).toEqual({ section: "settings", page: "library" });
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
    expect(parseAppHash("#/settings/profile")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/evidence")).toEqual({ section: "settings", page: "library" });
    expect(parseAppHash("#/library?return=workbench")).toEqual({ section: "settings", page: "library" });
    expect(appRouteHash({ section: "settings", page: "library" })).toBe("#/library");
  });
});

describe("model settings route", () => {
  it("keeps model settings addressable inside settings", () => {
    expect(parseAppHash("#/settings/model")).toEqual({ section: "settings", page: "model" });
    expect(parseAppHash("#/settings/models")).toEqual({ section: "settings", page: "model" });
    expect(appRouteHash({ section: "settings", page: "model" })).toBe("#/settings/model");
  });
});
