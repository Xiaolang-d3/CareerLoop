import type { Conversation, JobProject } from "../../types";

export const RESUME_PREP_JOB_TITLE = "按简历准备";

const PROFILE_FIELDS = ["name", "targetRole", "targetCity", "skills", "resumeText"] as const;

const SKILL_LEAD = /^(?:熟练掌握|熟练使用|具备|擅长|熟悉|精通|掌握|了解)\s*/;
const SKILL_HEADING = /^(?:专业技能|技能清单|技能|skills)\s*[:：]?\s*/i;
const SKILL_SPLIT = /[，,、/|;；]+/;
const SKILL_AND = /[与和]/;
const SKILL_ACTION = /负责|主导|独立|完成|实现|开发|设计|优化|搭建|落地|编写|重构|排查|上线|部署|接入|参与|推动/;
const HOME_SKILL_MAX_LEN = 16;
const HOME_SKILL_LIMIT = 16;

export function splitHomeTags(value: string) {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}

export function homeSkillTags(value: string) {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (part: string) => {
    const tag = normalizeHomeSkillTag(part);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    if ([...seen].some((item) => item.length >= 3 && containsSkillTerm(key, item))) return;
    seen.add(key);
    found.push(tag);
  };

  for (const chunk of splitHomeTags(value)) {
    const headed = SKILL_HEADING.test(chunk);
    const rest = chunk.replace(SKILL_HEADING, "").trim();
    const lead = rest.match(SKILL_LEAD);
    if (lead || headed || looksLikeSkillList(rest)) {
      const body = (lead ? rest.slice(lead[0].length) : rest).replace(/[。！？.;；]+$/, "");
      for (const part of body.split(SKILL_SPLIT)) {
        for (const piece of expandSkillParts(part)) add(piece);
      }
      continue;
    }
    add(chunk);
  }
  return found.slice(0, HOME_SKILL_LIMIT);
}

function looksLikeSkillList(line: string) {
  return (line.match(/[、，,/|]/g) || []).length >= 2 && !SKILL_ACTION.test(line);
}

function expandSkillParts(part: string) {
  const pieces = part.split(SKILL_AND).map((item) => item.trim()).filter(Boolean);
  if (pieces.length >= 2 && pieces.every((item) => item.length > 1 && item.length <= 8)) {
    return pieces;
  }
  return [part];
}

function normalizeHomeSkillTag(part: string) {
  const tag = part.trim().replace(/^[的了\s]+|[的了\s]+$/g, "").replace(/(?:能力|相关经验)$/, "").trim();
  if (!tag || tag.length > HOME_SKILL_MAX_LEN) return "";
  if (/[。！？]/.test(tag) || SKILL_LEAD.test(tag)) return "";
  if (SKILL_ACTION.test(tag) && tag.length > 8) return "";
  return tag;
}

