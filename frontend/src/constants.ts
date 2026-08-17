import type { AgentSettings, CandidateEditor, ViewKey } from "./types";

export const bossHomeUrl = "https://www.zhipin.com/";

export const defaultAgentSettings: AgentSettings = {
  display_name: "CareerLoop",
  persona_role: "主动、清晰、帮助用户持续推进机会的 AI 求职伙伴",
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
  opportunities: { title: "机会中心", description: "收集、筛选和排序每一个值得推进的机会" },
  workbench: { title: "分析", description: "分析简历、定制投递版本，并准备面试问答" },
  "interview-prep": { title: "项目解析", description: "围绕真实项目证据练习文字问答并回顾知识点" },
  "project-lab": { title: "项目", description: "按描述或代码梳理技术栈、架构、核心和项目情况" },
  dashboard: { title: "首页", description: "先看今天该推进哪一件事，再梳理项目链路和未完成的岗位" },
  chat: { title: "对话", description: "告诉 CareerLoop 你的目标，开始梳理、准备或推进" },
  settings: { title: "设置", description: "维护 CareerLoop 使用的资料、模型连接和偏好" }
};

const sectionTitles: Record<ViewKey, string> = {
  dashboard: pageMeta.dashboard.title,
  opportunities: pageMeta.opportunities.title,
  workbench: pageMeta.workbench.title,
  "interview-prep": "项目解析",
  "project-lab": "项目",
  chat: "对话",
  settings: "设置"
};

export function topbarSectionForPage(section: ViewKey, title: string): string | undefined {
  if (section === "chat" || section === "settings") return undefined;
  return sectionTitles[section] === title ? undefined : sectionTitles[section];
}

export function sidebarHighlightForView(view: ViewKey): "dashboard" | "workbench" | "project-lab" | "chat" | "settings" | null {
  if (view === "dashboard" || view === "workbench" || view === "project-lab" || view === "chat" || view === "settings") return view;
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
