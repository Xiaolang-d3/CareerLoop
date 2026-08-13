export type WorkflowNode = {
  id: string;
  title: string;
  status: "done" | "running" | "pending" | "blocked";
  detail: string;
  hint?: string;
};

export type WorkflowStatus = {
  run?: { id: number; status: string; current_node: string; updated_at: string };
  status: string;
  /** @deprecated 由 stage_counts 派生，仅为兼容旧消费者保留 */
  counts: {
    profiles: number;
    jd_analyses: number;
    resume_evidence_searches: number;
    tailored_resume_generations: number;
    interview_advice_generations: number;
    company_researches: number;
  };
  /** 阶段 id -> 该阶段累计完成的工具调用次数 */
  stage_counts?: Record<string, number>;
  nodes: WorkflowNode[];
  events?: Array<{
    id: number;
    node_id: string;
    event_type: string;
    message: string;
    created_at: string;
  }>;
};

export type Conversation = {
  id: number;
  title: string;
  status: "active" | "archived";
  summary: string;
  message_count?: number;
  task_status?: "active" | "completed" | "cancelled";
  updated_at: string;
  last_message_at?: string | null;
};

export type CareerProfileBundle = {
  profile: {
    id: number;
    name: string;
    locale: string;
    privacy_mode: "redacted" | "original";
    resume_text: string;
    resume_redacted_text: string;
    resume_filename: string;
    knowledge_revision: number;
  } | null;
  active_strategy: {
    id: number;
    name: string;
    target_roles: string[];
    locations: string[];
    salary: { min?: number | null; max?: number | null; currency?: string };
    industries: string[];
    hard_constraints: string[];
    blocked_companies: string[];
    blocked_keywords: string[];
  } | null;
  facts: Array<{
    id: number;
    category: string;
    statement: string;
    status: "pending" | "confirmed" | "disputed" | "retracted";
    value?: Record<string, unknown>;
  }>;
  sources: Array<{
    id: number;
    title: string;
    source_type: string;
    privacy_mode: "redacted" | "original";
    allow_model_original: boolean;
  }>;
};

export type JobProject = {
  id: number;
  conversation_id: number | null;
  conversation_title?: string;
  message_count?: number;
  latest_evaluation_id?: number | null;
  latest_evaluation_at?: string | null;
  latest_evaluation_strategy_id?: number | null;
  career_strategy_id?: number | null;
  job_title: string;
  company_name: string;
  location: string;
  salary_text: string;
  source_url: string;
  description: string;
  notes: string;
  priority: "low" | "medium" | "high";
  created_at: string;
  updated_at: string;
};

export type JobProjectDraft = Pick<
  JobProject,
  | "job_title"
  | "company_name"
  | "location"
  | "salary_text"
  | "source_url"
  | "description"
  | "notes"
  | "priority"
>;

export type JobImportPreview = {
  status:
    | "ready"
    | "partial"
    | "browser_required"
    | "unsupported"
    | "blocked"
    | "invalid";
  source_url: string;
  final_url: string;
  source_domain: string;
  job_title: string;
  company_name: string;
  location: string;
  salary_text: string;
  description: string;
  extraction_method: "json_ld" | "page_text" | "ocr" | "manual_text";
  character_count: number;
  fetched_at: string;
  warnings: string[];
  page_type:
    | "job_detail"
    | "job_list"
    | "company_page"
    | "login_required"
    | "captcha"
    | "job_expired"
    | "access_denied"
    | "empty_page"
    | "unknown";
  confidence: number;
  assessment_reason: string;
  assessment_evidence: string[];
  decision_source:
    | "parser"
    | "rules"
    | "ai"
    | "ai_unavailable"
    | "agent"
    | "agent_error";
  stop_reason: string;
  platform: string;
  requested_page_type: JobImportPreview["page_type"];
  fetch_page_type: JobImportPreview["page_type"];
  agent_rounds: number;
  agent_trace: Array<{
    step: number;
    tool: string;
    status: "done" | "observed" | "blocked" | "failed";
    message: string;
  }>;
};

