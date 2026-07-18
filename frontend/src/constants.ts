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
  context_message_limit: 12
};

export const applicationLabels: Record<string, string> = {
  queued: "待投递",
  applied: "已投递",
  contacted: "已沟通",
  interview: "面试中",
  rejected: "未通过",
  no_response: "暂无回复"
};

export const toolLabels: Record<string, string> = {
  agent_thinking: "模型判断",
  agent_planner: "制定执行计划",
  agent_replanner: "调整后续计划",
  model_provider: "模型服务",
  get_candidate_context: "读取求职画像",
  request_manual_job_import: "请求手动导入岗位",
  get_job_detail: "读取本地岗位详情",
  rank_jobs: "初步匹配排序",
  analyze_job: "深度匹配分析",
  analyze_resume_gap: "简历岗位差距分析",
  search_local_knowledge: "检索本地资料",
  update_job_status: "更新岗位状态",
  save_greeting_draft: "保存沟通草稿",
  queue_application: "加入待投队列",
  update_application_status: "更新求职进展"
};

export const toolProfiles: ToolProfile[] = [
  { name: "get_candidate_context", category: "读取资料", description: "读取人物画像、脱敏简历和求职偏好", dataScope: "本地个人资料", control: "自动读取", local: true },
  { name: "request_manual_job_import", category: "读取资料", description: "请求用户粘贴岗位文字或上传截图", dataScope: "用户主动提供的岗位", control: "用户确认", local: true },
  { name: "get_job_detail", category: "读取资料", description: "读取已经确认导入的完整岗位信息", dataScope: "本地岗位库", control: "自动读取", local: true },
  { name: "rank_jobs", category: "分析判断", description: "依据画像、城市、薪资和屏蔽条件排序", dataScope: "画像与岗位摘要", control: "自动读取", local: true },
  { name: "analyze_job", category: "分析判断", description: "评估岗位匹配理由、风险和建议角度", dataScope: "画像与岗位详情", control: "自动读取", local: true },
  { name: "analyze_resume_gap", category: "分析判断", description: "找出简历技能命中、缺口和真实证据", dataScope: "简历与岗位详情", control: "自动读取", local: true },
  { name: "search_local_knowledge", category: "分析判断", description: "从简历、岗位和本地资料中检索证据", dataScope: "脱敏本地知识库", control: "自动读取", local: true },
  { name: "update_job_status", category: "准备行动", description: "把岗位标记为候选或跳过", dataScope: "本地岗位状态", control: "明确指令", local: true },
  { name: "save_greeting_draft", category: "准备行动", description: "根据真实经历生成并保存沟通草稿", dataScope: "画像、岗位与草稿", control: "明确指令", local: true },
  { name: "queue_application", category: "准备行动", description: "将岗位加入本地待投递清单", dataScope: "本地待投记录", control: "明确指令", local: true },
  { name: "update_application_status", category: "进展记录", description: "记录已沟通、已投递和面试等真实进展", dataScope: "本地求职进展", control: "明确指令", local: true }
];

export const pageMeta: Record<ViewKey, { title: string; description: string }> = {
  chat: { title: "Agent 对话", description: "把岗位、简历和求职决策放在同一个上下文里" },
  profile: { title: "我的资料", description: "维护求职画像与简历，所有内容默认保存在本地" },
  jobs: { title: "岗位工作台", description: "集中比较已确认导入的真实岗位" },
  tools: { title: "Agent 工具", description: "查看 Agent 可以调用的数据与能力边界" },
  agent: { title: "Agent 设置", description: "调整表达、记忆和当前对话上下文" },
  applications: { title: "投递记录", description: "由你确认并记录真实的沟通与投递进展" },
  review: { title: "求职复盘", description: "用清晰的阶段数据判断下一步行动" }
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

export const emptyJobImport = {
  title: "",
  company: "",
  sourceUrl: "",
  location: "",
  salaryText: "",
  experience: "",
  education: "",
  description: "",
  inputMethod: "paste" as "paste" | "screenshot"
};
