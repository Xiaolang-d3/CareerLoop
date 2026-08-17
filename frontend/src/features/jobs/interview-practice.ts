export type InterviewPracticeState = {
  answers: Record<string, string>;
  practiced: string[];
  currentId: string;
};

const storageKey = (kitId: number) => `careerloop.interview-practice.${kitId}`;

export function emptyInterviewPractice(currentId = ""): InterviewPracticeState {
  return { answers: {}, practiced: [], currentId };
}

export function loadInterviewPractice(kitId: number, questionIds: string[]): InterviewPracticeState {
  const fallback = emptyInterviewPractice(questionIds[0] ?? "");
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(storageKey(kitId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<InterviewPracticeState>;
    const practiced = Array.isArray(parsed.practiced)
      ? parsed.practiced.filter((id) => questionIds.includes(id))
      : [];
    const answers = parsed.answers && typeof parsed.answers === "object"
      ? Object.fromEntries(
        Object.entries(parsed.answers).filter(([id, value]) => questionIds.includes(id) && typeof value === "string")
      )
      : {};
    const currentId = questionIds.includes(parsed.currentId ?? "")
      ? parsed.currentId as string
      : questionIds[0] ?? "";
    return { answers, practiced, currentId };
  } catch {
    return fallback;
  }
}

export function saveInterviewPractice(kitId: number, state: InterviewPracticeState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey(kitId), JSON.stringify(state));
}

export function peekInterviewPractice(kitId: number): InterviewPracticeState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(kitId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InterviewPracticeState>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      answers: parsed.answers && typeof parsed.answers === "object"
        ? Object.fromEntries(
          Object.entries(parsed.answers).filter(([, value]) => typeof value === "string")
        )
        : {},
      practiced: Array.isArray(parsed.practiced)
        ? parsed.practiced.filter((id): id is string => typeof id === "string")
        : [],
      currentId: typeof parsed.currentId === "string" ? parsed.currentId : ""
    };
  } catch {
    return null;
  }
}

export function interviewPracticeProgress(state: InterviewPracticeState, questionIds: string[]) {
  const practiced = state.practiced.filter((id) => questionIds.includes(id));
  const drafted = questionIds.filter((id) => (state.answers[id] || "").trim());
  const nextId = questionIds.find((id) => !practiced.includes(id)) ?? questionIds[0] ?? "";
  return {
    practicedCount: practiced.length,
    draftedCount: drafted.length,
    total: questionIds.length,
    nextId,
    started: practiced.length > 0 || drafted.length > 0,
    complete: questionIds.length > 0 && practiced.length >= questionIds.length
  };
}

export function hasStartedInterviewPractice(kitId: number) {
  const peeked = peekInterviewPractice(kitId);
  if (!peeked) return false;
  return peeked.practiced.length > 0 || Object.values(peeked.answers).some((value) => value.trim());
}
