import type { ViewKey } from "./types";

export type SettingsPage = "overview" | "account" | "profile" | "model" | "agent";
type OpportunitiesPage = "index" | "new" | "pipeline" | "sources" | "run" | "job";
export type WorkbenchPage = "index" | "new" | "detail" | "resume" | "interview" | "evaluation" | "evaluation_section" | "comparison";
export type PreparationPage = "projects" | "knowledge" | "records";
export type PreparationFocus = "questions" | "knowledge" | "gaps";
export type ProjectStudioPage = "overview" | "architecture" | "materials" | "interview";

export type AppRoute =
  | { section: "opportunities"; page?: OpportunitiesPage; runId?: number; discoveredJobId?: number }
  | { section: "workbench"; page?: WorkbenchPage; jobId?: number; sectionKey?: "a" | "b" | "c" | "d" | "e" | "f" | "g"; comparisonId?: number }
  | { section: "interview-prep"; page?: PreparationPage; experienceId?: string; focus?: PreparationFocus; nodeId?: string }
  | { section: "project-lab"; projectId?: string; page?: ProjectStudioPage }
  | { section: "dashboard" }
  | { section: "chat"; conversationId?: number }
  | { section: "settings"; page: SettingsPage; returnTo?: "workbench" };

const legacyViewMap: Record<string, ViewKey> = {
  profile: "settings",
  agent: "settings",
  tools: "dashboard",
  opportunities: "opportunities",
  workbench: "workbench",
  "interview-prep": "interview-prep",
  dashboard: "dashboard",
  chat: "chat",
  settings: "settings"
};

export function routeForSection(section: ViewKey): AppRoute {
  if (section === "opportunities" || section === "interview-prep") return { section: "chat" };
  if (section === "workbench") return { section, page: "index" };
  if (section === "project-lab") return { section: "settings", page: "profile" };
  return section === "settings" ? { section, page: "overview" } : { section };
}

