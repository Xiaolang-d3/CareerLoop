import { describe, expect, it } from "vitest";
import {
  applyAnalysisRunEvent,
  completeStepsFromResult,
  initialAnalysisSteps,
  readAnalysisRunStream,
  stepStatusLabel,
  thinkingTitle
} from "./analysis-run";
import type { QuickMatchResult } from "../../types";

function result(): QuickMatchResult {
  return {
    job: { title: "", company_name: "", description_character_count: 0 },
    persistence: "not_saved_as_job",
    analysis: {
      required_skills: [],
      matched_skills: [],
      missing_skills: [],
      evidence: [],
      skill_coverage: null,
      confidence: "limited",
      limitations: [],
      resume: {
        character_count: 20,
        skills: [],
        strengths: [],
        structure: { found: [], missing: [] },
        projects: [],
        gaps: [],
        checklist: [
          { key: "direction", title: "方向匹配", question: "", status: "pass", summary: "意向清楚", next_action: { label: "", intent: "edit_profile", detail: "" } }
        ]
      }
    }
  };
}

function sseResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" }
  });
}

describe("analysis-run helpers", () => {
  it("starts idle and walks running thoughts into a completed step", () => {
    let steps = initialAnalysisSteps();
    expect(steps).toHaveLength(5);
    expect(stepStatusLabel(steps[0])).toBe("未开始");

    steps = applyAnalysisRunEvent(steps, {
      type: "step",
      key: "direction",
      title: "方向匹配",
      status: "running",
      source: "local"
    });
    expect(stepStatusLabel(steps[0])).toBe("进行中");
    expect(thinkingTitle(steps[0])).toBe("正在核对方向匹配");

    steps = applyAnalysisRunEvent(steps, {
      type: "thought",
      key: "direction",
      text: "在简历里找带数字的结果句"
    });
    expect(steps[0].thoughts).toEqual(["在简历里找带数字的结果句"]);

    steps = applyAnalysisRunEvent(steps, {
      type: "step",
      key: "direction",
      title: "方向匹配",
      status: "done",
      source: "local",
      summary: "意向清楚",
      completed_at: "2026-08-15T09:00:00+00:00"
    });
    expect(stepStatusLabel(steps[0])).toBe("已完成");
    expect(steps[0].summary).toBe("意向清楚");
    expect(thinkingTitle(steps[0])).toBe("思考过程");
  });

  it("fills remaining steps from the final report", () => {
    const steps = completeStepsFromResult(initialAnalysisSteps(), result());
    expect(steps.every((step) => step.status === "done")).toBe(true);
    expect(steps[0].summary).toBe("意向清楚");
    expect(steps[0].thoughts).toEqual(["意向清楚"]);
  });

  it("reads stepwise SSE events into a result", async () => {
    const payload = result();
    const seen: string[] = [];
    const received = await readAnalysisRunStream(
      sseResponse([
        `event: step\ndata: ${JSON.stringify({ type: "step", key: "direction", title: "方向匹配", status: "running" })}\n\n`,
        `event: thought\ndata: ${JSON.stringify({ type: "thought", key: "direction", text: "先用本地规则核对" })}\n\n`,
        `event: result\ndata: ${JSON.stringify({ type: "result", source: "local", result: payload })}\n\n`
      ]),
      (event) => seen.push(event.type)
    );
    expect(seen).toEqual(["step", "thought", "result"]);
    expect(received.analysis.resume?.checklist?.[0].summary).toBe("意向清楚");
  });

  it("surfaces a stream error event", async () => {
    await expect(readAnalysisRunStream(
      sseResponse([
        `event: error\ndata: ${JSON.stringify({ type: "error", message: "请先在个人资料中上传并保存简历" })}\n\n`
      ]),
      () => undefined
    )).rejects.toThrow("请先在个人资料中上传并保存简历");
  });
});
