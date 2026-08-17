import type { JobProject } from "../../types";

export const RESUME_PREP_JOB_TITLE = "按简历准备";

const PROFILE_FIELDS = ["name", "targetRole", "targetCity", "skills", "resumeText"] as const;

export function splitHomeTags(value: string) {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}

export function profileCompleteness(input: {
  name?: string;
  targetRole?: string;
  targetCity?: string;
  skills?: string;
  resumeText?: string;
}) {
  const filled = PROFILE_FIELDS.filter((field) => (
    field === "skills" ? splitHomeTags(input.skills || "").length > 0 : Boolean(input[field]?.trim())
  )).length;
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}

export function isSettingsProfileReady(input: {
  name?: string;
  targetRole?: string;
  targetCity?: string;
  skills?: string;
  resumeText?: string;
}) {
  const hasName = Boolean(input.name?.trim());
  const hasResume = Boolean(input.resumeText?.trim());
  if (hasName && hasResume) return true;
  const documented = PROFILE_FIELDS.filter((field) => field !== "name" && field !== "resumeText").every((field) => (
    field === "skills" ? splitHomeTags(input.skills || "").length > 0 : Boolean(input[field]?.trim())
  ));
  return hasName && documented;
}

export function latestJobAnalysisAt(jobs: JobProject[]) {
  const times = jobs
    .map((job) => job.latest_evaluation_at)
    .filter((value): value is string => Boolean(value));
  if (!times.length) return null;
  return times.reduce((latest, current) => (current > latest ? current : latest));
}

export function jobLabel(job: JobProject) {
  return [job.company_name.trim(), job.job_title.trim()].filter(Boolean).join(" · ") || "未命名岗位";
}

export function realJobs(jobs: JobProject[]) {
  return jobs.filter((job) => job.job_title !== RESUME_PREP_JOB_TITLE);
}
