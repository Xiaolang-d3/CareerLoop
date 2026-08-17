import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  History,
  Layers,
  MessagesSquare,
  PencilLine,
  Plus,
  Save
} from "lucide-react";
import type {
  Conversation,
  InterviewKit,
  InterviewKitSummary,
  InterviewQuestionCategory,
  InterviewType,
  JobProject
} from "../../types";
import { ActionButton } from "../../components/ui/ActionButton";
import {
  interviewPracticeProgress,
  loadInterviewPractice,
  saveInterviewPractice
} from "./interview-practice";
import {
  interviewSetupJobs,
  interviewSourceLabel,
  isResumePrepJob,
  latestActiveConversation,
  latestStartedKitId,
  matchQuestionId,
  resumeInterviewTopics,
  saveInterviewDrillFocus,
  takeInterviewDrillFocus,
  type InterviewDrillFocus
} from "./interview-setup";
import "./InterviewQaWorkspace.css";

export const interviewTypeLabels: Record<InterviewType, string> = {
  general: "综合面试",
  hr: "HR 面试",
  business: "业务面试",
  technical: "技术面试",
  final: "终面"
};

const evidenceLabels = {
  matched: "简历里有原文",
  partial: "部分对得上",
  no_evidence: "简历没写到"
} as const;

const categoryLabels: Record<InterviewQuestionCategory, string> = {
  intro: "开场",
  project: "项目经历",
  skill: "技能深挖",
  gap: "缺口回应",
  behavioral: "协作情境"
};

const categoryOrder: InterviewQuestionCategory[] = [
  "intro",
  "project",
  "skill",
  "gap",
  "behavioral"
];

type KitQuestion = InterviewKit["content"]["questions"][number];

function inferQuestionCategory(item: KitQuestion): InterviewQuestionCategory {
  if (item.category) return item.category;
  const text = item.question;
  if (item.status === "no_evidence" || (text.includes("如实") && text.includes("不够"))) return "gap";
  if (["介绍你自己", "为什么考虑", "一分钟"].some((marker) => text.includes(marker))) return "intro";
  if (["同事", "冲突", "协作", "推进"].some((marker) => text.includes(marker))) return "behavioral";
  if (["技能", "写到", "用得最深"].some((marker) => text.includes(marker))) return "skill";
  return "project";
}

function groupQuestions(questions: KitQuestion[]) {
  const buckets = new Map<InterviewQuestionCategory, KitQuestion[]>();
  for (const item of questions) {
    const category = inferQuestionCategory(item);
    const current = buckets.get(category) ?? [];
    current.push(item);
    buckets.set(category, current);
  }
  return categoryOrder
    .filter((category) => buckets.has(category))
    .map((category) => ({
      id: category,
      label: categoryLabels[category],
      items: buckets.get(category) ?? []
    }));
}

function restorePractice(kitId: number, questions: KitQuestion[]) {
  const questionIds = questions.map((item) => item.id);
  const loaded = loadInterviewPractice(kitId, questionIds);
  const focus = takeInterviewDrillFocus();
  const focusedId = matchQuestionId(questions, focus)
    ?? (focus?.category
      ? questions.find((item) => inferQuestionCategory(item) === focus.category)?.id
      : null);
  if (focusedId) return { ...loaded, currentId: focusedId };
  const progress = interviewPracticeProgress(loaded, questionIds);
  if (
    progress.started
    && !progress.complete
    && loaded.practiced.includes(loaded.currentId)
    && progress.nextId
  ) {
    return { ...loaded, currentId: progress.nextId };
  }
  return loaded;
}

type WorkspaceTab = "practice" | "bank" | "intro" | "ask";

type InterviewQaWorkspaceProps = {
  job: JobProject | null;
  kits: InterviewKitSummary[];
  kit: InterviewKit;
  busy: boolean;
  onCreateKit: (job: JobProject, interviewType?: InterviewType) => Promise<InterviewKit>;
  onSelectKit: (kitId: number) => Promise<void>;
  onUpdateKit: (
    kitId: number,
    patch: { status?: "draft" | "ready"; self_intro?: string; notes?: string }
  ) => Promise<void>;
};

