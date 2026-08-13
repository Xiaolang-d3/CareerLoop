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
  workbench: { title: "简历分析", description: "查看已保存简历的印象、证据、项目讲法和下一步" },
  "interview-prep": { title: "项目解析", description: "围绕真实项目证据练习文字问答并回顾知识点" },
  dashboard: { title: "求职概览", description: "掌握机会进度、求职节奏和下一步行动" },
  chat: { title: "今天，推进你的下一次机会", description: "告诉 CareerLoop 你的目标，开始梳理、准备或推进" },
  settings: { title: "个人设置", description: "维护 CareerLoop 使用的资料、模型连接和偏好" }
};

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
