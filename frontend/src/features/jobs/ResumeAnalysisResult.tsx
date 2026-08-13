import type { ReactNode } from "react";
import { PencilLine } from "lucide-react";
import type { QuickMatchResult } from "../../types";

export const RESUME_ANALYSIS_OUTLINE = [
  { number: "01", title: "第一印象", question: "招聘方扫三十秒，会留下什么印象？" },
  { number: "02", title: "能证明什么", question: "哪些能力有简历原句撑着？" },
  { number: "03", title: "项目怎么讲", question: "面试官问「你具体做了什么」时，这段经历站不站得住？" },
  { number: "04", title: "先改哪里", question: "改哪一两处，这份简历会立刻更好用？" }
] as const;

const JOB_SECTION = {
  number: "05",
  title: "对照这份岗位",
  question: "这份岗位要的，简历里哪些有原句、哪些还没有？"
} as const;

type Props = {
  result: QuickMatchResult;
  onEditProfile?: () => void;
};

function ReportSection({
  number,
  title,
  question,
  extra,
  className,
  children
}: {
  number: string;
  title: string;
  question: string;
  extra?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={className}>
      <header>
        <span className="resume-analysis-section-num" aria-hidden="true">{number}</span>
        <div>
          <h4>{title}</h4>
          <p className="resume-analysis-question">{question}</p>
        </div>
        {extra}
      </header>
      {children}
    </article>
  );
}

export function ResumeAnalysisResult({ result, onEditProfile }: Props) {
  const { analysis, job } = result;
  const resume = analysis.resume;
  const jobMatch = analysis.mode === "job_match" || job.description_character_count >= 20;
  const headline = resume?.headline?.verdict
    || (jobMatch ? "简历情况，并对照了这份岗位" : "这份简历现在在说什么");
  const headlineQuote = resume?.headline?.evidence || "";
  const proven = resume?.strengths.filter((item) => item.evidence) ?? [];
  const unproven = resume?.strengths.filter((item) => !item.evidence) ?? [];
  const nextActions = resume?.next_actions?.length
    ? resume.next_actions
    : (resume?.gaps ?? []).slice(0, 3).map((item) => ({ title: item, detail: "", evidence: "" }));

  return (
    <section className="resume-analysis-result" aria-label="简历分析结果">
      <header className="resume-analysis-report-head">
        <p className="resume-analysis-kicker">{jobMatch ? "简历分析报告 · 岗位对照" : "简历分析报告"}</p>
        <p className="resume-analysis-report-meta">{jobMatch ? "已保存的简历，并对照了这份岗位" : "只看已保存的简历"}</p>
      </header>

      <ReportSection
        number={RESUME_ANALYSIS_OUTLINE[0].number}
        title={RESUME_ANALYSIS_OUTLINE[0].title}
        question={RESUME_ANALYSIS_OUTLINE[0].question}
      >
        <h3>{headline}</h3>
        {headlineQuote ? <blockquote className="resume-analysis-quote">简历原句：{headlineQuote}</blockquote> : null}
      </ReportSection>

      {resume ? (
        <>
          <ReportSection
            number={RESUME_ANALYSIS_OUTLINE[1].number}
            title={RESUME_ANALYSIS_OUTLINE[1].title}
            question={RESUME_ANALYSIS_OUTLINE[1].question}
          >
            {proven.length ? (
              <ul>
                {proven.map((item) => (
                  <li key={item.label}>
                    <strong>{item.label}</strong>
                    <blockquote className="resume-analysis-quote">简历原句：{item.evidence}</blockquote>
                  </li>
                ))}
              </ul>
            ) : (
              <p>还没有识别出可引用的技能原句。把项目里用过的工具写成完整句子会更有力。</p>
            )}
            {unproven.length ? (
              <small>还出现了 {unproven.map((item) => item.label).join("、")}，但没有原句，先不要当优势用。</small>
            ) : null}
          </ReportSection>

          <ReportSection
            className="resume-analysis-projects"
            number={RESUME_ANALYSIS_OUTLINE[2].number}
            title={RESUME_ANALYSIS_OUTLINE[2].title}
            question={RESUME_ANALYSIS_OUTLINE[2].question}
          >
            {resume.projects.length ? (
              <ul>
                {resume.projects.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}{item.weak ? " · 证据偏薄" : ""}</strong>
                    {item.evidence ? <blockquote className="resume-analysis-quote">简历原句：{item.evidence}</blockquote> : null}
                    <p className="resume-analysis-next">下一步：{item.how_to_talk}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>没有拆出独立项目。在个人资料里把项目名和职责分行写，会更容易分析。</p>
            )}
          </ReportSection>

          <ReportSection
            className="resume-analysis-gaps"
            number={RESUME_ANALYSIS_OUTLINE[3].number}
            title={RESUME_ANALYSIS_OUTLINE[3].title}
            question={RESUME_ANALYSIS_OUTLINE[3].question}
          >
            <ol className="resume-analysis-actions">
              {nextActions.map((item, index) => (
                <li key={item.title}>
                  <span className="resume-analysis-action-num" aria-hidden="true">{index + 1}</span>
                  <div>
                    <strong>{item.title}</strong>
                    {item.detail ? <p>{item.detail}</p> : null}
                    {item.evidence ? <blockquote className="resume-analysis-quote">简历原句：{item.evidence}</blockquote> : null}
                  </div>
                </li>
              ))}
            </ol>
            {onEditProfile ? (
              <button className="secondary-button" type="button" onClick={onEditProfile}>
                <PencilLine size={15} />去个人资料改简历
              </button>
            ) : null}
          </ReportSection>
        </>
      ) : null}

      {jobMatch ? (
        <ReportSection
          className="resume-analysis-job"
          number={JOB_SECTION.number}
          title={JOB_SECTION.title}
          question={JOB_SECTION.question}
          extra={analysis.skill_coverage != null ? <span>技能覆盖 {analysis.skill_coverage}%</span> : null}
        >
          <div className="resume-analysis-job-cols">
            <div>
              <strong>有原句</strong>
              <p>{analysis.matched_skills.length ? analysis.matched_skills.join("、") : "暂无直接命中"}</p>
            </div>
            <div>
              <strong>还没有原句</strong>
              <p>{analysis.missing_skills.length ? analysis.missing_skills.join("、") : "未见明显技能缺口"}</p>
            </div>
          </div>
          {analysis.evidence.length ? (
            <ul>
              {analysis.evidence.map((item) => (
                <li key={`${item.skills.join("-")}-${item.text}`}>
                  <strong>{item.skills.join("、")}</strong>
                  <blockquote className="resume-analysis-quote">简历原句：{item.text}</blockquote>
                </li>
              ))}
            </ul>
          ) : <p>岗位要求在简历里还缺少可引用的原句。有做过就补上，没做过不要编。</p>}
        </ReportSection>
      ) : null}

      {analysis.limitations.length ? (
        <footer>
          {analysis.limitations.map((item) => <small key={item}>{item}</small>)}
        </footer>
      ) : null}
    </section>
  );
}
