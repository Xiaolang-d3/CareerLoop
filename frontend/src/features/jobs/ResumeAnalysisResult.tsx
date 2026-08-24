import { useEffect, useState, type ReactNode } from "react";
import { Check, FileText, LoaderCircle, MessageSquareText, PencilLine } from "lucide-react";
import { ActionButton } from "../../components/ui/ActionButton";
import type { QuickMatchResult, ResumeChecklistItem } from "../../types";

export const RESUME_ANALYSIS_OUTLINE = [
  { key: "direction", number: "01", title: "方向匹配", question: "意向、身份和岗位是否对得上。" },
  { key: "project_evidence", number: "02", title: "项目证据", question: "经历块里有没有可引用原句。" },
  { key: "quantified", number: "03", title: "量化结果", question: "数字、规模和验收是否可核对。" },
  { key: "risks", number: "04", title: "风险/缺口", question: "缺模块、只清单、证据偏薄的地方。" },
  { key: "next_step", number: "05", title: "下一步", question: "先改简历、准备面试，还是确认事实。" }
] as const;

const STATUS_LABEL = { pass: "已覆盖", warn: "待补强", gap: "有缺口" } as const;

const INTENT_LABEL: Record<string, string> = {
  customize_resume: "定制简历",
  interview_prep: "准备面试",
  confirm_knowledge: "核对事实",
  edit_profile: "去改简历"
};

export type ResumeRewritePatch = { original: string; suggested: string };
type ResumeNextAction = NonNullable<NonNullable<QuickMatchResult["analysis"]["resume"]>["next_actions"]>[number];

type Props = {
  result: QuickMatchResult;
  onEditProfile?: () => void;
  onCustomizeResume?: () => void;
  onPrepareInterview?: () => void;
  onApplyRewrite?: (patch: ResumeRewritePatch) => void;
  applying?: boolean;
  appliedNotice?: string;
};

