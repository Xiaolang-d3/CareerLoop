import type { ViewKey } from "./types";

export type SettingsPage = "overview" | "profile" | "model" | "agent";
type OpportunitiesPage = "index" | "new" | "pipeline" | "sources" | "run" | "job";
export type WorkbenchPage = "index" | "new" | "detail" | "resume" | "interview" | "evaluation" | "evaluation_section" | "evaluation_deep" | "comparison";
export type PreparationPage = "projects" | "knowledge" | "records";
export type PreparationFocus = "questions" | "knowledge" | "gaps";

export type AppRoute =
  | { section: "opportunities"; page?: OpportunitiesPage; runId?: number; discoveredJobId?: number }
  | { section: "workbench"; page?: WorkbenchPage; jobId?: number; sectionKey?: "a" | "b" | "c" | "d" | "e" | "f" | "g"; comparisonId?: number }
  | { section: "interview-prep"; page?: PreparationPage; experienceId?: string; focus?: PreparationFocus; nodeId?: string }
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
  if (section === "opportunities") return { section, page: "index" };
  if (section === "workbench") return { section, page: "index" };
  if (section === "interview-prep") return { section, page: "projects" };
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
  if (path === "workbench/new") return { section: "workbench", page: "index" };
  if (path === "workbench/resume") return { section: "workbench", page: "resume" };
  if (path === "workbench/interview") return { section: "workbench", page: "interview" };
  const jobResumeMatch = path.match(/^workbench\/jobs\/(\d+)\/resume$/);
  if (jobResumeMatch) return { section: "workbench", page: "resume", jobId: Number(jobResumeMatch[1]) };
  const jobInterviewMatch = path.match(/^workbench\/jobs\/(\d+)\/interview$/);
  if (jobInterviewMatch) return { section: "workbench", page: "interview", jobId: Number(jobInterviewMatch[1]) };
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
  if (path === "interview-prep" || path === "projects") return { section: "interview-prep", page: "projects" };
  const projectRoute = path.match(/^projects\/([^/]+)(?:\/(questions|knowledge|gaps)(?:\/([^/]+))?)?$/);
  if (projectRoute) return {
    section: "interview-prep",
    page: "projects",
    experienceId: decodeURIComponent(projectRoute[1]),
    focus: projectRoute[2] as PreparationFocus | undefined,
    nodeId: projectRoute[3] ? decodeURIComponent(projectRoute[3]) : undefined
  };
  if (path === "knowledge") return { section: "interview-prep", page: "knowledge" };
  const knowledgeRoute = path.match(/^knowledge\/([^/]+)(?:\/([^/]+))?$/);
  if (knowledgeRoute) return {
    section: "interview-prep",
    page: "knowledge",
    experienceId: decodeURIComponent(knowledgeRoute[1]),
    nodeId: knowledgeRoute[2] ? decodeURIComponent(knowledgeRoute[2]) : undefined
  };
  if (path === "interview-records") return { section: "interview-prep", page: "records" };
  if (path === "dashboard") return { section: "dashboard" };
  if (path === "chat") return { section: "chat" };
  const chatRoute = path.match(/^chat\/(\d+)$/);
  if (chatRoute) return { section: "chat", conversationId: Number(chatRoute[1]) };
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
  if (hash && hash !== "#") return { section: "workbench", page: "index" };
  return { section: "workbench", page: "index" };
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
    if (route.page === "new") return "#/workbench";
    if (route.page === "resume" && route.jobId) return `#/workbench/jobs/${route.jobId}/resume`;
    if (route.page === "resume") return "#/workbench/resume";
    if (route.page === "interview" && route.jobId) return `#/workbench/jobs/${route.jobId}/interview`;
    if (route.page === "interview") return "#/workbench/interview";
    if (route.page === "detail" && route.jobId) return `#/workbench/jobs/${route.jobId}`;
    if (route.page === "evaluation_section" && route.jobId && route.sectionKey) return `#/workbench/jobs/${route.jobId}/evaluation/${route.sectionKey}`;
    if (route.page === "evaluation_deep" && route.jobId) return `#/workbench/jobs/${route.jobId}/evaluation`;
    if (route.page === "evaluation" && route.jobId) return `#/workbench/jobs/${route.jobId}/evaluation`;
    if (route.page === "comparison" && route.comparisonId) return `#/workbench/comparisons/${route.comparisonId}`;
    return "#/workbench";
  }
  if (route.section === "interview-prep") {
    if (route.page === "knowledge") {
      if (!route.experienceId) return "#/knowledge";
      const experience = encodeURIComponent(route.experienceId);
      return route.nodeId ? `#/knowledge/${experience}/${encodeURIComponent(route.nodeId)}` : `#/knowledge/${experience}`;
    }
    if (route.page === "records") return "#/interview-records";
    if (route.experienceId) {
      const experience = encodeURIComponent(route.experienceId);
      if (!route.focus) return `#/projects/${experience}`;
      const focus = route.focus;
      return route.nodeId
        ? `#/projects/${experience}/${focus}/${encodeURIComponent(route.nodeId)}`
        : `#/projects/${experience}/${focus}`;
    }
    return "#/projects";
  }
  if (route.section === "chat") return route.conversationId ? `#/chat/${route.conversationId}` : "#/chat";
  if (route.section !== "settings") return `#/${route.section}`;
  if (route.page === "overview") return "#/settings";
  const query = route.page === "profile" && route.returnTo === "workbench"
    ? "?return=workbench"
    : "";
  return `#/settings/${route.page}${query}`;
}