export type JobImportActivityEvent = {
  type: "started" | "thinking" | "task" | "completed";
  id: string;
  round: number;
  tool?: string;
  status:
    | "thinking"
    | "running"
    | "done"
    | "observed"
    | "blocked"
    | "failed"
    | "ready"
    | "browser_required"
    | "unsupported"
    | "invalid";
  message: string;
};

export type BrowserJobCapture = {
  schema_version: "browser-job-capture-v1";
  capture_id: string;
  requested_url: string;
  final_url: string;
  platform: "boss" | "generic";
  page_type:
    | "job_detail"
    | "login_required"
    | "captcha"
    | "job_expired"
    | "empty_page"
    | "unknown";
  title: string;
  visible_text: string;
  hints: {
    job_title: string;
    company_name: string;
    location: string;
    salary_text: string;
    description: string;
  };
  captured_at: string;
  truncated: boolean;
};

export type JobRequirementStatus = "matched" | "partial" | "no_evidence";

export type JobEvaluationStatus = "queued" | "running" | "completed" | "partial_failed" | "failed" | "cancelled" | "interrupted";
export type JobDecision = "apply" | "consider" | "research_first" | "skip";
export type JobRiskTier = "high_confidence" | "caution" | "suspicious" | "unknown";

export type JobEvaluationSection = {
  id: number;
  section_key: "a" | "b" | "c" | "d" | "e" | "f" | "g";
  title: string;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  confidence: "high" | "medium" | "low" | "unknown";
  content: Record<string, unknown>;
  limitations: string[];
  evidence_refs: string[];
};

export type JobEvaluationDimension = {
  id: number;
  dimension_key: string;
  title: string;
  score: number | null;
  effective_score?: number | null;
  weight: number;
  weighted_score: number | null;
  status: "evaluated" | "unknown";
  effective_status?: "evaluated" | "unknown";
  confidence: string;
  rationale: string[];
  evidence_refs: string[];
};

export type JobEvaluationRequirement = {
  id: number;
  requirement_key: string;
  text: string;
  requirement_type: string;
  importance: "hard" | "core" | "standard" | "bonus";
  match_status: "matched" | "partial" | "no_evidence";
  effective_match_status?: "matched" | "partial" | "no_evidence" | "not_applicable";
  fact_ids: number[];
  adjacent_fact_ids: number[];
  mitigation: string;
  confidence: string;
};

export type JobEvaluationRisk = {
  id: number;
  risk_key: string;
  category: string;
  severity: "info" | "warning" | "high" | "critical";
  effective_severity?: "info" | "warning" | "high" | "critical";
  effective_status?: "active" | "resolved";
  confidence: string;
  observation: string;
  explanation: string;
  evidence_refs: string[];
};

export type JobEvaluation = {
  id: number;
  job_id: number;
  profile_id: number;
  strategy_id: number | null;
  parent_evaluation_id: number | null;
  mode: "full" | "deep";
  status: JobEvaluationStatus;
  current_stage: string;
  include_public_research: number | boolean;
  research_budget: number;
  research_query_count: number;
  overall_score: number | null;
  coverage: number;
  confidence: "high" | "medium" | "low";
  final_decision: JobDecision;
  risk_tier: JobRiskTier;
  effective_overall_score: number | null;
  effective_coverage: number;
  effective_confidence: "high" | "medium" | "low";
  effective_final_decision: JobDecision;
  effective_risk_tier: JobRiskTier;
  is_stale: boolean;
  stale_reasons: string[];
  hard_stops: string[];
  limitations: string[];
  error_message: string;
  sections: JobEvaluationSection[];
  dimensions: JobEvaluationDimension[];
  effective_dimensions: JobEvaluationDimension[];
  requirements: JobEvaluationRequirement[];
  effective_requirements: JobEvaluationRequirement[];
  risks: JobEvaluationRisk[];
  effective_risks: JobEvaluationRisk[];
  created_at: string;
  completed_at: string | null;
  job?: { job_title: string; company_name: string; location: string; salary_text: string; source_url: string };
};

