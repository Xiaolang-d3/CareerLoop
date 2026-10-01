import type { ViewKey } from "./types";

export type SettingsPage = "overview" | "account" | "library" | "model" | "agent";

export type AppRoute =
  | { section: "dashboard" }
  | { section: "chat"; conversationId?: number }
  | { section: "settings"; page: SettingsPage };

export function routeForSection(section: ViewKey): AppRoute {
  return section === "settings" ? { section, page: "overview" } : { section };
}

export function parseAppHash(hash: string): AppRoute | null {
  const value = hash.replace(/^#/, "");
  const [rawPath] = value.split("?", 2);
  const path = rawPath.replace(/^\//, "").replace(/\/$/, "");
  if (path === "search") return { section: "chat" };
  if (path === "library") return { section: "settings", page: "library" };
  if (path === "workspace") return { section: "chat" };
  if (path === "opportunities" || path.startsWith("opportunities/")) return { section: "chat" };
  if (path === "workbench" || path.startsWith("workbench/")) return { section: "chat" };
  if (path === "project") return { section: "settings", page: "library" };
  const projectLabMatch = path.match(/^project\/([^/]+)(?:\/(architecture|materials|interview))?$/);
  if (projectLabMatch) return { section: "settings", page: "library" };
  if (path === "interview-prep") return { section: "chat" };
  if (path === "projects") return { section: "settings", page: "library" };
  const projectRoute = path.match(/^projects\/([^/]+)(?:\/(questions|knowledge|gaps)(?:\/([^/]+))?)?$/);
  if (projectRoute) return { section: "settings", page: "library" };
  if (path === "knowledge") return { section: "settings", page: "library" };
  const knowledgeRoute = path.match(/^knowledge\/([^/]+)(?:\/([^/]+))?$/);
  if (knowledgeRoute) return { section: "settings", page: "library" };
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
  if (path === "settings/profile" || path === "evidence") return { section: "settings", page: "library" };
  return null;
}

export function initialAppRoute(hash: string, _legacyView: string | null): AppRoute {
  const parsed = parseAppHash(hash);
  if (parsed) return parsed;
  return { section: "dashboard" };
}

export function appRouteHash(route: AppRoute): string {
  if (route.section === "dashboard") return "#/home";
  if (route.section === "chat") return route.conversationId ? `#/chat/${route.conversationId}` : "#/chat";
  if (route.page === "overview") return "#/settings";
  if (route.page === "library") return "#/library";
  return `#/settings/${route.page}`;
}