function quoteKey(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function uniqueQuote(text: string, seen: Set<string>) {
  const key = quoteKey(text);
  if (!key || seen.has(key)) return "";
  seen.add(key);
  return text;
}

function rewritePatch(item: {
  kind?: string;
  patch?: ResumeRewritePatch | null;
}): ResumeRewritePatch | null {
  const patch = item.patch;
  if (!patch?.original?.trim() || !patch.suggested?.trim()) return null;
  return patch;
}

function ResumeQuote({ text, blockTitle }: { text: string; blockTitle?: string }) {
  if (!text) return null;
  return (
    <blockquote className="resume-analysis-quote">
      <cite>{blockTitle ? `简历原句 · ${blockTitle}` : "简历原句"}</cite>
      {text}
    </blockquote>
  );
}

function blockTitleFor(
  blockId: string | undefined,
  blocks: Array<{ id: string; title: string }> | undefined
) {
  if (!blockId) return "";
  return blocks?.find((item) => item.id === blockId)?.title || "";
}

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
    <article className={className} id={`analysis-${number}`}>
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

function ImpressionList({ items, fallback }: { items: string[]; fallback: string }) {
  if (items.length) {
    return (
      <ul className="resume-analysis-impression-list">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }
  return fallback ? <p>{fallback}</p> : null;
}

function StarSkeleton({
  star
}: {
  star: { situation: string; task: string; action: string; result: string };
}) {
  const rows = [
    { key: "情境", value: star.situation, empty: "未见" },
    { key: "任务", value: star.task, empty: "未见明确任务" },
    { key: "行动", value: star.action, empty: "未见动作原句" },
    { key: "结果", value: star.result, empty: "待补充" }
  ];
  return (
    <dl className="resume-analysis-star">
      {rows.map((row) => (
        <div key={row.key} className={row.value ? undefined : "is-missing"}>
          <dt>{row.key}</dt>
          <dd>{row.value || row.empty}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResultActions({
  patch,
  applying,
  onApplyRewrite,
  onEditProfile,
  onSkip
}: {
  patch: ResumeRewritePatch | null;
  applying?: boolean;
  onApplyRewrite?: (patch: ResumeRewritePatch) => void;
  onEditProfile?: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="resume-analysis-action-buttons">
      {patch && onApplyRewrite ? (
        <ActionButton
          variant="primary"
          type="button"
          onClick={() => onApplyRewrite(patch)}
          disabled={applying}
        >
          {applying ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />}
          {applying ? "写入中…" : "采纳改写"}
        </ActionButton>
      ) : null}
      {onEditProfile ? (
        <ActionButton variant="secondary" type="button" onClick={onEditProfile} disabled={applying}>
          <PencilLine size={14} />去改
        </ActionButton>
      ) : null}
      <ActionButton variant="secondary" type="button" onClick={onSkip} disabled={applying}>
        先放下
      </ActionButton>
    </div>
  );
}

function intentHandler(
  intent: string | undefined,
  handlers: {
    onEditProfile?: () => void;
    onCustomizeResume?: () => void;
    onPrepareInterview?: () => void;
  }
) {
  if (intent === "customize_resume") return handlers.onCustomizeResume;
  if (intent === "interview_prep") return handlers.onPrepareInterview;
  return handlers.onEditProfile;
}

function SectionNextAction({
  item,
  onEditProfile,
  onCustomizeResume,
  onPrepareInterview
}: {
  item?: ResumeChecklistItem;
  onEditProfile?: () => void;
  onCustomizeResume?: () => void;
  onPrepareInterview?: () => void;
}) {
  if (!item?.next_action) return null;
  const action = item.next_action;
  const onClick = intentHandler(action.intent, { onEditProfile, onCustomizeResume, onPrepareInterview });
  const label = INTENT_LABEL[action.intent] || action.label;
  return (
    <div className="resume-analysis-section-next">
      <p>{action.detail || action.label}</p>
      {onClick ? (
        <ActionButton variant="secondary" type="button" onClick={onClick}>
          {action.intent === "interview_prep" ? <MessageSquareText size={14} /> : action.intent === "customize_resume" ? <FileText size={14} /> : <PencilLine size={14} />}
          {label}
        </ActionButton>
      ) : null}
    </div>
  );
}

export function ResumeAnalysisResult({
  result,
  onEditProfile,
  onCustomizeResume,
  onPrepareInterview,
  onApplyRewrite,
  applying,
  appliedNotice
}: Props) {
  const [skippedTitles, setSkippedTitles] = useState<string[]>([]);
  useEffect(() => {
    setSkippedTitles([]);
  }, [result]);
  const { analysis, job } = result;
  const resume = analysis.resume;
  const jobMatch = analysis.mode === "job_match" || job.description_character_count >= 20;
  const headline = resume?.headline?.verdict
    || (jobMatch ? "简历情况，并对照了这份岗位" : "这份简历现在在说什么");
  const scan = resume?.scan;
  const rememberItems = scan?.remember?.filter(Boolean) ?? [];
  const skipItems = scan?.skip?.filter(Boolean) ?? [];
  const remember = rememberItems[0] || resume?.headline?.remember || "";
  const skip = skipItems[0] || resume?.headline?.skip || "";
  const seenQuotes = new Set<string>();
  const headlineQuote = uniqueQuote(resume?.headline?.evidence || "", seenQuotes);
  const proven = resume?.strengths.filter((item) => item.evidence) ?? [];
  const unproven = resume?.strengths.filter((item) => !item.evidence) ?? [];
  const matrix = resume?.evidence_matrix ?? [];
  const nextActions: ResumeNextAction[] = resume?.next_actions?.length
    ? resume.next_actions
    : (resume?.gaps ?? []).slice(0, 3).map((item) => ({ title: item, detail: "", evidence: "" }));
  const visibleActions = nextActions.filter((item) => !skippedTitles.includes(item.title));
  const blocks = resume?.blocks ?? [];
  const checklist = resume?.checklist?.length
    ? resume.checklist
    : RESUME_ANALYSIS_OUTLINE.map((section) => ({
      key: section.key,
      title: section.title,
      question: section.question,
      status: "warn" as const,
      summary: section.question,
      next_action: { label: section.title, intent: "edit_profile", detail: "" }
    }));
  const step = (key: string) => checklist.find((item) => item.key === key);
  const quoteTitle = (blockId?: string) => blockTitleFor(blockId, blocks);
  const sectionAction = (key: string) => (
    <SectionNextAction
      item={step(key)}
      onEditProfile={onEditProfile}
      onCustomizeResume={onCustomizeResume}
      onPrepareInterview={onPrepareInterview}
    />
  );
  const identityLine = [scan?.identity, scan?.target].filter(Boolean).join(" · ");
  const proof = scan?.proof;

  return (
    <section className="resume-analysis-result" aria-label="匹配分析结果">
      <header className="resume-analysis-report-head">
        <div>
          <p className="resume-analysis-kicker">{jobMatch ? "对照这份岗位" : "仅已保存简历"}</p>
          <h3>{headline}</h3>
        </div>
        {onCustomizeResume ? (
          <ActionButton variant="primary" type="button" onClick={onCustomizeResume}>
            <FileText size={15} />定制简历
          </ActionButton>
        ) : null}
      </header>

      <ol className="resume-analysis-checklist" aria-label="核对清单">
        {checklist.map((item, index) => (
          <li key={item.key} className={`is-${item.status}`}>
            <a href={`#analysis-0${index + 1}`}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.title}</strong>
              <em>{STATUS_LABEL[item.status] || item.status}</em>
              <small>{item.summary}</small>
            </a>
          </li>
        ))}
      </ol>

      <ReportSection
        number={RESUME_ANALYSIS_OUTLINE[0].number}
        title={RESUME_ANALYSIS_OUTLINE[0].title}
        question={step("direction")?.summary || RESUME_ANALYSIS_OUTLINE[0].question}
      >
        {scan ? (
          <div className="resume-analysis-scan">
            <div>
              <strong>身份 / 意向</strong>
              <p>{identityLine || "简历未写明身份或求职意向"}</p>
              {scan.headline_skills?.length ? (
                <small>技能关键词 {scan.headline_skills.join("、")}</small>
              ) : null}
            </div>
            <div>
              <strong>证据密度 {proof?.label || ""}</strong>
              {proof ? (
                <p>
                  {proof.metric_lines} 条带数字 · {proof.evidence_lines} 条经历原句 · 共 {proof.character_count} 字
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        {remember || skip || rememberItems.length || skipItems.length ? (
          <div className="resume-analysis-impression">
            {remember || rememberItems.length ? (
              <div>
                <strong>会记住</strong>
                <ImpressionList items={rememberItems} fallback={remember} />
              </div>
            ) : null}
            {skip || skipItems.length ? (
              <div>
                <strong>容易跳过</strong>
                <ImpressionList items={skipItems} fallback={skip} />
              </div>
            ) : null}
          </div>
        ) : null}
        <ResumeQuote text={headlineQuote} blockTitle={quoteTitle(resume?.headline?.block_id)} />
        {jobMatch ? (
          <div className="resume-analysis-job">
            <h4>对照这份岗位</h4>
            {analysis.skill_coverage != null ? <p>技能覆盖 {analysis.skill_coverage}%</p> : null}
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
                {analysis.evidence.map((item) => {
                  const evidence = uniqueQuote(item.text, seenQuotes);
                  return (
                    <li key={`${item.skills.join("-")}-${item.text}`}>
                      <strong>{item.skills.join("、")}</strong>
                      <ResumeQuote text={evidence} blockTitle={quoteTitle(item.block_id)} />
                    </li>
                  );
                })}
              </ul>
            ) : <p>岗位要求在简历里还缺少可引用的原句。有做过就补上，没做过不要编。</p>}
          </div>
        ) : null}
        {sectionAction("direction")}
      </ReportSection>

      {resume ? (
        <>
          <ReportSection
            number={RESUME_ANALYSIS_OUTLINE[1].number}
            title={RESUME_ANALYSIS_OUTLINE[1].title}
            question={step("project_evidence")?.summary || RESUME_ANALYSIS_OUTLINE[1].question}
          >
            {resume.talking_source === "work" ? (
              <p className="resume-analysis-talking-note">没有拆出独立项目，下面按工作经历来讲。</p>
            ) : null}
            {matrix.length ? (
              <div className="resume-analysis-matrix">
                {matrix.map((group) => (
                  <div key={group.bucket} className="resume-analysis-matrix-group">
                    <h5>{group.bucket}</h5>
                    <ul>
                      {group.rows.map((row) => (
                        <li key={`${group.bucket}-${row.skill}`}>
                          <div className="resume-analysis-matrix-head">
                            <strong>{row.skill}</strong>
                            <span className={`resume-analysis-strength is-${row.strength}`}>
                              {row.strength === "proven" ? "已证明" : "仅提及"}
                            </span>
                          </div>
                          {row.evidence ? <ResumeQuote text={row.evidence} blockTitle={quoteTitle(row.block_id)} /> : <small>未见原句</small>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : proven.length ? (
              <ul>
                {proven.map((item) => {
                  const evidence = uniqueQuote(item.evidence, seenQuotes);
                  return (
                    <li key={item.label}>
                      <strong>{item.label}</strong>
                      {item.skills?.length ? <small>涉及 {item.skills.join("、")}</small> : null}
                      <ResumeQuote text={evidence} blockTitle={quoteTitle(item.block_id)} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>还没有识别出可引用的技能原句。把项目里用过的工具写成完整句子会更有力。</p>
            )}
            {!matrix.length && unproven.length ? (
              <small>还出现了 {unproven.map((item) => item.label).join("、")}，但只有技能清单、没有项目原句，先不要当优势讲。</small>
            ) : null}
            {resume.projects.length ? (
              <ul className="resume-analysis-project-list">
                {resume.projects.map((item) => (
                  <li key={item.block_id || item.title}>
                    <strong>{item.title}{item.weak ? " · 证据偏薄" : ""}</strong>
                    {item.block_id ? <small>简历块 {item.title}</small> : null}
                    <ResumeQuote text={item.evidence} blockTitle={item.title} />
                    <p className="resume-analysis-next">{item.how_to_talk}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>没有拆出独立项目。在求职资料里把项目名和职责分行写；有工作条目的话，先按工作经历讲职责和结果。</p>
            )}
            {sectionAction("project_evidence")}
          </ReportSection>

          <ReportSection
            className="resume-analysis-projects"
            number={RESUME_ANALYSIS_OUTLINE[2].number}
            title={RESUME_ANALYSIS_OUTLINE[2].title}
            question={step("quantified")?.summary || RESUME_ANALYSIS_OUTLINE[2].question}
          >
            {proof ? (
              <p>
                {proof.label}：{proof.metric_lines} 条带数字 · {proof.evidence_lines} 条经历原句。
                没有数字就标待补充，不要编。
              </p>
            ) : null}
            {resume.projects.length ? (
              <ul>
                {resume.projects.map((item) => (
                  <li key={`metric-${item.block_id || item.title}`}>
                    <strong>{item.title}{item.weak ? " · 证据偏薄" : ""}</strong>
                    {item.star ? <StarSkeleton star={item.star} /> : null}
                    {item.holes?.length ? <small>还缺：{item.holes.join("；")}</small> : null}
                    {item.rewrite ? (
                      <div className="resume-analysis-rewrite">
                        <strong>改写示例</strong>
                        <p>原句：{item.rewrite.original}</p>
                        <p>可改成：{item.rewrite.suggested}</p>
                        <small>{item.rewrite.caveat}</small>
                        {onApplyRewrite ? (
                          <ActionButton
                            variant="primary"
                            type="button"
                            onClick={() => onApplyRewrite({
                              original: item.rewrite!.original,
                              suggested: item.rewrite!.suggested
                            })}
                            disabled={applying}
                          >
                            {applying ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />}
                            {applying ? "写入中…" : "采纳改写"}
                          </ActionButton>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>没有可核对的项目结果。补耗时、准确率或覆盖量；不知道就标待补充。</p>
            )}
            {sectionAction("quantified")}
          </ReportSection>

          <ReportSection
            className="resume-analysis-gaps"
            number={RESUME_ANALYSIS_OUTLINE[3].number}
            title={RESUME_ANALYSIS_OUTLINE[3].title}
            question={step("risks")?.summary || RESUME_ANALYSIS_OUTLINE[3].question}
          >
            {skipItems.length || skip ? (
              <ImpressionList items={skipItems} fallback={skip} />
            ) : null}
            {resume.gaps.length ? (
              <ul>
                {resume.gaps.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
            {sectionAction("risks")}
          </ReportSection>

          <ReportSection
            className="resume-analysis-gaps"
            number={RESUME_ANALYSIS_OUTLINE[4].number}
            title={RESUME_ANALYSIS_OUTLINE[4].title}
            question={step("next_step")?.summary || RESUME_ANALYSIS_OUTLINE[4].question}
          >
            {appliedNotice ? <p className="resume-analysis-resolved">{appliedNotice}</p> : null}
            {visibleActions.length ? (
              <ol className="resume-analysis-actions">
                {visibleActions.map((item, index) => {
                  const evidence = uniqueQuote(item.evidence, seenQuotes);
                  const patch = rewritePatch(item);
                  return (
                    <li key={item.title}>
                      <span className="resume-analysis-action-num" aria-hidden="true">{index + 1}</span>
                      <div>
                        <strong>{item.title}</strong>
                        {item.intent ? <small>{INTENT_LABEL[item.intent] || item.intent}</small> : null}
                        {item.why || item.where || item.effect ? (
                          <dl className="resume-analysis-action-meta">
                            {item.why ? <div><dt>为什么</dt><dd>{item.why}</dd></div> : null}
                            {item.where ? <div><dt>改哪里</dt><dd>{item.where}</dd></div> : null}
                            {item.effect ? <div><dt>改完</dt><dd>{item.effect}</dd></div> : null}
                          </dl>
                        ) : null}
                        {item.detail ? <p>{item.detail}</p> : null}
                        <ResumeQuote text={evidence} blockTitle={quoteTitle(item.block_id)} />
                        <ResultActions
                          patch={patch}
                          applying={applying}
                          onApplyRewrite={onApplyRewrite}
                          onEditProfile={onEditProfile}
                          onSkip={() => setSkippedTitles((current) => (
                            current.includes(item.title) ? current : [...current, item.title]
                          ))}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p>这项先放下了。还要改简历的话，去求职资料里改原文。</p>
            )}
            {sectionAction("next_step")}
            {onEditProfile ? (
              <ActionButton variant="secondary" type="button" onClick={onEditProfile}>
                <PencilLine size={15} />去求职资料改简历
              </ActionButton>
            ) : null}
          </ReportSection>
        </>
      ) : null}

      <footer className="resume-analysis-scope">
        <p>
          <strong>分析范围</strong>
          <span>{jobMatch ? "简历 + 岗位对照" : "仅已保存简历"}</span>
          <span aria-hidden="true"> · </span>
          <strong>把握</strong>
          <span>{analysis.confidence === "high" ? "较高" : "有限"}</span>
        </p>
        {analysis.limitations.map((item) => <small key={item}>{item}</small>)}
      </footer>
    </section>
  );
}
