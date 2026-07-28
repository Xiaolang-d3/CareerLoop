import type { AgentSettings, ToolProfile, ViewKey } from "./types";

export const bossHomeUrl = "https://www.zhipin.com/";

export const defaultAgentSettings: AgentSettings = {
  display_name: "BossCopilot",
  persona_role: "理性、坦诚、尊重用户决定的本地求职顾问",
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

export const toolLabels: Record<string, string> = {
  agent_thinking: "模型判断",
  agent_planner: "制定执行计划",
  model_provider: "模型服务",
  analyze_resume_against_jd: "JD 与简历匹配分析",
  search_resume_evidence: "检索简历真实证据",
  generate_tailored_resume_content: "生成高匹配简历内容",
  generate_interview_advice: "生成个人化面试建议",
  research_company: "搜索公司公开资料",
  search_public_web: "联网搜索公开资料"
};

export const toolProfiles: ToolProfile[] = [
  { name: "analyze_resume_against_jd", category: "分析判断", description: "对比用户提供的 BOSS JD 与当前脱敏简历", dataScope: "本轮 JD 与当前简历", control: "自动读取", local: true },
  { name: "search_resume_evidence", category: "读取资料", description: "从脱敏简历中检索相关项目和经历", dataScope: "当前脱敏简历", control: "自动读取", local: true },
  { name: "generate_tailored_resume_content", category: "分析判断", description: "根据用户粘贴的 JD 生成完整、可复制的高匹配简历文本", dataScope: "本轮 JD 与当前脱敏简历", control: "明确指令", local: true },
  { name: "generate_interview_advice", category: "分析判断", description: "结合目标 JD 和当前简历生成个人化面试建议", dataScope: "本轮 JD 与当前脱敏简历", control: "明确指令", local: true },
  { name: "research_company", category: "读取资料", description: "搜索公司官网、新闻和公开风险资料并保留来源", dataScope: "公开互联网", control: "明确指令", local: false },
  { name: "search_public_web", category: "读取资料", description: "在用户为本轮选中联网搜索时读取公开网页", dataScope: "公开互联网", control: "用户确认", local: false }
];

export const pageMeta: Record<ViewKey, { title: string; description: string }> = {
  workbench: { title: "工作台", description: "准备简历和岗位 JD，发起匹配、简历或面试任务" },
  dashboard: { title: "数据看板", description: "查看真实任务数据、最近记录和求职分析沉淀" },
  chat: { title: "对话", description: "查看任务结果，继续追问或修改生成内容" },
  settings: { title: "设置", description: "维护个人资料、当前简历、求职偏好、Agent 和隐私设置" }
};

export const emptyProfile = {
  name: "",
  skills: "",
  targetRole: "",
  targetCity: "",
  salaryMin: ""
};

export const emptyCandidateEditor = {
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
  privacyMode: "redacted" as "redacted" | "original"
};
