import type { QuickMatchResult } from "../../types";
import { RESUME_ANALYSIS_OUTLINE } from "./ResumeAnalysisResult";

export type AnalysisStepRunStatus = "idle" | "running" | "done";
export type AnalysisRunSource = "local" | "model" | "local_fallback";

export type AnalysisRunEvent =
  | {
      type: "step";
      key: string;
      title: string;
      status: "running" | "done";
      source?: AnalysisRunSource;
      summary?: string;
      completed_at?: string;
      label?: string;
    }
  | {
      type: "thought";
      key: string;
      text: string;
      kind?: "process" | "model";
    }
  | {
      type: "result";
      result: QuickMatchResult;
      source: AnalysisRunSource;
    }
  | {
      type: "error";
      message: string;
    };

export type AnalysisStepView = {
  key: string;
  number: string;
  title: string;
  question: string;
  status: AnalysisStepRunStatus;
  source?: AnalysisRunSource;
  summary?: string;
  completedAt?: string;
  label?: string;
  thoughts: string[];
};

export function initialAnalysisSteps(): AnalysisStepView[] {
  return RESUME_ANALYSIS_OUTLINE.map((item) => ({
    key: item.key,
    number: item.number,
    title: item.title,
    question: item.question,
    status: "idle",
    thoughts: []
  }));
}

function updateStep(
  steps: AnalysisStepView[],
  key: string,
  patch: Partial<AnalysisStepView>
): AnalysisStepView[] {
  return steps.map((step) => (step.key === key ? { ...step, ...patch } : step));
}

export function applyAnalysisRunEvent(
  steps: AnalysisStepView[],
  event: AnalysisRunEvent
): AnalysisStepView[] {
  if (event.type === "thought") {
    const text = event.text.replace(/\s+/g, " ").trim();
    if (!text) return steps;
    return steps.map((step) => {
      if (step.key !== event.key || step.thoughts.includes(text)) return step;
      return { ...step, thoughts: [...step.thoughts, text] };
    });
  }
  if (event.type === "step") {
    return updateStep(steps, event.key, {
      status: event.status === "done" ? "done" : "running",
      source: event.source,
      label: event.label,
      summary: event.summary || steps.find((item) => item.key === event.key)?.summary,
      completedAt: event.completed_at
    });
  }
  if (event.type === "result") {
    return completeStepsFromResult(steps, event.result);
  }
  return steps;
}

export function completeStepsFromResult(
  steps: AnalysisStepView[],
  result: QuickMatchResult
): AnalysisStepView[] {
  const checklist = result.analysis.resume?.checklist ?? [];
  return steps.map((step) => {
    const item = checklist.find((entry) => entry.key === step.key);
    const summary = item?.summary || step.summary || step.question;
    return {
      ...step,
      status: "done" as const,
      summary,
      completedAt: step.completedAt || new Date().toISOString(),
      thoughts: step.thoughts.length ? step.thoughts : summary ? [summary] : step.thoughts
    };
  });
}

export function stepStatusLabel(step: AnalysisStepView): string {
  if (step.status === "idle") return "未开始";
  if (step.status === "running") return "进行中";
  return "已完成";
}

export function thinkingTitle(step: AnalysisStepView): string {
  if (step.status === "running") {
    return step.source === "model" ? `正在润色${step.title}` : `正在核对${step.title}`;
  }
  return "思考过程";
}

export function thinkingTask(step: AnalysisStepView): string | undefined {
  if (step.status !== "running") return undefined;
  const latest = step.thoughts[step.thoughts.length - 1];
  if (latest && latest !== thinkingTitle(step)) return latest;
  if (step.source === "model") return "AI 润色";
  if (step.source === "local" || step.label === "本地分析") return "本地分析";
  return undefined;
}

function parseSseBlock(block: string): AnalysisRunEvent | null {
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    const payload = JSON.parse(data) as AnalysisRunEvent;
    if (!payload || typeof payload !== "object" || !("type" in payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `/quick-match/run 请求失败（${response.status}）`;
  const body = await response.text().catch(() => "");
  try {
    const payload = JSON.parse(body) as { detail?: string };
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail;
  } catch {
    const plain = body.trim();
    if (plain && !plain.startsWith("<") && plain.length <= 200) {
      return `${fallback}：${plain}`;
    }
  }
  return fallback;
}

export async function readAnalysisRunStream(
  response: Response,
  onEvent: (event: AnalysisRunEvent) => void
): Promise<QuickMatchResult> {
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  if (!response.body) {
    throw new Error("分析未返回结果");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: QuickMatchResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (!event) continue;
      if (event.type === "error") {
        throw new Error(event.message || "分析失败，请稍后重试。");
      }
      onEvent(event);
      if (event.type === "result") result = event.result;
    }
  }

  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    if (event?.type === "error") {
      throw new Error(event.message || "分析失败，请稍后重试。");
    }
    if (event) {
      onEvent(event);
      if (event.type === "result") result = event.result;
    }
  }

  if (!result) throw new Error("分析未返回结果");
  return result;
}
