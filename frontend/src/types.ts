export type Job = {
  id: number;
  source?: string;
  source_url?: string;
  title: string;
  company: string;
  city: string;
  district: string;
  salary_text: string;
  experience: string;
  education: string;
  industry?: string;
  company_size?: string;
  hr_active_text?: string;
  description: string;
  status: string;
};

export type Application = {
  id: number;
  job_id: number;
  profile_id: number;
  status: string;
  notes: string;
  job_title?: string;
  company?: string;
};

export type WorkflowNode = {
  id: string;
  title: string;
  status: "done" | "running" | "pending" | "blocked";
  detail: string;
};

export type WorkflowStatus = {
  run?: { id: number; status: string; current_node: string; updated_at: string };
  status: string;
  counts: {
    profiles: number;
    jobs: number;
    applications: number;
    matches?: number;
    drafts?: number;
    queued_applications?: number;
    progressed_applications?: number;
  };
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

export type CandidateProfileBundle = {
  profile: {
    id: number;
    name: string;
    resume_text: string;
    resume_filename?: string;
    resume_redacted_text?: string;
    privacy_mode?: "redacted" | "original";
    skills: string[];
    projects: Array<Record<string, unknown>>;
  } | null;
  preferences: {
    target_roles: string[];
    target_cities: string[];
    salary_min: number | null;
    salary_max: number | null;
    preferred_industries: string[];
    blocked_keywords: string[];
    blocked_companies: string[];
  } | null;
};

export type AgentCapabilities = {
  active_model_provider: string;
  active_model_name: string;
  active_platform: string;
  model_providers: string[];
  platforms: string[];
  tools: string[];
};

export type ViewKey =
  | "chat"
  | "profile"
  | "jobs"
  | "tools"
  | "agent"
  | "applications"
  | "review";

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
};

export type ToolProfile = {
  name: string;
  category: "读取资料" | "分析判断" | "准备行动" | "进展记录";
  description: string;
  dataScope: string;
  control: "自动读取" | "用户确认" | "明确指令";
  local: boolean;
};
