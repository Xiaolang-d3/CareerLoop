import { describe, expect, it } from "vitest";
import { appRouteHash, initialAppRoute, parseAppHash, routeForSection } from "./routing";

describe("primary route", () => {
  it("opens home after login when no route is specified", () => {
    expect(initialAppRoute("")).toEqual({ section: "dashboard" });
    expect(initialAppRoute("#")).toEqual({ section: "dashboard" });
    expect(parseAppHash("#/home")).toEqual({ section: "dashboard" });
    expect(parseAppHash("#/dashboard")).toEqual({ section: "dashboard" });
    expect(parseAppHash("#/library")).toEqual({ section: "settings", page: "library" });
    expect(appRouteHash({ section: "dashboard" })).toBe("#/home");
    expect(routeForSection("dashboard")).toEqual({ section: "dashboard" });
  });
});

describe("retired product routes", () => {
  it.each([
    "search",
    "workspace",
    "workbench",
    "workbench/jobs/42/evaluation",
    "opportunities",
    "opportunities/jobs/9",
    "interview-prep",
    "interview-records",
    "projects",
    "projects/experience-1/questions/experience-1-contribution",
    "project",
    "project/project-1/interview",
    "knowledge",
    "knowledge/experience-1/experience-1-skill-fastapi",
    "evidence",
    "settings/profile"
  ])("does not recognize #%s", (path) => {
    expect(parseAppHash(`#/${path}`)).toBeNull();
    expect(initialAppRoute(`#/${path}`)).toEqual({ section: "dashboard" });
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
