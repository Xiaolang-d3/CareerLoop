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

export type LibraryBundle = {
  profile: {
    name: string;
    privacy_mode: "redacted" | "original";
    knowledge_revision: number;
  } | null;
  facts: Array<{
    id: number;
    category: string;
    statement: string;
    status: "pending" | "confirmed" | "disputed" | "retracted";
    value?: Record<string, unknown>;
    source_kind?: string;
    evidence?: Array<{ excerpt?: string; source_title?: string }>;
  }>;
  sources: LibrarySource[];
  folders?: LibraryFolder[];
};

export type LibraryFolder = { id: number; name: string; created_at?: string };
export type LibraryOrganization = { folder_id?: number | null; favorite?: boolean; trashed?: boolean; opened?: boolean };

export type LibrarySource = {
  id: number;
  source_kind: "upload" | "paste" | "legacy";
  title: string;
  original_filename: string;
  mime_type: string;
  source_uri: string;
  privacy_mode: "redacted" | "original";
  enabled: boolean;
  parse_status: "pending" | "ready" | "failed";
  character_count: number;
  file_available: boolean;
  created_at: string;
  updated_at: string;
  folder_id?: number | null;
  favorite?: boolean;
  trashed_at?: string | null;
  last_opened_at?: string | null;
  size_bytes?: number;
};

export type LibrarySourceDetail = LibrarySource & {
  content: string;
  redacted_content: string;
  metadata: Record<string, unknown>;
};

export type LibraryEditor = {
  name: string;
  privacyMode: "redacted" | "original";
};

export type AgentCapabilities = {
  configured?: boolean;
  setup_message?: string;
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
  | "dashboard"
  | "chat"
  | "settings";

export type ModelProtocol = "auto" | "openai" | "responses" | "anthropic" | "gemini" | "ollama";

export type ResolvedModelProtocol = Exclude<ModelProtocol, "auto">;

export type AgentSettings = {
  display_name: string;
  persona_role: string;
  response_style: "concise" | "balanced" | "detailed";
  custom_instructions: string;
  library_memory_enabled: boolean;
  conversation_memory_enabled: boolean;
  knowledge_memory_enabled: boolean;
  summary_enabled: boolean;
  context_message_limit: number;
  model_name: string;
  model_base_url: string;
  model_protocol: ModelProtocol;
  resolved_model_protocol?: ResolvedModelProtocol;
  api_key: string;
  api_key_configured: boolean;
  connection_id?: string;
  config_revision?: number;
  secret_storage_writable?: boolean;
  api_key_source?: string;
  last_save_request_id?: string | null;
  secret_storage?: "keyring" | "environment" | "memory";
  secret_migration_warning?: string;
};

type ModelServiceEvent = {
  id: number;
  request_kind: "generate" | "stream" | "health_check";
  status: "success" | "error";
  error_code: string;
  error_message: string;
  latency_ms: number;
  total_tokens: number;
  model_name: string;
  base_url: string;
  protocol: ResolvedModelProtocol;
  created_at: string;
};

export type ModelCapabilityStatus = "supported" | "unsupported" | "unknown";

export type ModelCapabilityFlag = {
  status: ModelCapabilityStatus;
  source: "model_id" | "probe" | "client";
  detail: string;
};

export type ModelCapabilityReport = {
  connection_id?: string;
  config_revision?: number;
  model_name: string;
  provider: string;
  provider_label: string;
  protocol: ResolvedModelProtocol;
  protocol_label: string;
  vision: ModelCapabilityFlag;
  streaming: ModelCapabilityFlag;
  tools: ModelCapabilityFlag;
  probed: boolean;
  probe_error: string | null;
  attachment_vision_enabled?: boolean;
};

export type ModelServiceMonitor = {
  connection_id?: string;
  config_revision?: number;
  status: "healthy" | "degraded" | "unavailable" | "unknown";
  status_message: string;
  model_name: string;
  base_url: string;
  protocol: ResolvedModelProtocol;
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
    total_tokens?: number;
  };
  usage?: {
    window_hours: number;
    total_tokens: number;
    remaining_quota: number | null;
    quota_available: boolean;
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

export type ModelServiceCheck = ModelServiceMonitor & {
  available: boolean;
  check_error_code: string | null;
  check_error_message: string | null;
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
    stop_reason: string;
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
