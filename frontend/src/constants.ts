import type { AgentSettings, CandidateEditor, ToolProfile, ViewKey } from "./types";

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

export const toolLabels: Record<string, string> = {
  agent_thinking: "模型判断",
  agent_planner: "制定执行计划",
  model_provider: "模型服务",
  analyze_resume_against_jd: "JD 与简历匹配分析",
  search_resume_evidence: "检索简历真实证据",
  generate_tailored_resume_content: "生成高匹配简历内容",
  generate_interview_advice: "生成个人化面试建议",
  research_company: "搜索公司公开资料",
  search_public_web: "联网搜索公开资料",
  get_candidate_context: "装配最小候选人上下文",
  search_candidate_evidence: "检索已确认候选人证据",
  propose_candidate_knowledge: "创建待确认候选人知识",
  review_candidate_knowledge: "审核候选人知识",
  analyze_job_against_strategy: "按职业策略分析岗位",
  generate_candidate_material: "生成可信求职材料",
  record_interview_debrief: "记录面试复盘",
  discover_companies: "发现适合的公司",
  discover_funded_companies: "发现近期融资公司",
  scan_career_sources: "扫描官方职位来源",
  process_opportunity_pipeline: "评估发现岗位队列"
};

export const toolProfiles: ToolProfile[] = [
  { name: "analyze_resume_against_jd", category: "分析判断", description: "对比用户提供的 BOSS JD 与当前脱敏简历", dataScope: "本轮 JD 与当前简历", control: "自动读取", local: true },
  { name: "search_resume_evidence", category: "读取资料", description: "从脱敏简历中检索相关项目和经历", dataScope: "当前脱敏简历", control: "自动读取", local: true },
  { name: "generate_tailored_resume_content", category: "分析判断", description: "根据用户粘贴的 JD 生成完整、可复制的高匹配简历文本", dataScope: "本轮 JD 与当前脱敏简历", control: "明确指令", local: true },
  { name: "generate_interview_advice", category: "分析判断", description: "结合目标 JD 和当前简历生成个人化面试建议", dataScope: "本轮 JD 与当前脱敏简历", control: "明确指令", local: true },
  { name: "research_company", category: "读取资料", description: "搜索公司官网、新闻和公开风险资料并保留来源", dataScope: "公开互联网", control: "明确指令", local: false },
  { name: "search_public_web", category: "读取资料", description: "在用户为本轮选中联网搜索时读取公开网页", dataScope: "公开互联网", control: "用户确认", local: false },
  { name: "get_candidate_context", category: "读取资料", description: "按任务和职业策略装配最小候选人上下文", dataScope: "已确认事实与策略", control: "自动读取", local: true },
  { name: "search_candidate_evidence", category: "读取资料", description: "检索已确认事实及来源摘录", dataScope: "候选人知识库", control: "自动读取", local: true },
  { name: "propose_candidate_knowledge", category: "画像维护", description: "把对话内容加入待确认知识队列", dataScope: "当前用户输入", control: "明确维护意图", local: true },
  { name: "review_candidate_knowledge", category: "画像治理", description: "确认、编辑、拒绝或撤回候选人知识", dataScope: "候选人知识库", control: "用户明确确认", local: true },
  { name: "analyze_job_against_strategy", category: "分析判断", description: "只用已确认事实按职业策略分析岗位", dataScope: "岗位 JD、策略与确认事实", control: "自动读取", local: true },
  { name: "generate_candidate_material", category: "分析判断", description: "生成简历、自我介绍、面试答案或沟通草稿并执行事实门", dataScope: "最小任务上下文", control: "明确指令", local: true },
  { name: "record_interview_debrief", category: "结果回流", description: "记录真实问题、原回答和反馈，生成待确认提案", dataScope: "当前面试复盘", control: "明确记录意图", local: true },
  { name: "discover_companies", category: "外部读取", description: "发现公司官网和官方招聘页", dataScope: "公开互联网", control: "明确指令", local: false },
  { name: "discover_funded_companies", category: "外部读取", description: "用公开证据发现近期融资公司", dataScope: "公司公告、投资机构公告与公开新闻", control: "明确指令", local: false },
  { name: "scan_career_sources", category: "外部读取", description: "扫描已验证的官方职位来源", dataScope: "公开职位页与 ATS", control: "明确指令", local: false },
  { name: "process_opportunity_pipeline", category: "分析判断", description: "批量评估已导入岗位但不代替用户决策", dataScope: "岗位 JD、职业策略与已确认事实", control: "明确指令", local: true }
];

export const pageMeta: Record<ViewKey, { title: string; description: string }> = {
  opportunities: { title: "机会中心", description: "收集、筛选和排序每一个值得推进的机会" },
  workbench: { title: "求职工坊", description: "填写岗位描述和任职要求，对照简历做分析和面试准备" },
  "interview-prep": { title: "项目解析", description: "围绕真实项目证据练习文字问答并回顾知识点" },
  dashboard: { title: "求职概览", description: "掌握机会进度、求职节奏和下一步行动" },
  chat: { title: "今天，推进你的下一次机会", description: "告诉 CareerLoop 你的目标，开始梳理、准备或推进" },
  settings: { title: "个人设置", description: "维护 CareerLoop 使用的资料、模型连接和偏好" }
};

export const emptyProfile = {
  name: "",
  skills: "",
  targetRole: "",
  targetCity: "",
  salaryMin: ""
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
