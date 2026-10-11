import type { RefObject } from "react";
import type { AgentCapabilities, Conversation } from "../../types";

export type WebSearchTopic = "auto" | "general" | "news" | "finance";
export type WebSearchSourcePreference = "none" | "technical";
export type WebSearchOptions = {
  version: 1;
  enabled: boolean;
  topic: WebSearchTopic;
  source_preference: WebSearchSourcePreference;
  provider?: string;
};

export type ModelSelection = {
  profile_id: string;
  connection_id: string;
  profile_revision: number;
  connection_revision: number;
  model_name: string;
  model_base_url?: string;
  model_protocol?: string;
  policy_version?: number;
  selection_reason?: string;
  capability_status?: string;
  stage_selections?: Record<string, { model_name?: string; profile_id?: string; profile_revision?: number; connection_revision?: number; selection_reason?: string; capability_status?: string }>;
};

export type AgentRunResult = {
  model_selection?: ModelSelection;
  provider: string;
  platform: string;
  rounds: number;
  status: "done" | "failed" | "waiting_user" | "cancelled";
  stop_reason?: string;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  error?: { code: string; message: string; retryable: boolean } | null;
  events: Array<{
    round: number;
    tool_call_id: string;
    tool_name: string;
    status: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
  plan?: {
    goal: string;
    route: string;
    requires_confirmation: boolean;
    steps: Array<{
      id: string;
      title: string;
      tool_name: string;
      risk: "read_only" | "analysis" | "local_write" | "user_input";
      status: "pending" | "running" | "done" | "failed" | "blocked";
    }>;
  } | null;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  payload?: {
    agent?: AgentRunResult;
    model_selection?: ModelSelection;
    attachments?: ChatAttachment[];
    web_search?: boolean;
    web_search_topic?: WebSearchTopic;
    web_search_source_preference?: WebSearchSourcePreference;
    web_search_options?: WebSearchOptions;
    web_search_mode?: WebSearchMode;
  };
};

export type ChatAttachment = {
  id: string;
  kind: "image" | "document";
  original_filename: string;
  parse_status: "pending" | "parsed" | "failed";
  content_type?: string;
  size_bytes?: number;
  vision_status?: "not_requested" | "consented" | "failed";
  parsed_text?: string;
  redacted_text?: string;
  metadata?: { character_count?: number; privacy_findings?: Array<{ entity_type: string; preview: string }> };
};

export type AttachmentConfig = {
  storage: "local" | "minio";
  vision_enabled: boolean;
  vision_ready: boolean;
  vision_url_ttl_seconds: number;
  requires_public_endpoint: boolean;
  checks?: Array<{
    key: string;
    label: string;
    status: "ok" | "warning" | "disabled";
    message: string;
  }>;
};

export type ChatRetryDraft = {
  content: string;
  modelProfileId?: string | null;
  attachmentIds: string[];
  visionAttachmentIds: string[];
  webSearch: boolean;
  webSearchTopic: WebSearchTopic;
  webSearchSourcePreference: WebSearchSourcePreference;
  webSearchProvider?: string;
  runId?: string;
  rewindMessageId?: number;
  reason?: "send_failed" | "interrupted";
};

export type WebSearchMode = "auto" | "technical" | "general";

export type ChatClarificationOption = {
  id: string;
  label: string;
  send: string;
};

export type ChatClarification = {
  question: string;
  options: ChatClarificationOption[];
  allowCustom: boolean;
};

export type ChatSessionContext = {
  sourceLabel?: string | null;
  analysisLabel?: string | null;
};

export type ChatComposerDraft = {
  id: string;
  conversationId: number;
  content: string;
};

export type ChatWorkspaceProps = {
  conversationTitle?: string;
  currentModelName?: string;
  modelProfiles?: Array<{ id: string; model_name: string; connection_name: string; connection_id?: string }>;
  serviceModels?: { connection_id: string; connection_name: string; revision: number; models: string[]; busy: boolean; error: string };
  onDiscoverServiceModels?: (refresh?: boolean) => Promise<void>;
  onServiceModelChange?: (modelName: string) => Promise<void>;
  selectedModelProfileId?: string | null;
  defaultModelName?: string;
  modelSelectionBusy?: boolean;
  modelProfileUnavailable?: boolean;
  /** false 表示没有任何可用模型连接，输入框会提示去设置。 */
  modelConfigured?: boolean;
  onModelProfileChange?: (profileId: string | null) => Promise<void>;
  modelChecking?: boolean;
  modelUnavailable?: string | null;
  onOpenModelSettings?: () => void;
  messages: ChatMessage[];
  hiddenMessageCount: number;
  chatBusy: boolean;
  currentConversationId: number | null;
  libraryAttachments?: { conversationId: number; attachments: ChatAttachment[] } | null;
  onLibraryAttachmentsConsumed?: () => void;
  composerDraft?: ChatComposerDraft | null;
  composerDrafts?: Map<number, string>;
  composerSearchDrafts?: Map<number, WebSearchOptions>;
  onComposerDraftConsumed?: () => void;
  conversations: Conversation[];
  conversationBusy: boolean;
  waitingForUser: boolean;
  latestAgent?: AgentRunResult;
  taskCancelBusy: boolean;
  retryDraft: ChatRetryDraft | null;
  chatEndRef: RefObject<HTMLDivElement | null>;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  onLoadMore: () => void;
  onSelectConversation: (conversationId: number) => void;
  onCreateConversation: () => void;
  onRenameConversation: (conversation: Conversation) => void;
  onArchiveConversation: (conversation: Conversation) => void;
  onRemoveConversation: (conversation: Conversation) => void;
  attachmentBusy: boolean;
  attachmentConfig: AttachmentConfig | null;
  webSearchAvailable: boolean;
  webSearchProvider?: string;
  webSearchCapabilities?: AgentCapabilities["web_research"];
  webSearchCapabilitiesBusy?: boolean;
  webSearchCapabilitiesError?: string;
  onRefreshWebSearchCapabilities?: () => Promise<unknown>;
  onUploadAttachment: (file: File) => Promise<ChatAttachment>;
  onLoadAttachment?: (attachment: ChatAttachment, signal?: AbortSignal) => Promise<{ file: Blob; parsedText?: string }>;
  onRemoveAttachment: (attachmentId: string) => Promise<void>;
  onAttachmentInvalid: (message: string) => void;
  onSuggestedAction: () => void;
  onCancelTask: () => void;
  onSend: (content: string, attachmentIds?: string[], visionAttachmentIds?: string[], webSearch?: boolean, webSearchTopic?: WebSearchTopic, webSearchSourcePreference?: WebSearchSourcePreference) => Promise<void | boolean>;
  onRetry?: (draft: ChatRetryDraft) => Promise<void | boolean>;
  onStop: () => Promise<void>;
  onEdit: (userMessageId: number, content: string) => Promise<void>;
  onRegenerate: (userMessageId: number) => Promise<void>;
  sessionContext?: ChatSessionContext;
  onOpenLibrary?: () => void;
  density?: "page" | "dock";
  focused?: boolean;
};
