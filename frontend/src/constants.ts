import type { AgentSettings, CandidateEditor, ViewKey } from "./types";
import type { SettingsPage, WorkbenchPage } from "./routing";

export const bossHomeUrl = "https://www.zhipin.com/";

export const defaultAgentSettings: AgentSettings = {
  display_name: "CareerLoop",
  persona_role: "主动、清晰、帮助用户用已确认证据推进材料的 AI 求职伙伴",
  response_style: "concise",
  custom_instructions: "",
  profile_memory_enabled: true,
  conversation_memory_enabled: true,
  knowledge_memory_enabled: true,
  summary_enabled: true,
  context_message_limit: 12,
  model_name: "gpt-5.5",
  model_base_url: "",
  api_key: "",
  api_key_configured: false
};

export const pageMeta: Record<ViewKey, { title: string; description: string }> = {
  opportunities: { title: "岗位备忘", description: "旧链接仍可用；机会发现不再作为核心模块" },
  workbench: { title: "分析", description: "对照岗位查看匹配；产品主路径是证据账本和用证据出材料" },
  "interview-prep": { title: "面试准备", description: "围绕已确认项目证据练习问答和知识点" },
  "project-lab": { title: "项目证据", description: "从已确认项目证据梳理表达，并进入同一扇面试门" },
  dashboard: { title: "首页", description: "先确认今天的证据，再用证据生成简历等材料" },
  chat: { title: "对话", description: "告诉 CareerLoop 你的目标，开始核对证据或生成材料" },
  settings: { title: "设置", description: "维护账号、模型连接和偏好" }
};

const sectionTitles: Record<ViewKey, string> = {
  dashboard: pageMeta.dashboard.title,
  opportunities: pageMeta.opportunities.title,
  workbench: pageMeta.workbench.title,
  "interview-prep": "面试准备",
  "project-lab": "项目证据",
  chat: "对话",
  settings: "设置"
};

export function topbarSectionForPage(section: ViewKey, title: string): string | undefined {
  if (section === "chat" || section === "settings") return undefined;
  return sectionTitles[section] === title ? undefined : sectionTitles[section];
}

export type SidebarHighlight = "dashboard" | "evidence" | "resume" | "chat" | null;

export function sidebarHighlightForView(
  view: ViewKey,
  extras: { settingsPage?: SettingsPage; workbenchPage?: WorkbenchPage } = {}
): SidebarHighlight {
  if (view === "dashboard") return "dashboard";
  if (view === "chat") return "chat";
  if (view === "settings" && extras.settingsPage === "profile") return "evidence";
  if (view === "workbench" && extras.workbenchPage === "resume") return "resume";
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