export function parseAppHash(hash: string): AppRoute | null {
  const value = hash.replace(/^#/, "");
  const [rawPath, rawQuery = ""] = value.split("?", 2);
  const path = rawPath.replace(/^\//, "").replace(/\/$/, "");
  if (path === "search") return { section: "chat" };
  if (path === "library") {
    const query = new URLSearchParams(rawQuery);
    return {
      section: "settings",
      page: "profile",
      returnTo: query.get("return") === "workbench" ? "workbench" : undefined
    };
  }
  if (path === "workspace") return { section: "workbench", page: "resume" };
  if (path === "opportunities" || path.startsWith("opportunities/")) return { section: "chat" };
  if (path === "workbench") return { section: "workbench", page: "index" };
  if (path === "workbench/new") return { section: "workbench", page: "index" };
  if (path === "workbench/resume") return { section: "workbench", page: "resume" };
  if (path === "workbench/interview") return { section: "chat" };
  const jobResumeMatch = path.match(/^workbench\/jobs\/(\d+)\/resume$/);
  if (jobResumeMatch) return { section: "workbench", page: "resume", jobId: Number(jobResumeMatch[1]) };
  const jobInterviewMatch = path.match(/^workbench\/jobs\/(\d+)\/interview$/);
  if (jobInterviewMatch) return { section: "chat" };
  const evaluationSectionMatch = path.match(/^workbench\/jobs\/(\d+)\/evaluation\/([a-g])$/);
  if (evaluationSectionMatch) return { section: "workbench", page: "evaluation_section", jobId: Number(evaluationSectionMatch[1]), sectionKey: evaluationSectionMatch[2] as "a" | "b" | "c" | "d" | "e" | "f" | "g" };
  const evaluationDeepMatch = path.match(/^workbench\/jobs\/(\d+)\/evaluation\/deep$/);
  if (evaluationDeepMatch) return { section: "workbench", page: "evaluation", jobId: Number(evaluationDeepMatch[1]) };
  const evaluationMatch = path.match(/^workbench\/jobs\/(\d+)\/evaluation$/);
  if (evaluationMatch) return { section: "workbench", page: "evaluation", jobId: Number(evaluationMatch[1]) };
  const comparisonMatch = path.match(/^workbench\/comparisons\/(\d+)$/);
  if (comparisonMatch) return { section: "workbench", page: "comparison", comparisonId: Number(comparisonMatch[1]) };
  const jobDetailMatch = path.match(/^workbench\/jobs\/(\d+)$/);
  if (jobDetailMatch) {
    return { section: "workbench", page: "detail", jobId: Number(jobDetailMatch[1]) };
  }
  if (path === "project") return { section: "settings", page: "profile" };
  const projectLabMatch = path.match(/^project\/([^/]+)(?:\/(architecture|materials|interview))?$/);
  if (projectLabMatch) return { section: "settings", page: "profile" };
  if (path === "interview-prep") return { section: "chat" };
  if (path === "projects") return { section: "settings", page: "profile" };
  const projectRoute = path.match(/^projects\/([^/]+)(?:\/(questions|knowledge|gaps)(?:\/([^/]+))?)?$/);
  if (projectRoute) return { section: "settings", page: "profile" };
  if (path === "knowledge") return { section: "settings", page: "profile" };
  const knowledgeRoute = path.match(/^knowledge\/([^/]+)(?:\/([^/]+))?$/);
  if (knowledgeRoute) return { section: "settings", page: "profile" };
  if (path === "interview-records") return { section: "chat" };
  if (path === "home" || path === "dashboard") return { section: "dashboard" };
  if (path === "chat") return { section: "chat" };
  const chatRoute = path.match(/^chat\/(\d+)$/);
  if (chatRoute) return { section: "chat", conversationId: Number(chatRoute[1]) };
  if (path === "settings" || path === "settings/overview") {
    return { section: "settings", page: "overview" };
  }
  if (path === "settings/model" || path === "settings/models") return { section: "settings", page: "model" };
  if (path === "settings/agent") return { section: "settings", page: "agent" };
  if (path === "settings/account") return { section: "settings", page: "account" };
  if (path === "settings/profile" || path === "evidence") {
    const query = new URLSearchParams(rawQuery);
    return {
      section: "settings",
      page: "profile",
      returnTo: query.get("return") === "workbench" ? "workbench" : undefined
    };
  }
  return null;
}

export function initialAppRoute(hash: string, _legacyView: string | null): AppRoute {
  const parsed = parseAppHash(hash);
  if (parsed) return parsed;
  return { section: "chat" };
}

export function appRouteHash(route: AppRoute): string {
  if (route.section === "opportunities") {
    return "#/chat";
  }
  if (route.section === "workbench") {
    if (route.page === "new") return "#/workbench";
    if (route.page === "resume" && route.jobId) return `#/workbench/jobs/${route.jobId}/resume`;
    if (route.page === "resume") return "#/workspace";
    if (route.page === "interview") return "#/chat";
    if (route.page === "detail" && route.jobId) return `#/workbench/jobs/${route.jobId}`;
    if (route.page === "evaluation_section" && route.jobId && route.sectionKey) return `#/workbench/jobs/${route.jobId}/evaluation/${route.sectionKey}`;
    if (route.page === "evaluation" && route.jobId) return `#/workbench/jobs/${route.jobId}/evaluation`;
    if (route.page === "comparison" && route.comparisonId) return `#/workbench/comparisons/${route.comparisonId}`;
    return "#/workbench";
  }
  if (route.section === "interview-prep") {
    return "#/chat";
  }
  if (route.section === "project-lab") {
    return "#/library";
  }
  if (route.section === "dashboard") return "#/home";
  if (route.section === "chat") return route.conversationId ? `#/chat/${route.conversationId}` : "#/chat";
  if (route.page === "overview") return "#/settings";
  if (route.page === "profile") {
    const query = route.returnTo === "workbench" ? "?return=workbench" : "";
    return `#/library${query}`;
  }
  const query = "";
  return `#/settings/${route.page}${query}`;
}
