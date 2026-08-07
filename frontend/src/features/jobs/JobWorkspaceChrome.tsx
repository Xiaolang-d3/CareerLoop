import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  FileText,
  PencilLine,
  Target,
  UsersRound
} from "lucide-react";
import { ActionButton, SectionHeader } from "../../components/ui";
import type {
  InterviewKitSummary,
  InterviewRound,
  JobEvaluation,
  JobEvent,
  JobProject,
  JobProjectDraft,
  ResumeVersionSummary
} from "../../types";

export type WorkbenchStage = "overview" | "analysis" | "resume" | "interview" | "progress";

export const jobStatusLabels: Record<JobProject["status"], string> = {
  saved: "已保存",
  applied: "已投递",
  interviewing: "面试中",
  offer: "Offer",
  rejected: "未通过",
  archived: "已归档"
};

export const priorityLabels: Record<JobProject["priority"], string> = {
  low: "低",
  medium: "中",
  high: "高"
};

const workbenchStages = [
  { key: "overview", title: "岗位要求", shortTitle: "要求", icon: BarChart3 },
  { key: "analysis", title: "匹配分析", shortTitle: "分析", icon: Target },
  { key: "resume", title: "定制简历", shortTitle: "简历", icon: FileText },
  { key: "interview", title: "面试重点问答", shortTitle: "问答", icon: UsersRound },
  { key: "progress", title: "面试记录与复盘", shortTitle: "复盘", icon: CalendarDays }
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
    overview: false,
    analysis: Boolean(analysis),
    resume: resumeVersions.length > 0,
    interview: interviewKits.length > 0,
    progress: interviewRounds.length > 0 || timeline.length > 1
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

type JobOverviewProps = {
  draft: JobProjectDraft;
  analysis: JobEvaluation | null;
  resumeVersions: ResumeVersionSummary[];
  interviewKits: InterviewKitSummary[];
  interviewRounds: InterviewRound[];
  timeline: JobEvent[];
  nextActionCopy: { title: string; description: string; action: string };
  nextActionDisabled: boolean;
  nextActionTitle?: string;
  onNextAction: () => void;
  onSelectStage: (stage: WorkbenchStage) => void;
  onEdit: () => void;
};

function formatEventDate(value: string) {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function JobOverview({
  draft,
  analysis,
  resumeVersions,
  interviewKits,
  interviewRounds,
  timeline,
  nextActionCopy,
  nextActionDisabled,
  nextActionTitle,
  onNextAction,
  onSelectStage,
  onEdit
}: JobOverviewProps) {
  const progressItems = [
    {
      stage: "analysis" as const,
      label: "匹配分析",
      value: analysis ? ({ apply: "值得申请", consider: "可以考虑", research_first: "先研究", skip: "暂不建议" }[analysis.effective_final_decision]) : "尚未评估",
      complete: Boolean(analysis),
      icon: Target
    },
    {
      stage: "resume" as const,
      label: "定制简历",
      value: resumeVersions.length ? `${resumeVersions.length} 个版本` : "尚未创建",
      complete: resumeVersions.length > 0,
      icon: FileText
    },
    {
      stage: "interview" as const,
      label: "面试重点问答",
      value: interviewKits.length ? `${interviewKits.length} 个准备包` : "尚未准备",
      complete: interviewKits.length > 0,
      icon: UsersRound
    },
    {
      stage: "progress" as const,
      label: "面试记录与复盘",
      value: interviewRounds.length ? `${interviewRounds.length} 轮面试` : `${timeline.length} 条动态`,
      complete: interviewRounds.length > 0,
      icon: CalendarDays
    }
  ];

  return (
    <section className="job-overview-panel">
      <section className="job-next-action ui-panel-emphasis">
        <SectionHeader
          eyebrow="建议下一步"
          title={nextActionCopy.title}
          description={nextActionCopy.description}
          actions={(
            <div className="next-action-buttons">
              <ActionButton
                variant="primary"
                disabled={nextActionDisabled}
                title={nextActionTitle}
                aria-label={nextActionCopy.action}
                onClick={onNextAction}
              >
                {nextActionCopy.action}<ArrowRight size={15} />
              </ActionButton>
            </div>
          )}
        />
      </section>

      <div className="job-overview-grid">
        <section className="job-stage-summary ui-panel">
          <SectionHeader title="Agent 工作流" description="每一步都有可查看的依据和可继续使用的产物。" level={3} />
          <div>
            {progressItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.stage} onClick={() => onSelectStage(item.stage)}>
                  <span className={item.complete ? "complete" : ""}>
                    {item.complete ? <Check size={14} /> : <Icon size={14} />}
                  </span>
                  <div><strong>{item.label}</strong><small>{item.value}</small></div>
                  <ArrowRight size={14} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="job-overview-details ui-panel">
          <SectionHeader
            title="岗位要求"
            level={3}
            actions={<ActionButton variant="ghost" size="sm" icon={<PencilLine size={13} />} onClick={onEdit}>编辑</ActionButton>}
          />
          <dl>
            <div><dt>公司</dt><dd>{draft.company_name || "待补充"}</dd></div>
            <div><dt>地点</dt><dd>{draft.location || "待补充"}</dd></div>
            <div><dt>薪资</dt><dd>{draft.salary_text || "待补充"}</dd></div>
            <div><dt>岗位 JD</dt><dd>{draft.description.trim() ? `${draft.description.trim().length} 字` : "待补充"}</dd></div>
          </dl>
          {draft.notes.trim() ? <p className="job-overview-note">{draft.notes}</p> : null}
        </section>

        <section className="job-overview-timeline ui-panel">
          <SectionHeader
            title="最近动态"
            level={3}
            actions={<ActionButton variant="ghost" size="sm" onClick={() => onSelectStage("progress")}>查看全部</ActionButton>}
          />
          <div>
            {timeline.slice(0, 3).map((event) => (
              <article key={event.id}>
                <span />
                <div><strong>{event.title}</strong><small>{formatEventDate(event.occurred_at)}</small></div>
              </article>
            ))}
            {!timeline.length ? <p>保存进展后会显示在这里。</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
