import type { ViewKey } from "./types";

export type SettingsPage = "overview" | "profile" | "model" | "agent";
export type OpportunitiesPage = "index" | "new" | "pipeline" | "sources" | "run" | "job";

export type AppRoute =
  | { section: "opportunities"; page?: OpportunitiesPage; runId?: number; discoveredJobId?: number }
  | { section: "workbench"; page?: "index" | "new" | "detail" | "evaluation" | "evaluation_section" | "evaluation_deep" | "comparison"; jobId?: number; sectionKey?: "a" | "b" | "c" | "d" | "e" | "f" | "g"; comparisonId?: number }
  | { section: "dashboard" }
  | { section: "chat" }
  | { section: "settings"; page: SettingsPage; returnTo?: "workbench" };

const legacyViewMap: Record<string, ViewKey> = {
  profile: "settings",
  agent: "settings",
  tools: "dashboard",
  opportunities: "opportunities",
  workbench: "workbench",
  dashboard: "dashboard",
  chat: "chat",
  settings: "settings"
};

export function routeForSection(section: ViewKey): AppRoute {
  if (section === "opportunities") return { section, page: "index" };
  return section === "settings" ? { section, page: "overview" } : { section };
}

export function parseAppHash(hash: string): AppRoute | null {
  const value = hash.replace(/^#/, "");
  const [rawPath, rawQuery = ""] = value.split("?", 2);
  const path = rawPath.replace(/^\//, "").replace(/\/$/, "");
  if (path === "opportunities") return { section: "opportunities", page: "index" };
  if (path === "opportunities/new") return { section: "opportunities", page: "new" };
  if (path === "opportunities/pipeline") return { section: "opportunities", page: "pipeline" };
  if (path === "opportunities/sources") return { section: "opportunities", page: "sources" };
  const opportunityRunMatch = path.match(/^opportunities\/runs\/(\d+)$/);
  if (opportunityRunMatch) return { section: "opportunities", page: "run", runId: Number(opportunityRunMatch[1]) };
  const discoveredJobMatch = path.match(/^opportunities\/jobs\/(\d+)$/);
  if (discoveredJobMatch) return { section: "opportunities", page: "job", discoveredJobId: Number(discoveredJobMatch[1]) };
  if (path === "workbench") return { section: "workbench", page: "index" };
  if (path === "workbench/new") return { section: "workbench", page: "new" };
  const evaluationSectionMatch = path.match(/^workbench\/jobs\/(\d+)\/evaluation\/([a-g])$/);
  if (evaluationSectionMatch) return { section: "workbench", page: "evaluation_section", jobId: Number(evaluationSectionMatch[1]), sectionKey: evaluationSectionMatch[2] as "a" | "b" | "c" | "d" | "e" | "f" | "g" };
  const evaluationDeepMatch = path.match(/^workbench\/jobs\/(\d+)\/evaluation\/deep$/);
  if (evaluationDeepMatch) return { section: "workbench", page: "evaluation_deep", jobId: Number(evaluationDeepMatch[1]) };
  const evaluationMatch = path.match(/^workbench\/jobs\/(\d+)\/evaluation$/);
  if (evaluationMatch) return { section: "workbench", page: "evaluation", jobId: Number(evaluationMatch[1]) };
  const comparisonMatch = path.match(/^workbench\/comparisons\/(\d+)$/);
  if (comparisonMatch) return { section: "workbench", page: "comparison", comparisonId: Number(comparisonMatch[1]) };
  const jobDetailMatch = path.match(/^workbench\/jobs\/(\d+)$/);
  if (jobDetailMatch) {
    return { section: "workbench", page: "detail", jobId: Number(jobDetailMatch[1]) };
  }
  if (path === "dashboard") return { section: "dashboard" };
  if (path === "chat") return { section: "chat" };
  if (path === "settings" || path === "settings/overview") {
    return { section: "settings", page: "overview" };
  }
  if (path === "settings/model") return { section: "settings", page: "model" };
  if (path === "settings/agent") return { section: "settings", page: "agent" };
  if (path === "settings/profile") {
    const query = new URLSearchParams(rawQuery);
    return {
      section: "settings",
      page: "profile",
      returnTo: query.get("return") === "workbench" ? "workbench" : undefined
    };
  }
  return null;
}

export function initialAppRoute(hash: string, legacyView: string | null): AppRoute {
  const parsed = parseAppHash(hash);
  if (parsed) return parsed;
  if (hash && hash !== "#") return { section: "workbench" };
  return routeForSection("chat");
}

export function appRouteHash(route: AppRoute): string {
  if (route.section === "opportunities") {
    if (route.page === "new") return "#/opportunities/new";
    if (route.page === "pipeline") return "#/opportunities/pipeline";
    if (route.page === "sources") return "#/opportunities/sources";
    if (route.page === "run" && route.runId) return `#/opportunities/runs/${route.runId}`;
    if (route.page === "job" && route.discoveredJobId) return `#/opportunities/jobs/${route.discoveredJobId}`;
    return "#/opportunities";
  }
  if (route.section === "workbench") {
    if (route.page === "new") return "#/workbench/new";
    if (route.page === "detail" && route.jobId) return `#/workbench/jobs/${route.jobId}`;
    if (route.page === "evaluation_section" && route.jobId && route.sectionKey) return `#/workbench/jobs/${route.jobId}/evaluation/${route.sectionKey}`;
    if (route.page === "evaluation_deep" && route.jobId) return `#/workbench/jobs/${route.jobId}/evaluation/deep`;
    if (route.page === "evaluation" && route.jobId) return `#/workbench/jobs/${route.jobId}/evaluation`;
    if (route.page === "comparison" && route.comparisonId) return `#/workbench/comparisons/${route.comparisonId}`;
    return "#/workbench";
  }
  if (route.section !== "settings") return `#/${route.section}`;
  if (route.page === "overview") return "#/settings";
  const query = route.page === "profile" && route.returnTo === "workbench"
    ? "?return=workbench"
    : "";
  return `#/settings/${route.page}${query}`;
}