export function InterviewQaWorkspace({
  job,
  kits,
  kit,
  busy,
  onCreateKit,
  onSelectKit,
  onUpdateKit
}: InterviewQaWorkspaceProps) {
  const questions = kit.content.questions;
  const questionGroups = useMemo(() => groupQuestions(questions), [questions]);
  const questionIds = useMemo(() => questions.map((item) => item.id), [questions]);
  const [tab, setTab] = useState<WorkspaceTab>("practice");
  const [kitType, setKitType] = useState<InterviewType>(kit.interview_type);
  const [practice, setPractice] = useState(() => loadInterviewPractice(kit.id, questionIds));
  const [revealed, setRevealed] = useState(false);

  useLayoutEffect(() => {
    setPractice(restorePractice(kit.id, questions));
    setRevealed(false);
    setTab("practice");
    setKitType(kit.interview_type);
  }, [kit.id, questionIds]);

  useEffect(() => {
    saveInterviewPractice(kit.id, practice);
  }, [kit.id, practice]);

  const current = questions.find((item) => item.id === practice.currentId) ?? questions[0];
  const currentIndex = current ? questions.findIndex((item) => item.id === current.id) : -1;
  const practicedCount = practice.practiced.length;
  const progress = interviewPracticeProgress(practice, questionIds);
  const resumeGrounded = !kit.evaluation_id || isResumePrepJob(job);
  const sourceLabel = interviewSourceLabel(job, kit.title);

  function selectQuestion(id: string) {
    setPractice((state) => ({ ...state, currentId: id }));
    setRevealed(false);
    setTab("practice");
  }

  function moveQuestion(delta: number) {
    if (!questions.length || currentIndex < 0) return;
    const next = questions[(currentIndex + delta + questions.length) % questions.length];
    selectQuestion(next.id);
  }

  function setAnswer(value: string) {
    if (!current) return;
    setPractice((state) => ({
      ...state,
      answers: { ...state.answers, [current.id]: value }
    }));
  }

  function togglePracticed() {
    if (!current) return;
    setPractice((state) => {
      const practiced = state.practiced.includes(current.id)
        ? state.practiced.filter((id) => id !== current.id)
        : [...state.practiced, current.id];
      return { ...state, practiced };
    });
  }

  return (
    <section className="interview-qa-workspace" aria-label="面试问答">
      <header className="interview-qa-toolbar">
        <div>
          <p className="interview-qa-kicker">面试问答</p>
          <div className="interview-qa-source" aria-label="题目来源">
            <span className={resumeGrounded ? "is-resume" : ""}>
              <FileText size={13} aria-hidden="true" />
              {sourceLabel}
            </span>
            {resumeGrounded ? <small>题目来自你的简历块，不是虚构岗位。</small> : <small>按这份岗位的要求，对照简历块出题。</small>}
          </div>
          {progress.started && !progress.complete ? (
            <p className="interview-qa-continue" role="status">
              接着第 {currentIndex + 1} 题，先写自己的讲法。
            </p>
          ) : (
            <p>
              {kit.evaluation_id
                ? "按已保存简历出题。先写自己的讲法，再对照参考答案。"
                : "按已保存简历出题。先写自己的讲法，再对照参考答案；导入岗位后可以再出一版。"}
            </p>
          )}
        </div>
        <div className="interview-qa-toolbar-actions">
          {kits.length > 1 ? (
            <select
              aria-label="准备包"
              value={kit.id}
              disabled={busy}
              onChange={(event) => void onSelectKit(Number(event.target.value))}
            >
              {kits.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          ) : null}
          <select
            aria-label="面试类型"
            value={kitType}
            disabled={busy || !job}
            onChange={(event) => setKitType(event.target.value as InterviewType)}
          >
            {Object.entries(interviewTypeLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
          <button
            type="button"
            title="题目不准？重新出一版"
            disabled={busy || !job}
            onClick={() => job && void onCreateKit(job, kitType)}
          >
            <Plus size={14} />重新出一版
          </button>
        </div>
      </header>

      <div className="interview-qa-stats" aria-label="练习进度">
        <span><strong>{questions.length}</strong> 预测</span>
        <span><strong>{practicedCount}/{questions.length || 0}</strong> 已练</span>
        <span><strong>{kit.content.positioning.verified_strengths.length}</strong> 优势</span>
        <span><strong>{kit.content.positioning.evidence_gaps.length}</strong> 缺口</span>
      </div>

      <div className="interview-qa-tabs" role="tablist" aria-label="面试问答分区">
        {([
          ["practice", "练习"],
          ["bank", "全部题目"],
          ["intro", "自我介绍"],
          ["ask", "问面试官"]
        ] as const).map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "practice" ? (
        current ? (
          <div className="interview-qa-practice">
            <ol className="interview-qa-rail" aria-label="练习题序">
              {questionGroups.map((group) => (
                <li key={group.id} className="interview-qa-rail-group">
                  <p>{group.label}</p>
                  <ol>
                    {group.items.map((item) => {
                      const index = questions.findIndex((question) => question.id === item.id);
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={`${item.id === current.id ? "active" : ""}${practice.practiced.includes(item.id) ? " practiced" : ""}`}
                            onClick={() => selectQuestion(item.id)}
                          >
                            <em>{String(index + 1).padStart(2, "0")}</em>
                            <span>{item.question}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </li>
              ))}
            </ol>
            <article className="interview-qa-card" data-status={current.status}>
              <header>
                <small>
                  {interviewTypeLabels[kit.interview_type]} · {categoryLabels[inferQuestionCategory(current)]} · {currentIndex + 1}/{questions.length}
                </small>
                <em>{evidenceLabels[current.status]}</em>
              </header>
              <h2 className="interview-question-stem">
                <span className="interview-question-index" aria-hidden="true">Q{currentIndex + 1}</span>
                <strong>{current.question}</strong>
              </h2>
              <aside className="interview-hint">
                <span className="interview-hint-label">Hint</span>
                <p>{current.reason}</p>
              </aside>
              <label className="interview-qa-answer">
                <span>我的讲法</span>
                <textarea
                  aria-label={`回答：${current.question}`}
                  value={practice.answers[current.id] ?? ""}
                  placeholder="先按自己的经历写一遍，再对照右侧参考。"
                  rows={7}
                  onChange={(event) => setAnswer(event.target.value)}
                />
              </label>
              <div className="interview-qa-reference">
                <button type="button" onClick={() => setRevealed((open) => !open)}>
                  {revealed ? "收起参考讲法" : "查看参考讲法"}
                </button>
                {revealed ? (
                  <div>
                    <p><strong>回答方向</strong>{current.answer_direction}</p>
                    {current.evidence.length ? (
                      <blockquote>{current.evidence.join("\n")}</blockquote>
                    ) : (
                      <p className="interview-qa-gap">不要虚构经历，用相邻经验并说清能力边界。</p>
                    )}
                    {kit.content.star_stories.length ? (
                      <div className="interview-qa-star">
                        {kit.content.star_stories.map((story) => (
                          <article key={story.id}>
                            <h3>{story.title}</h3>
                            <p><strong>S</strong>{story.situation}</p>
                            <p><strong>T</strong>{story.task}</p>
                            <p><strong>A</strong>{story.action}</p>
                            <p><strong>R</strong>{story.result}</p>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <footer>
                <button type="button" disabled={questions.length < 2} onClick={() => moveQuestion(-1)}>
                  <ArrowLeft size={14} />上一题
                </button>
                <button
                  type="button"
                  className={practice.practiced.includes(current.id) ? "is-done" : ""}
                  onClick={togglePracticed}
                >
                  <CheckCircle2 size={14} />
                  {practice.practiced.includes(current.id) ? "已练过" : "标记已练"}
                </button>
                <button type="button" disabled={questions.length < 2} onClick={() => moveQuestion(1)}>
                  下一题<ArrowRight size={14} />
                </button>
              </footer>
            </article>
          </div>
        ) : (
          <p className="interview-qa-empty">这版准备包还没有预测问题，请重新生成。</p>
        )
      ) : null}

      {tab === "bank" ? (
        <div className="interview-qa-bank">
          {questionGroups.map((group) => (
            <section key={group.id} aria-label={group.label}>
              <h3>{group.label}</h3>
              <div role="list">
                {group.items.map((item) => {
                  const index = questions.findIndex((question) => question.id === item.id);
                  return (
                    <button
                      type="button"
                      role="listitem"
                      className={`status-${item.status}${practice.practiced.includes(item.id) ? " practiced" : ""}`}
                      key={item.id}
                      onClick={() => selectQuestion(item.id)}
                    >
                      <em>{String(index + 1).padStart(2, "0")}</em>
                      <span>{item.question}</span>
                      <small>{evidenceLabels[item.status]}{practice.practiced.includes(item.id) ? " · 已练" : ""}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {tab === "intro" ? (
        <InterviewIntroCard kit={kit} busy={busy} onUpdate={onUpdateKit} />
      ) : null}

      {tab === "ask" ? (
        <section className="interview-qa-ask">
          <header>
            <h3>你可以问面试官的问题</h3>
            <p>面试结尾用来确认团队重点，不要把准备稿念出来。</p>
          </header>
          <ol>
            {kit.content.reverse_questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ol>
          {kit.content.limitations.length ? (
            <p className="interview-qa-gap">{kit.content.limitations.join(" ")}</p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function InterviewIntroCard({
  kit,
  busy,
  onUpdate
}: {
  kit: InterviewKit;
  busy: boolean;
  onUpdate: InterviewQaWorkspaceProps["onUpdateKit"];
}) {
  const [intro, setIntro] = useState(kit.content.self_intro);
  const [notes, setNotes] = useState(kit.notes);

  useEffect(() => {
    setIntro(kit.content.self_intro);
    setNotes(kit.notes);
  }, [kit.id, kit.updated_at]);

  const changed = intro !== kit.content.self_intro || notes !== kit.notes;
  return (
    <section className="interview-qa-intro">
      <header>
        <div>
          <h3>自我介绍</h3>
          <p>只组织可验证信息，改成你自己的口气后再用。</p>
        </div>
        {kit.content.self_intro_user_edited ? <span><PencilLine size={11} />已改过</span> : null}
      </header>
      <textarea aria-label="自我介绍" value={intro} disabled={busy} onChange={(event) => setIntro(event.target.value)} />
      <label>
        <span>准备备注</span>
        <textarea
          aria-label="准备备注"
          value={notes}
          disabled={busy}
          placeholder="例如：重点练商业化案例、准备英文版…"
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <button type="button" disabled={busy || !changed} onClick={() => void onUpdate(kit.id, { self_intro: intro, notes })}>
        <Save size={13} />保存
      </button>
    </section>
  );
}

const DRILL_STARTS: Array<{
  title: string;
  description: string;
  focus: InterviewDrillFocus;
  icon: typeof Layers;
}> = [
  { title: "练习项目追问", description: "从简历里的项目开始反复演练", focus: { category: "project" }, icon: Layers },
  { title: "补一个知识点", description: "把写过的技能问到能讲清取舍", focus: { category: "skill" }, icon: MessagesSquare },
  { title: "复盘一次面试", description: "把刚问过的问题变成下一轮准备", focus: { category: "behavioral" }, icon: ClipboardCheck }
];

export function InterviewQaEmpty({
  canGenerate,
  generateLabel,
  busy,
  hasAnalysis,
  resumeText = "",
  jobs = [],
  selectedJobId = null,
  kits = [],
  conversations = [],
  onGenerate,
  onStartForJob,
  onContinueKit,
  onContinueConversation
}: {
  canGenerate: boolean;
  generateLabel: string;
  busy: boolean;
  hasAnalysis?: boolean;
  resumeText?: string;
  jobs?: JobProject[];
  selectedJobId?: number | null;
  kits?: InterviewKitSummary[];
  conversations?: Conversation[];
  onGenerate: () => void;
  onStartForJob?: (job: JobProject | null) => void;
  onContinueKit?: () => void;
  onContinueConversation?: (conversationId: number) => void;
}) {
  const topics = resumeInterviewTopics(resumeText);
  const setupJobs = interviewSetupJobs(jobs, selectedJobId);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const resumeGrounded = !hasAnalysis || isResumePrepJob(selectedJob) || !selectedJob;
  const sourceLabel = interviewSourceLabel(selectedJob);
  const continueKitId = latestStartedKitId(kits.map((item) => item.id));
  const continueKit = continueKitId ? kits.find((item) => item.id === continueKitId) ?? null : null;
  const continueConversation = latestActiveConversation(conversations);
  const copy = hasAnalysis
    ? "按已保存简历出题。这份岗位已有分析，生成时会把岗位要求一并考虑进去。"
    : "按已保存简历出题。生成预测问题、STAR 讲法和追问；导入岗位后可以再出一版。";

  function startDrill(focus?: InterviewDrillFocus) {
    if (focus) saveInterviewDrillFocus(focus);
    if (continueKit && onContinueKit) onContinueKit();
    else onGenerate();
  }

  return (
    <section className="interview-qa-setup" aria-label="开始练习">
      <header className="interview-qa-setup-welcome">
        <p className="interview-qa-kicker">面试问答</p>
        <h2>从一个具体问题开始。</h2>
        <p>{copy}</p>
        <div className="interview-qa-source" aria-label="题目来源">
          <span className={resumeGrounded ? "is-resume" : ""}>
            <FileText size={13} aria-hidden="true" />
            {sourceLabel}
          </span>
          <small>{resumeGrounded ? "题目来自你的简历块，不是虚构岗位。" : "会把这份岗位要求和简历块一并考虑进去。"}</small>
        </div>
      </header>

      {continueKit || continueConversation ? (
        <div className="interview-qa-resume-row" aria-label="继续未完成的练习">
          {continueKit && onContinueKit ? (
            <button type="button" disabled={busy} onClick={onContinueKit}>
              <History size={15} aria-hidden="true" />
              <span>
                <strong>继续上次练习</strong>
                <small>{continueKit.title}</small>
              </span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          ) : null}
          {continueConversation && onContinueConversation ? (
            <button type="button" disabled={busy} onClick={() => onContinueConversation(continueConversation.id)}>
              <MessagesSquare size={15} aria-hidden="true" />
              <span>
                <strong>继续上次对话</strong>
                <small>{continueConversation.title.trim() || "还没结束的追问"}</small>
              </span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="starter-prompt-list" aria-label="快捷开始">
        {DRILL_STARTS.map(({ title, description, focus, icon: Icon }) => (
          <button key={title} type="button" disabled={busy || !canGenerate} onClick={() => startDrill(focus)}>
            <span className="starter-prompt-icon" aria-hidden="true">
              <Icon size={16} strokeWidth={1.8} />
            </span>
            <span className="starter-prompt-copy">
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <ArrowUpRight className="starter-prompt-arrow" size={14} aria-hidden="true" />
          </button>
        ))}
      </div>

      {topics.projects.length || topics.skills.length ? (
        <div className="interview-qa-topics" aria-label="从简历块开始">
          {topics.projects.length ? (
            <div>
              <p>从项目开始</p>
              <div>
                {topics.projects.map((project) => (
                  <button
                    key={project}
                    type="button"
                    disabled={busy || !canGenerate}
                    onClick={() => startDrill({ category: "project", query: project })}
                  >
                    {project}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {topics.skills.length ? (
            <div>
              <p>从知识点开始</p>
              <div>
                {topics.skills.map((skill) => (
                  <button
                    key={skill}
                    type="button"
                    disabled={busy || !canGenerate}
                    onClick={() => startDrill({ category: "skill", query: skill })}
                  >
                    {skill}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {setupJobs.length > 1 || setupJobs[0]?.id ? (
        <div className="interview-qa-job-picker" aria-label="对照哪份材料">
          <p>对照哪份材料</p>
          <div>
            {setupJobs.map((item) => {
              const selected = item.resumePrep
                ? !selectedJobId || item.id === selectedJobId || isResumePrepJob(selectedJob)
                : item.id === selectedJobId;
              return (
                <button
                  key={`${item.resumePrep ? "prep" : "job"}-${item.id}`}
                  type="button"
                  className={selected ? "is-selected" : ""}
                  aria-pressed={selected}
                  disabled={busy || !canGenerate || !onStartForJob}
                  onClick={() => onStartForJob?.(item.resumePrep ? jobs.find((job) => isResumePrepJob(job)) ?? null : jobs.find((job) => job.id === item.id) ?? null)}
                >
                  {item.label}
                  {item.resumePrep ? <small>简历块</small> : item.analyzed ? <small>已分析</small> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {canGenerate ? (
        <ActionButton variant="primary" type="button" disabled={busy} onClick={onGenerate}>
          {busy ? "生成中…" : generateLabel}
        </ActionButton>
      ) : null}
    </section>
  );
}