function containsSkillTerm(haystack: string, needle: string) {
  if (/^[a-z0-9.+#-]+$/i.test(needle)) {
    return new RegExp(`(?<![a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(haystack);
  }
  return haystack.includes(needle);
}

export function profileCompleteness(input: {
  name?: string;
  targetRole?: string;
  targetCity?: string;
  skills?: string;
  resumeText?: string;
}) {
  const filled = PROFILE_FIELDS.filter((field) => (
    field === "skills" ? splitHomeTags(input.skills || "").length > 0 : Boolean(input[field]?.trim())
  )).length;
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}

export function isSettingsProfileReady(input: {
  name?: string;
  targetRole?: string;
  targetCity?: string;
  skills?: string;
  resumeText?: string;
}) {
  const hasName = Boolean(input.name?.trim());
  const hasResume = Boolean(input.resumeText?.trim());
  if (hasName && hasResume) return true;
  const documented = PROFILE_FIELDS.filter((field) => field !== "name" && field !== "resumeText").every((field) => (
    field === "skills" ? splitHomeTags(input.skills || "").length > 0 : Boolean(input[field]?.trim())
  ));
  return hasName && documented;
}

export function latestJobAnalysisAt(jobs: JobProject[]) {
  const times = jobs
    .map((job) => job.latest_evaluation_at)
    .filter((value): value is string => Boolean(value));
  if (!times.length) return null;
  return times.reduce((latest, current) => (current > latest ? current : latest));
}

export type HomeNextAction = "analysis" | "profile";
export type HomeQueueKind = "profile" | "review" | "analysis" | "resume" | "interview" | "chat";

export type HomeQueueItem = {
  id: string;
  kind: HomeQueueKind;
  label: string;
  detail: string;
  jobId?: number;
  conversationId?: number;
};

export type HomeContinueItem = {
  id: string;
  kind: "job" | "chat";
  title: string;
  detail: string;
  stamp: string;
  jobId?: number;
  conversationId?: number;
};

export const HOME_INBOX_LIMIT = 3;

const SKILL_WRAPPER_LEAD = /^(?:熟练掌握|熟练使用|具备|擅长|熟悉|精通|掌握|了解)\s*/;
const SKILL_WRAPPER_TAIL = /\s+相关经验$/;

export type HomePendingFact = {
  id: number;
  statement: string;
  category?: string;
  value?: { name?: string };
  sourceKind?: string;
  evidence?: Array<{ excerpt?: string; source_title?: string }>;
};

export type HomeInboxItem = {
  id: number;
  title: string;
  consequence: string;
  source: string;
  sourceLabel: string;
};

export function unwrapInboxSkill(text: string) {
  return text
    .replace(SKILL_WRAPPER_LEAD, "")
    .replace(SKILL_WRAPPER_TAIL, "")
    .trim();
}

export function inboxFactLabel(fact: Pick<HomePendingFact, "statement" | "value">) {
  const named = unwrapInboxSkill(fact.value?.name?.trim() || "");
  if (named) return named;
  return unwrapInboxSkill(fact.statement) || fact.statement.trim();
}

export function isCleanInboxSkill(tag: string) {
  const clean = tag.trim();
  if (!clean || clean.length > HOME_SKILL_MAX_LEN) return false;
  if (/[。！？、，,]/.test(clean)) return false;
  if (SKILL_WRAPPER_LEAD.test(clean)) return false;
  return true;
}

export function homeInboxItems(
  facts: HomePendingFact[],
  options: { resumeText?: string; knownSkills?: string[] } = {}
): HomeInboxItem[] {
  const known = new Set((options.knownSkills || []).map((item) => item.trim().toLowerCase()).filter(Boolean));
  const resumeText = options.resumeText || "";
  const items: HomeInboxItem[] = [];
  for (const fact of facts) {
    const category = fact.category || "";
    if (category === "skill") {
      const title = inboxFactLabel(fact);
      if (!isCleanInboxSkill(title) || known.has(title.toLowerCase())) continue;
      const source = inboxSourceQuote(fact, title, resumeText);
      items.push({
        id: fact.id,
        title,
        consequence: `确认后会把「${title}」写入画像技能，并参与岗位评分`,
        source,
        sourceLabel: inboxSourceLabel(fact, source)
      });
      continue;
    }
    const title = fact.statement.trim();
    if (!title) continue;
    const source = inboxSourceQuote(fact, title, resumeText);
    items.push({
      id: fact.id,
      title,
      consequence: inboxConsequence(category),
      source,
      sourceLabel: inboxSourceLabel(fact, source)
    });
  }
  return items;
}

function inboxConsequence(category: string) {
  if (category === "achievement") return "确认后会把这条成果写入画像，并参与岗位评分";
  if (category === "project") return "确认后会把这个项目写入已确认知识，并参与岗位评分";
  if (category === "experience") return "确认后会把这条经历写入已确认知识，并参与岗位评分";
  return "确认后会写入已确认知识，并参与岗位评分";
}

function inboxSourceQuote(fact: HomePendingFact, title: string, resumeText: string) {
  const excerpt = fact.evidence?.[0]?.excerpt?.trim() || "";
  const resumeLine = resumeLineContaining(title, resumeText);
  if (resumeLine && resumeLine !== title) return resumeLine;
  if (excerpt && excerpt !== title && !SKILL_WRAPPER_LEAD.test(excerpt)) return excerpt;
  return resumeLine === title ? "" : resumeLine;
}

function inboxSourceLabel(fact: HomePendingFact, source: string) {
  const kind = fact.sourceKind || "";
  if (kind === "interview_debrief" || kind === "profile_interview") return "面试记录";
  if (kind === "agent_proposal") return "对话提议";
  const title = fact.evidence?.[0]?.source_title?.trim() || "";
  if (title && title !== "候选人资料") return title;
  if (kind === "resume_parser" || source) return "简历原句";
  return "来源";
}

function resumeLineContaining(term: string, resumeText: string) {
  const needle = term.trim().toLowerCase();
  if (!needle || !resumeText.trim()) return "";
  for (const raw of resumeText.split(/\n/)) {
    const line = raw.trim().replace(/^[-•*·]\s*/, "");
    if (line && line.toLowerCase().includes(needle)) return line;
  }
  return "";
}

export type HomeJobProgress = {
  total: number;
  analyzed: number;
  unevaluated: number;
  highPriority: number;
  nextUnevaluated: JobProject | null;
};

function isResumePrepJob(job: JobProject) {
  return job.job_title === RESUME_PREP_JOB_TITLE;
}

export function jobLabel(job: JobProject) {
  return [job.company_name.trim(), job.job_title.trim()].filter(Boolean).join(" · ") || "未命名岗位";
}

export function realJobs(jobs: JobProject[]) {
  return jobs.filter((job) => !isResumePrepJob(job));
}

export function homeJobProgress(jobs: JobProject[]): HomeJobProgress {
  const listed = realJobs(jobs);
  const unevaluatedJobs = listed.filter((job) => !job.latest_evaluation_at);
  return {
    total: listed.length,
    analyzed: listed.filter((job) => Boolean(job.latest_evaluation_at)).length,
    unevaluated: unevaluatedJobs.length,
    highPriority: listed.filter((job) => job.priority === "high").length,
    nextUnevaluated: unevaluatedJobs[0] ?? null
  };
}

function conversationStamp(conversation: Conversation) {
  return conversation.last_message_at || conversation.updated_at;
}

function latestActiveConversation(conversations: Conversation[]) {
  return [...conversations]
    .filter((item) => item.status === "active" && (item.message_count ?? 0) > 0)
    .sort((left, right) => conversationStamp(right).localeCompare(conversationStamp(left)))[0] ?? null;
}

export function homeActionQueue(input: {
  profileLoaded: boolean;
  hasResume: boolean;
  completeness: number | null;
  lastAnalysis: string | null;
  jobsReady?: boolean;
  pendingFactCount?: number;
  jobs?: JobProject[];
  conversations?: Conversation[];
}): HomeQueueItem[] {
  const items: HomeQueueItem[] = [];
  const push = (item: HomeQueueItem) => {
    if (items.some((current) => current.id === item.id || (current.kind === item.kind && current.label === item.label))) return;
    items.push(item);
  };

  if (!input.profileLoaded) {
    return [{
      id: "profile-loading",
      kind: "profile",
      label: "完善资料库",
      detail: "资料读取后，这里会给出下一步。"
    }];
  }
  if (!input.hasResume) {
    push({
      id: "save-resume",
      kind: "profile",
      label: "先保存简历",
      detail: "资料库和工作台需要一份可复用的基础资料。"
    });
  } else if (input.completeness != null && input.completeness < 80) {
    push({
      id: "complete-profile",
      kind: "profile",
      label: "完善资料库",
      detail: "补齐方向、城市和技能，后续判断会更准。"
    });
  }

  const pendingFactCount = input.pendingFactCount ?? 0;
  if (pendingFactCount > 0) {
    push({
      id: "review-facts",
      kind: "review",
      label: pendingFactCount === 1 ? "确认 1 条待审知识" : `确认 ${pendingFactCount} 条待审知识`,
      detail: "待确认内容不会写入资料库，请先核对。"
    });
  }

  if (input.hasResume && pendingFactCount === 0 && !items.some((item) => item.kind === "profile")) {
    push({
      id: "view-evidence",
      kind: "profile",
      label: "查看资料库",
      detail: "核对已保存的信息，并继续用于分析或内容生成。"
    });
  }

  const jobsReady = input.jobsReady ?? true;
  const progress = homeJobProgress(input.jobs || []);
  if (jobsReady && progress.nextUnevaluated) {
    push({
      id: `evaluate-${progress.nextUnevaluated.id}`,
      kind: "analysis",
      label: `评估 ${jobLabel(progress.nextUnevaluated)}`,
      detail: "这份岗位还没有分析。",
      jobId: progress.nextUnevaluated.id
    });
  } else if (jobsReady && input.hasResume && !input.lastAnalysis) {
    push({
      id: "analyze-resume",
      kind: "analysis",
      label: "去分析简历",
      detail: "需要时再对照岗位看匹配。"
    });
  } else if (jobsReady && input.hasResume && input.lastAnalysis) {
    push({
      id: "continue-analysis",
      kind: "analysis",
      label: "继续分析",
      detail: "对照新岗位，或回看最近一次分析。"
    });
  }

  const conversation = latestActiveConversation(input.conversations || []);
  if (conversation) {
    push({
      id: `chat-${conversation.id}`,
      kind: "chat",
      label: "继续上次对话",
      detail: conversation.title.trim() || "回到还没结束的对话。",
      conversationId: conversation.id
    });
  }

  if (input.hasResume) {
    push({
      id: "tailor-resume",
      kind: "resume",
      label: "去定制简历",
      detail: "选择类型和模板，编辑并导出一版简历。"
    });
    push({
      id: "interview",
      kind: "interview",
      label: "去面试准备",
      detail: "围绕已确认项目证据练习表达。"
    });
  }

  return items;
}

export function homeContinueItems(input: {
  jobs: JobProject[];
  conversations: Conversation[];
  excludeJobId?: number;
  excludeConversationId?: number;
}): HomeContinueItem[] {
  const items: HomeContinueItem[] = [];
  const usedConversationIds = new Set<number>();

  const jobs = [...realJobs(input.jobs)]
    .filter((job) => job.id !== input.excludeJobId)
    .sort((left, right) => (
      (right.updated_at || right.latest_evaluation_at || right.created_at)
        .localeCompare(left.updated_at || left.latest_evaluation_at || left.created_at)
    ));

  for (const job of jobs.slice(0, 2)) {
    if (job.conversation_id) usedConversationIds.add(job.conversation_id);
    items.push({
      id: `job-${job.id}`,
      kind: "job",
      title: jobLabel(job),
      detail: job.latest_evaluation_at ? "已分析，继续推进" : "还没有评估",
      stamp: job.updated_at || job.latest_evaluation_at || job.created_at,
      jobId: job.id
    });
  }

  const conversations = [...input.conversations]
    .filter((item) => item.status === "active" && (item.message_count ?? 0) > 0)
    .filter((item) => item.id !== input.excludeConversationId && !usedConversationIds.has(item.id))
    .sort((left, right) => conversationStamp(right).localeCompare(conversationStamp(left)));

  for (const conversation of conversations.slice(0, 2)) {
    items.push({
      id: `chat-${conversation.id}`,
      kind: "chat",
      title: conversation.title.trim() || "未命名对话",
      detail: conversation.task_status === "active" ? "进行中" : "继续对话",
      stamp: conversationStamp(conversation),
      conversationId: conversation.id
    });
  }

  return items.slice(0, 3);
}

export function homeNextStep(input: {
  profileLoaded: boolean;
  hasResume: boolean;
  completeness: number | null;
  lastAnalysis: string | null;
}): { action: HomeNextAction; label: string; detail: string } {
  const [first] = homeActionQueue(input);
  return {
    action: first.kind === "analysis" || first.kind === "resume" || first.kind === "interview" || first.kind === "chat"
      ? "analysis"
      : "profile",
    label: first.label,
    detail: first.detail
  };
}

export const HOME_PROJECT_LIMIT = 5;
const HOME_STAGE_MAX_LEN = 36;
const INPUT_FIELD = /背景|目标|职责|负责|角色|岗位/;
const PROCESS_FIELD = /方案|技术|架构|栈|挑战|取舍|决策|实现|模块/;
const OUTPUT_FIELD = /结果|指标|成果|影响|收益|效果/;

export type HomeProjectField = { label: string; value: string };

export type HomeProjectInput = {
  id: string;
  title: string;
  evidence: string;
  fields?: HomeProjectField[];
  gaps?: Array<{ completed: boolean }>;
};

export type HomeProjectLaneKey = "input" | "process" | "output";

export type HomeProjectLane = {
  key: HomeProjectLaneKey;
  index: number;
  label: string;
  value: string;
  empty: boolean;
};

export type HomeProjectReview = {
  id: string;
  title: string;
  gapCount: number;
  lanes: HomeProjectLane[];
};

export function homeProjectReviews(projects: HomeProjectInput[]): HomeProjectReview[] {
  return projects.slice(0, HOME_PROJECT_LIMIT).map((project) => {
    const gapCount = (project.gaps || []).filter((item) => !item.completed).length;
    return {
      id: project.id,
      title: project.title.trim() || "未命名项目",
      gapCount,
      lanes: homeProjectLanes(project)
    };
  });
}

export function homeProjectLanes(project: HomeProjectInput): HomeProjectLane[] {
  const buckets: Record<HomeProjectLaneKey, string[]> = { input: [], process: [], output: [] };
  const fields = (project.fields || []).filter((item) => item.value.trim());
  if (fields.length) {
    for (const field of fields) {
      buckets[classifyProjectField(field.label)].push(field.value.trim());
    }
  } else {
    const beats = evidenceBeats(project.evidence, project.title);
    beats.forEach((beat, index) => {
      const key = index === 0 ? "input" : index === beats.length - 1 && beats.length > 1 ? "output" : "process";
      buckets[key].push(beat);
    });
  }
  return [
    lane("input", 1, "职责", buckets.input),
    lane("process", 2, "方案", buckets.process),
    lane("output", 3, "结果", buckets.output)
  ];
}

function classifyProjectField(label: string): HomeProjectLaneKey {
  if (OUTPUT_FIELD.test(label)) return "output";
  if (PROCESS_FIELD.test(label)) return "process";
  if (INPUT_FIELD.test(label)) return "input";
  return "process";
}

function evidenceBeats(evidence: string, title: string) {
  const heading = title.trim();
  return evidence.split(/\n/).map((line) => line.replace(/^[-•*·]\s*/, "").trim()).filter((line) => {
    if (!line) return false;
    if (heading && (line === heading || line.startsWith(heading))) return false;
    return true;
  }).slice(0, 3);
}

function lane(key: HomeProjectLaneKey, index: number, label: string, values: string[]): HomeProjectLane {
  const value = clipHomeStage(values.slice(0, 2).join(" · "));
  return { key, index, label, value, empty: !value };
}

function clipHomeStage(value: string) {
  if (value.length <= HOME_STAGE_MAX_LEN) return value;
  return `${value.slice(0, HOME_STAGE_MAX_LEN - 1)}…`;
}
