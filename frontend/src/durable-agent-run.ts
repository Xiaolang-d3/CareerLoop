import type { ChatMessage, ChatRetryDraft } from "./components/ChatWorkspace";

export type DurableAgentRunSummary = {
  run_id: string;
  user_message_id?: number | null;
  status: "queued" | "running" | "waiting_user" | "completed" | "failed" | "cancelled" | "interrupted";
  can_resume: boolean;
};

export function interruptedRunRetryDraft(
  run: DurableAgentRunSummary | null,
  messages: ChatMessage[],
): ChatRetryDraft | null {
  if (!run?.can_resume) return null;
  const userMessage = messages.find(
    (message) => message.id === run.user_message_id && message.role === "user"
  );
  if (!userMessage) return null;
  const attachments = userMessage.payload?.attachments ?? [];
  return {
    content: userMessage.content,
    attachmentIds: attachments.map((attachment) => attachment.id),
    visionAttachmentIds: attachments
      .filter((attachment) => attachment.vision_status === "consented")
      .map((attachment) => attachment.id),
    webSearch: Boolean(userMessage.payload?.web_search),
    webSearchMode: userMessage.payload?.web_search_mode ?? "auto",
    runId: run.run_id,
    reason: "interrupted"
  };
}
