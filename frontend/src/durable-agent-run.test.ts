import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./components/ChatWorkspace";
import { interruptedRunRetryDraft, type DurableAgentRunSummary } from "./durable-agent-run";

describe("interruptedRunRetryDraft", () => {
  it("restores the bound user message and its request options", () => {
    const run: DurableAgentRunSummary = {
      run_id: "run-recover-1",
      user_message_id: 7,
      status: "interrupted",
      can_resume: true
    };
    const messages: ChatMessage[] = [{
      id: 7,
      role: "user",
      content: "分析附件并检索资料",
      created_at: "2026-09-05T00:00:00Z",
      payload: {
        attachments: [
          {
            id: "resume-1",
            kind: "resume",
            original_filename: "resume.pdf",
            parse_status: "parsed",
            vision_status: "not_requested"
          },
          {
            id: "image-1",
            kind: "job_screenshot",
            original_filename: "job.png",
            parse_status: "parsed",
            vision_status: "consented"
          }
        ],
        web_search: true,
        web_search_mode: "technical"
      }
    }];

    expect(interruptedRunRetryDraft(run, messages)).toEqual({
      content: "分析附件并检索资料",
      attachmentIds: ["resume-1", "image-1"],
      visionAttachmentIds: ["image-1"],
      webSearch: true,
      webSearchMode: "technical",
      runId: "run-recover-1",
      reason: "interrupted"
    });
  });

  it("does not offer recovery without a checkpoint or exact bound message", () => {
    const run: DurableAgentRunSummary = {
      run_id: "run-finished",
      user_message_id: 99,
      status: "completed",
      can_resume: false
    };

    expect(interruptedRunRetryDraft(run, [])).toBeNull();
    expect(interruptedRunRetryDraft({ ...run, can_resume: true }, [])).toBeNull();
  });
});
