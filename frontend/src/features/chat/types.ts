import type { RefObject } from "react";
import type { Conversation } from "../../types";

export type ModelSelection = {
  profile_id: string;
  connection_id: string;
  profile_revision: number;
  connection_revision: number;
  model_name: string;
  model_base_url?: string;
  model_protocol?: string;
  stage_selections?: Record<string, { model_name?: string; profile_id?: string; profile_revision?: number; connection_revision?: number }>;
};

export type AgentRunResult = {
  model_selection?: ModelSelection;
  provider: string;
  platform: string;
  rounds: number;
  status: "done" | "failed" | "waiting_user" | "cancelled";
  stop_reason?: string;
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
    web_search_mode?: WebSearchMode;
  };
};

export type ChatAttachment = {
  id: string;
  kind: "image" | "document";
  original_filename: string;
  parse_status: "pending" | "parsed" | "failed";
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
  webSearchMode: WebSearchMode;
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
  modelProfiles?: Array<{ id: string; model_name: string; connection_name: string }>;
  selectedModelProfileId?: string | null;
  defaultModelName?: string;
  modelSelectionBusy?: boolean;
  modelProfileUnavailable?: boolean;
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
  onUploadAttachment: (file: File) => Promise<ChatAttachment>;
  onRemoveAttachment: (attachmentId: string) => Promise<void>;
  onAttachmentInvalid: (message: string) => void;
  onSuggestedAction: () => void;
  onCancelTask: () => void;
  onSend: (content: string, attachmentIds?: string[], visionAttachmentIds?: string[], webSearch?: boolean, webSearchMode?: WebSearchMode) => Promise<void | boolean>;
  onRetry?: (draft: ChatRetryDraft) => Promise<void | boolean>;
  onStop: () => Promise<void>;
  onEdit: (userMessageId: number, content: string) => Promise<void>;
  onRegenerate: (userMessageId: number) => Promise<void>;
  sessionContext?: ChatSessionContext;
  onOpenLibrary?: () => void;
  density?: "page" | "dock";
  focused?: boolean;
};
