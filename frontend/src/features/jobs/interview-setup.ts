import type { Conversation, InterviewQuestionCategory, JobProject } from "../../types";
import { RESUME_PREP_JOB_TITLE, jobLabel, realJobs } from "../home/home-metrics";
import { parseResumePreview, skillTags, splitEntryHeading } from "../settings/resume-preview";
import { hasStartedInterviewPractice } from "./interview-practice";

export { RESUME_PREP_JOB_TITLE };

const FOCUS_KEY = "careerloop.interview-drill-focus";

export type InterviewDrillFocus = {
  category?: InterviewQuestionCategory;
  query?: string;
};

export type InterviewSetupJob = {
  id: number;
  label: string;
  analyzed: boolean;
  resumePrep: boolean;
};

export function isResumePrepJob(job: JobProject | null | undefined) {
  return Boolean(job && job.job_title === RESUME_PREP_JOB_TITLE);
}

export function interviewSourceLabel(job: JobProject | null | undefined, fallback = RESUME_PREP_JOB_TITLE) {
  if (!job || isResumePrepJob(job)) return RESUME_PREP_JOB_TITLE;
  return jobLabel(job) || fallback;
}

export function resumeInterviewTopics(resumeText: string): { projects: string[]; skills: string[] } {
  const sections = parseResumePreview(resumeText || "");
  const projects = (sections.find((section) => section.kind === "projects")?.entries ?? [])
    .map((entry) => splitEntryHeading(entry[0] || "").title.trim())
    .filter(Boolean)
    .slice(0, 4);
  const skillSection = sections.find((section) => section.kind === "skills");
  const skills = skillSection ? skillTags(skillSection.entries).slice(0, 4) : [];
  return { projects, skills };
}

export function interviewSetupJobs(jobs: JobProject[], selectedJobId: number | null): InterviewSetupJob[] {
  const prep = jobs.find((job) => isResumePrepJob(job));
  const listed: InterviewSetupJob[] = [{
    id: prep?.id ?? 0,
    label: RESUME_PREP_JOB_TITLE,
    analyzed: false,
    resumePrep: true
  }];
  for (const job of realJobs(jobs).slice(0, 4)) {
    listed.push({
      id: job.id,
      label: jobLabel(job),
      analyzed: Boolean(job.latest_evaluation_id),
      resumePrep: false
    });
  }
  if (selectedJobId && !listed.some((item) => item.id === selectedJobId)) {
    const selected = jobs.find((job) => job.id === selectedJobId);
    if (selected && !isResumePrepJob(selected)) {
      listed.splice(1, 0, {
        id: selected.id,
        label: jobLabel(selected),
        analyzed: Boolean(selected.latest_evaluation_id),
        resumePrep: false
      });
    }
  }
  return listed;
}

export function latestActiveConversation(conversations: Conversation[]) {
  return [...conversations]
    .filter((item) => item.status === "active" && (item.message_count ?? 0) > 0)
    .sort((left, right) => (
      (right.last_message_at || right.updated_at).localeCompare(left.last_message_at || left.updated_at)
    ))[0] ?? null;
}

export function latestStartedKitId(kitIds: number[]) {
  return kitIds.find((kitId) => hasStartedInterviewPractice(kitId)) ?? kitIds[0] ?? null;
}

export function saveInterviewDrillFocus(focus: InterviewDrillFocus) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(FOCUS_KEY, JSON.stringify(focus));
}

export function takeInterviewDrillFocus(): InterviewDrillFocus | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(FOCUS_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(FOCUS_KEY);
    const parsed = JSON.parse(raw) as InterviewDrillFocus;
    if (!parsed || typeof parsed !== "object") return null;
    const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
    const category = parsed.category;
    if (!query && !category) return null;
    return { category, query: query || undefined };
  } catch {
    return null;
  }
}

export function matchQuestionId(
  questions: Array<{ id: string; question: string; category?: InterviewQuestionCategory }>,
  focus: InterviewDrillFocus | null
): string | null {
  if (!focus) return null;
  const query = focus.query?.trim();
  if (query) {
    const hit = questions.find((item) => item.question.includes(query));
    if (hit) return hit.id;
  }
  if (focus.category) {
    const hit = questions.find((item) => item.category === focus.category);
    if (hit) return hit.id;
  }
  return null;
}
