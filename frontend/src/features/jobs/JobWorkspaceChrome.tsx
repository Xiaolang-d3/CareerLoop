import { CheckCircle2, FileText, Target, UsersRound } from "lucide-react";
import type {
  InterviewKitSummary,
  InterviewRound,
  JobEvaluation,
  JobEvent,
  JobProject,
  ResumeVersionSummary
} from "../../types";

export type WorkbenchStage = "analysis" | "resume" | "interview";

export const priorityLabels: Record<JobProject["priority"], string> = {
  low: "低",
  medium: "中",
  high: "高"
};

const workbenchStages = [
  { key: "analysis", title: "匹配分析", shortTitle: "分析", icon: Target },
  { key: "resume", title: "定制简历", shortTitle: "简历", icon: FileText },
  { key: "interview", title: "面试准备", shortTitle: "面试", icon: UsersRound }
] as const;

type JobStageNavProps = {
  activeStage: WorkbenchStage;
  analysis: JobEvaluation | null;
  resumeVersions: ResumeVersionSummary[];
  interviewKits: InterviewKitSummary[];
  interviewRounds: InterviewRound[];
  timeline: JobEvent[];
  onSelect: (stage: WorkbenchStage) => void;
};

export function JobStageNav({
  activeStage,
  analysis,
  resumeVersions,
  interviewKits,
  interviewRounds,
  timeline,
  onSelect
}: JobStageNavProps) {
  const completed: Record<WorkbenchStage, boolean> = {
    analysis: Boolean(analysis),
    resume: resumeVersions.length > 0,
    interview: interviewKits.length > 0
  };

  return (
    <nav className="job-stage-nav" aria-label="岗位工作流">
      {workbenchStages.map((stage) => {
        const Icon = stage.icon;
        return (
          <button
            className={`${activeStage === stage.key ? "active" : ""} ${completed[stage.key] ? "completed" : ""}`}
            aria-current={activeStage === stage.key ? "page" : undefined}
            aria-label={stage.title}
            key={stage.key}
            onClick={() => onSelect(stage.key)}
          >
            <Icon size={17} />
            <span>{stage.shortTitle}</span>
            {completed[stage.key] ? <CheckCircle2 size={13} /> : <span className="job-stage-pending" />}
          </button>
        );
      })}
    </nav>
  );
}
