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
  dashboard: { title: "首页", description: "查看个人资料快照，再进入简历分析或面试准备" },
  chat: { title: "今天，推进你的下一次机会", description: "告诉 CareerLoop 你的目标，开始梳理、准备或推进" },
  settings: { title: "个人设置", description: "维护 CareerLoop 使用的资料、模型连接和偏好" }
};

const sectionTitles: Record<ViewKey, string> = {
  dashboard: pageMeta.dashboard.title,
  opportunities: pageMeta.opportunities.title,
  workbench: pageMeta.workbench.title,
  "interview-prep": "面试准备",
  chat: "对话",
  settings: "设置"
};

export function topbarSectionForPage(section: ViewKey, title: string): string | undefined {
  if (section === "chat" || section === "settings") return undefined;
  return sectionTitles[section] === title ? undefined : sectionTitles[section];
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
