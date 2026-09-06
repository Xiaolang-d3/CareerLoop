import type { AgentSettings, CandidateEditor, ViewKey } from "./types";
import type { PlaceholderPage, SettingsPage, WorkbenchPage } from "./routing";

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
  opportunities: { title: "AI 问答", description: "旧的岗位发现链接已归入对话" },
  workbench: { title: "工作台", description: "集中编辑、分析和导出生成的内容" },
  "interview-prep": { title: "AI 问答", description: "旧的准备入口已归入对话" },
  "project-lab": { title: "我的知识库", description: "旧的项目入口已归入知识库" },
  dashboard: { title: "首页", description: "查看最近资料、文档和对话" },
  chat: { title: "AI 问答", description: "基于你的资料进行问答、搜索、分析和内容生成" },
  placeholder: { title: "即将推出", description: "该能力仍在建设中" },
  settings: { title: "设置", description: "维护账号、模型连接和偏好" }
};

export const placeholderPageMeta: Record<PlaceholderPage, { title: string; description: string }> = {
  organize: { title: "知识整理", description: "把零散资料整理成可复用的主题与结构" },
  notes: { title: "灵感笔记", description: "快速记下灵感，后续再沉淀进知识库" },
  review: { title: "回顾与复盘", description: "回顾近期学习与协作，形成可执行复盘" },
  graph: { title: "知识图谱", description: "查看概念与资料之间的连接关系" },
  tools: { title: "智能工具", description: "一组辅助整理、检索与创作的小工具" }
};

const sectionTitles: Record<ViewKey, string> = {
  dashboard: pageMeta.dashboard.title,
  opportunities: "AI 问答",
  workbench: "工作台",
  "interview-prep": "AI 问答",
  "project-lab": "我的知识库",
  chat: "AI 问答",
  placeholder: "即将推出",
  settings: "设置"
};

export function topbarSectionForPage(section: ViewKey, title: string): string | undefined {
  if (section === "chat" || section === "settings" || section === "placeholder") return undefined;
  return sectionTitles[section] === title ? undefined : sectionTitles[section];
}

export type SidebarHighlight =
  | "dashboard"
  | "library"
  | "chat"
  | "organize"
  | "workspace"
  | "notes"
  | "review"
  | "graph"
  | "tools"
  | "settings"
  | null;

export function sidebarHighlightForView(
  view: ViewKey,
  extras: { settingsPage?: SettingsPage; workbenchPage?: WorkbenchPage; placeholderPage?: PlaceholderPage } = {}
): SidebarHighlight {
  if (view === "dashboard") return "dashboard";
  if (view === "chat") return "chat";
  if (view === "settings" && extras.settingsPage === "profile") return "library";
  if (view === "settings" && extras.settingsPage && extras.settingsPage !== "profile") return "settings";
  if (view === "settings") return "settings";
  if (view === "workbench" && (extras.workbenchPage === "resume" || extras.workbenchPage === "index" || !extras.workbenchPage)) {
    return "workspace";
  }
  if (view === "placeholder" && extras.placeholderPage) return extras.placeholderPage;
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