export type ResumeChangeDecision = "pending" | "accepted" | "rejected";
export type ResumeTemplate = "classic" | "compact" | "minimal";

export type QuickMatchResult = {
  job: { title: string; company_name: string; description_character_count: number };
  analysis: {
    required_skills: string[];
    matched_skills: string[];
    missing_skills: string[];
    evidence: Array<{ skills: string[]; text: string }>;
    skill_coverage: number | null;
    confidence: "high" | "limited";
    limitations: string[];
  };
  persistence: "not_saved_as_job";
};

export type ResumeEvidence = {
  source: "job" | "resume" | "user_edit";
  requirement_id: string;
  requirement: string;
  excerpt: string;
};

export type ResumeChange = {
  id: number;
  version_id: number;
  change_type: "target" | "summary" | "skills" | "reorder";
  section_key: "target" | "summary" | "skills" | "body";
  before_text: string;
  after_text: string;
  rationale: string;
  evidence: ResumeEvidence[];
  decision: ResumeChangeDecision;
  user_edited: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ResumeVersionSummary = {
  id: number;
  job_id: number;
  profile_id: number;
  evaluation_id: number | null;
  title: string;
  status: "draft" | "final";
  template_id: ResumeTemplate;
  change_count: number;
  change_counts: Record<ResumeChangeDecision, number>;
  created_at: string;
  updated_at: string;
};

export type ResumeVersion = ResumeVersionSummary & {
  base_content: string;
  rendered_content: string;
  changes: ResumeChange[];
};

export type InterviewType = "general" | "hr" | "business" | "technical" | "final";

export type InterviewTask = {
  id: number;
  kit_id: number;
  category: string;
  title: string;
  completed: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type InterviewKitContent = {
  method: string;
  interview_type: InterviewType;
  positioning: {
    headline: string;
    verified_strengths: string[];
    evidence_gaps: string[];
  };
  self_intro: string;
  self_intro_user_edited: boolean;
  questions: Array<{
    id: string;
    question: string;
    reason: string;
    answer_direction: string;
    evidence: string[];
    status: JobRequirementStatus;
  }>;
  star_stories: Array<{
    id: string;
    title: string;
    source_excerpt: string;
    situation: string;
    task: string;
    action: string;
    result: string;
  }>;
  reverse_questions: string[];
  limitations: string[];
};

export type InterviewKitSummary = {
  id: number;
  job_id: number;
  profile_id: number;
  evaluation_id: number | null;
  interview_type: InterviewType;
  title: string;
  status: "draft" | "ready";
  task_count: number;
  completed_task_count: number;
  created_at: string;
  updated_at: string;
};

export type InterviewKit = InterviewKitSummary & {
  content: InterviewKitContent;
  notes: string;
  tasks: InterviewTask[];
};

export type InterviewRound = {
  id: number;
  job_id: number;
  kit_id: number | null;
  round_type: InterviewType;
  scheduled_at: string | null;
  interviewer: string;
  location: string;
  status: "scheduled" | "completed" | "cancelled";
  outcome: "pending" | "passed" | "failed";
  notes: string;
  created_at: string;
  updated_at: string;
};

export type InterviewPreparationNode = {
  id: string;
  kind: "question" | "knowledge" | "gap";
  title: string;
  completed: boolean;
  note: string;
};

export type InterviewPreparationExperience = {
  id: string;
  title: string;
  evidence: string;
  fields?: Array<{ label: string; value: string }>;
  questions: InterviewPreparationNode[];
  knowledge: InterviewPreparationNode[];
  gaps: InterviewPreparationNode[];
};

export type InterviewPreparationRecord = {
  id: string;
  title: string;
  summary: string;
  occurred_on: string;
};

export type InterviewPreparation = {
  has_profile?: boolean;
  profile: { id: number; name: string };
  source_revision: number;
  stale: boolean;
  has_resume: boolean;
  overview: { target_roles: string[]; summary: string };
  resume_structure?: {
    modules: Array<{ key: string; label: string; fields: Array<{ label: string; value: string }> }>;
    projects: Array<{ title: string; evidence: string; fields: Array<{ label: string; value: string }> }>;
    classified_fragment_count: number;
  } | null;
  resume_analysis?: {
    status: "idle" | "running" | "failed" | "completed";
    phase?: "preparing_resume" | "calling_model" | "validating_result" | "completed";
    message?: string;
  };
  experiences: InterviewPreparationExperience[];
  selected_project_ids: string[];
  job_analysis?: {
    job_description: string;
    summary: { fit: string; matched: string[]; gaps: string[] };
    projects: Array<{
      id: string;
      rewrite: string;
      questions: Array<{ id: string; question: string; focus: string }>;
    }>;
  } | null;
  unclassified_fragments: Array<{ id: string; text: string; decision: "pending" | "confirm_project" | "work_responsibility" | "skill_evidence" | "ignore" }>;
  classified_fragment_count: number;
  ignored_fragment_count: number;
  review_items: InterviewPreparationNode[];
  general_knowledge: InterviewPreparationNode[];
  interview_records: InterviewPreparationRecord[];
};

export type JobEvent = {
  id: number;
  job_id: number;
  event_type: string;
  title: string;
  detail: string;
  occurred_at: string;
  created_at: string;
};

export type ResumeProfileSuggestion = {
  name: string;
  target_roles: string[];
  target_cities: string[];
  skills: string[];
};

export type CandidateEditor = {
  name: string;
  targetRole: string;
  targetCity: string;
  salaryMin: string;
  salaryMax: string;
  skills: string;
  industries: string;
  blockedKeywords: string;
  blockedCompanies: string;
  resumeText: string;
  resumeFilename: string;
  resumeRedactedText: string;
  privacyMode: "redacted" | "original";
};

export type AgentCapabilities = {
  active_model_provider: string;
  active_model_name: string;
  active_platform: string;
  model_providers: string[];
  platforms: string[];
  tools: string[];
  web_research?: {
    enabled: boolean;
    provider: string;
  };
};

export type ViewKey =
  | "opportunities"
  | "workbench"
  | "interview-prep"
  | "dashboard"
  | "chat"
  | "settings";

export type OpportunityRunMode = "scan" | "discover" | "company_funded" | "pipeline" | "batch";
export type OpportunityRunStatus = "queued" | "running" | "waiting_for_user" | "completed" | "partial_failed" | "failed" | "cancelled" | "interrupted";

export type OpportunityRunItem = {
  id: number;
  run_id: number;
  entity_type: string;
  entity_id: number | null;
  label: string;
  stage: string;
  status: "queued" | "running" | "waiting_for_user" | "completed" | "failed" | "cancelled";
  result: Record<string, unknown>;
  error_message: string;
  retry_count: number;
};

export type OpportunityRun = {
  id: number;
  mode: OpportunityRunMode;
  trigger: string;
  strategy_id: number | null;
  status: OpportunityRunStatus;
  config: Record<string, unknown>;
  total_count: number;
  completed_count: number;
  succeeded_count: number;
  failed_count: number;
  waiting_count: number;
  error_message: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  items?: OpportunityRunItem[];
};

export type DiscoveredJobAssessment = {
  id: number;
  analysis_tier: "local" | "deep";
  score: number;
  recommendation: "strong" | "good" | "review" | "not_recommended";
  verdict: "pass" | "marginal" | "fail" | "skip";
  triage_dimensions: Record<string, { score: number; weight: number; status: string }>;
  coverage: number;
  confidence: "high" | "medium" | "low";
  matched_skills: string[];
  evidence_gaps: string[];
  hard_conflicts: string[];
  soft_risks: string[];
  reasons: string[];
  status: "current" | "stale" | "failed";
  created_at: string;
};

export type DiscoveredOpportunity = {
  id: number;
  source_id: number | null;
  canonical_url: string;
  company_name: string;
  job_title: string;
  location: string;
  salary_text: string;
  description: string;
  lifecycle_status: "discovered" | "shortlisted" | "saved" | "dismissed";
  posting_status: "active" | "closed" | "unknown";
  processing_status: "queued" | "processing" | "evaluated" | "failed";
  provider?: string;
  source_company?: string;
  assessment?: DiscoveredJobAssessment | null;
  updated_at: string;
};

export type OpportunitySource = {
  id: number;
  company_id: number | null;
  company_name?: string;
  provider: string;
  platform: string;
  source_url: string;
  access_mode: "public_api" | "public_page" | "browser_visible_only";
  verified: boolean | number;
  enabled: boolean | number;
  last_status: string;
  last_scanned_at: string | null;
};

export type AgentSettings = {
  display_name: string;
  persona_role: string;
  response_style: "concise" | "balanced" | "detailed";
  custom_instructions: string;
  profile_memory_enabled: boolean;
  conversation_memory_enabled: boolean;
  knowledge_memory_enabled: boolean;
  summary_enabled: boolean;
  context_message_limit: number;
  model_name: string;
  model_base_url: string;
  api_key: string;
  api_key_configured: boolean;
};

export type ModelServiceEvent = {
  id: number;
  request_kind: "generate" | "stream" | "health_check";
  status: "success" | "error";
  error_code: string;
  error_message: string;
  latency_ms: number;
  total_tokens: number;
  model_name: string;
  base_url: string;
  created_at: string;
};

export type ModelServiceMonitor = {
  status: "healthy" | "degraded" | "unavailable" | "unknown";
  status_message: string;
  model_name: string;
  base_url: string;
  api_key_configured: boolean;
  window_hours: number;
  summary: {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    success_rate: number | null;
    average_latency_ms: number | null;
    p95_latency_ms: number | null;
    timeout_count: number;
    consecutive_failures: number;
  };
  error_breakdown: Array<{
    code: string;
    label: string;
    count: number;
  }>;
  last_event_at: string | null;
  last_success_at: string | null;
  last_check_at: string | null;
  recent_events: ModelServiceEvent[];
};

export type AgentOperationsSnapshot = {
  window_days: 7 | 30 | 90;
  generated_at: string;
  freshness_at: string | null;
  summary: {
    total_runs: number;
    successful_runs: number;
    failed_runs: number;
    waiting_runs: number;
    cancelled_runs: number;
    success_rate: number | null;
    total_tool_calls: number;
    average_rounds: number | null;
    model_requests: number;
    model_success_rate: number | null;
    model_p95_latency_ms: number | null;
    total_tokens: number;
  };
  status_breakdown: Array<{
    status: "done" | "failed" | "waiting_user" | "cancelled";
    count: number;
  }>;
  trend: Array<{
    date: string;
    label: string;
    total: number;
    done: number;
    failed: number;
    waiting_user: number;
    cancelled: number;
  }>;
  tool_breakdown: Array<{
    name: string;
    label: string;
    count: number;
    failed: number;
  }>;
  route_breakdown: Array<{
    route: string;
    count: number;
  }>;
  recent_runs: Array<{
    id: string;
    message_id: number;
    conversation_id: number;
    conversation_title: string;
    task_id: number | null;
    status: "done" | "failed" | "waiting_user" | "cancelled";
    provider: string;
    platform: string;
    route: string;
    goal: string;
    rounds: number;
    tool_call_count: number;
    tools: string[];
    error_code: string;
    error_message: string;
    created_at: string;
  }>;
  coverage: {
    run_source: string;
    model_source: string;
    precise_run_latency: boolean;
    tokens_attributed_to_run: boolean;
  };
};

export type ToolProfile = {
  name: string;
  category: "读取资料" | "分析判断" | "准备行动" | "进展记录" | "画像维护" | "画像治理" | "结果回流" | "外部读取";
  description: string;
  dataScope: string;
  control: "自动读取" | "用户确认" | "明确指令" | "明确维护意图" | "用户明确确认" | "明确记录意图";
  local: boolean;
};
