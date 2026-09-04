import type { AgentSettings, CandidateEditor, ViewKey } from "./types";
import type { SettingsPage, WorkbenchPage } from "./routing";

export const bossHomeUrl = "https://www.zhipin.com/";

export const defaultAgentSettings: AgentSettings = {
  display_name: "CareerLoop",
  persona_role: "主动、清晰、基于用户资料协助分析、研究和内容创作的 AI 伙伴",
  response_style: "concise",
  custom_instructions: "",
  profile_memory_enabled: true,
  conversation_memory_enabled: true,
  knowledge_memory_enabled: true,
  summary_enabled: true,
  context_message_limit: 12,
  model_name: "gpt-5.5",
  model_base_url: "",
  model_protocol: "auto",
  api_key: "",
  api_key_configured: false
};

export const pageMeta: Record<ViewKey, { title: string; description: string }> = {
  opportunities: { title: "对话", description: "旧的岗位发现链接已归入对话" },
  workbench: { title: "工作台", description: "集中编辑、分析和导出生成的内容" },
  "interview-prep": { title: "对话", description: "旧的准备入口已归入对话" },
  "project-lab": { title: "资料库", description: "旧的项目入口已归入资料库" },
  dashboard: { title: "首页", description: "查看最近资料、文档和对话" },
  chat: { title: "对话", description: "基于你的资料进行问答、搜索、分析和内容生成" },
  settings: { title: "设置", description: "维护账号、模型连接和偏好" }
};

const sectionTitles: Record<ViewKey, string> = {
  dashboard: pageMeta.dashboard.title,
  opportunities: "对话",
  workbench: "工作台",
  "interview-prep": "对话",
  "project-lab": "资料库",
  chat: "对话",
  settings: "设置"
};

export function topbarSectionForPage(section: ViewKey, title: string): string | undefined {
  if (section === "chat" || section === "settings") return undefined;
  return sectionTitles[section] === title ? undefined : sectionTitles[section];
}

export type SidebarHighlight = "dashboard" | "library" | "workspace" | "chat" | null;

export function sidebarHighlightForView(
  view: ViewKey,
  extras: { settingsPage?: SettingsPage; workbenchPage?: WorkbenchPage } = {}
): SidebarHighlight {
  if (view === "dashboard") return "dashboard";
  if (view === "chat") return "chat";
  if (view === "settings" && extras.settingsPage === "profile") return "library";
  if (view === "workbench" && extras.workbenchPage === "resume") return "workspace";
  return null;
}

export const emptyCandidateEditor: CandidateEditor = {
  name: "",
  targetRole: "",
  targetCity: "",
  salaryMin: "",
  salaryMax: "",
  skills: "",
  industries: "",
  blockedKeywords: "",
  blockedCompanies: "",
  resumeText: "",
  resumeFilename: "",
  resumeRedactedText: "",
  privacyMode: "redacted"
};
