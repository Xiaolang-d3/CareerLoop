import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CircleAlert,
  FileText,
  History,
  Layers3,
  ListOrdered,
  MessageCircle,
  NotebookPen,
  Tags,
  UserRound
} from "lucide-react";
import { createApiClient } from "../../api/client";
import { ActionButton } from "../../components/ui/ActionButton";
import type { Conversation, InterviewPreparation, JobProject } from "../../types";
import {
  HOME_INBOX_LIMIT,
  homeActionQueue,
  homeContinueItems,
  homeInboxItems,
  homeProjectReviews,
  homeSkillTags,
  latestJobAnalysisAt,
  profileCompleteness,
  type HomeContinueItem,
  type HomePendingFact,
  type HomeProjectInput,
  type HomeProjectReview,
  type HomeQueueItem
} from "./home-metrics";

const EMPTY_CONVERSATIONS: Conversation[] = [];
const EMPTY_PENDING_FACTS: HomePendingFact[] = [];

export type HomePageProps = {
  apiBase?: string;
  accessToken?: string;
  displayName?: string;
  email?: string;
  profileName?: string;
  targetRole?: string;
  targetCity?: string;
  resumeText?: string;
  resumeFilename?: string;
  skills?: string;
  profileLoaded?: boolean;
  jobs: JobProject[];
  jobsLoaded?: boolean;
  conversations?: Conversation[];
  pendingFacts?: HomePendingFact[];
  projects?: HomeProjectInput[];
  onOpenAnalysis: () => void;
  onOpenResume: () => void;
  onOpenInterview: () => void;
  onOpenProject?: (experienceId: string) => void;
  onOpenProfile: () => void;
  onOpenJob?: (jobId: number) => void;
  onOpenChat?: (conversationId?: number) => void;
  onOpenOpportunities?: () => void;
  onFactsChanged?: () => void;
};

function formatHomeTime(value: string) {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function metricValue(ready: boolean, value: string) {
  return ready ? value : "—";
}

function queueIcon(kind: HomeQueueItem["kind"]) {
  if (kind === "profile" || kind === "resume") return <UserRound size={16} />;
  if (kind === "review") return <CircleAlert size={16} />;
  if (kind === "interview" || kind === "chat") return <MessageCircle size={16} />;
  return <FileText size={16} />;
}

export function HomePage({
  apiBase,
  accessToken,
  displayName,
  email,
  profileName,
  targetRole,
  targetCity,
  resumeText,
  resumeFilename,
  skills,
  profileLoaded = false,
  jobs,
  jobsLoaded = false,
  conversations = EMPTY_CONVERSATIONS,
  pendingFacts = EMPTY_PENDING_FACTS,
  projects: projectsProp,
  onOpenAnalysis,
  onOpenResume,
  onOpenInterview,
  onOpenProject,
  onOpenProfile,
  onOpenJob,
  onOpenChat,
  onFactsChanged
}: HomePageProps) {
  const greetingName = profileName?.trim() || displayName?.trim() || email?.split("@")[0] || "";
  const hasResume = Boolean((resumeText || "").trim());
  const localSkillTags = homeSkillTags(skills || "");
  const [refinedSkillTags, setRefinedSkillTags] = useState<string[] | null>(null);
  const [inboxFacts, setInboxFacts] = useState(pendingFacts);
  const [reviewingFactId, setReviewingFactId] = useState<number | null>(null);
  const [inboxExpanded, setInboxExpanded] = useState(false);
  const [fetchedProjects, setFetchedProjects] = useState<HomeProjectInput[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const inboxRef = useRef<HTMLElement | null>(null);
  const skillTags = refinedSkillTags ?? localSkillTags;
  const projectSource = projectsProp ?? fetchedProjects;
  const projectReviews = homeProjectReviews(projectSource || []);

  useEffect(() => {
    setRefinedSkillTags(null);
  }, [skills]);

  useEffect(() => {
    setInboxFacts(pendingFacts);
  }, [pendingFacts]);

  useEffect(() => {
    if (projectsProp || !apiBase || !accessToken || !profileLoaded || !hasResume) return;
    let cancelled = false;
    const fetchJson = createApiClient(apiBase, accessToken);
    fetchJson<InterviewPreparation>("/interview-preparation")
      .then((result) => {
        if (cancelled) return;
        setFetchedProjects((result.experiences || []).map((item) => ({
          id: item.id,
          title: item.title,
          evidence: item.evidence,
          fields: item.fields,
          gaps: item.gaps
        })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectsProp, apiBase, accessToken, profileLoaded, hasResume]);

  useEffect(() => {
    if (!projectReviews.length) {
      setSelectedProjectId("");
      return;
    }
    setSelectedProjectId((current) => (
      projectReviews.some((item) => item.id === current)
        ? current
        : (projectReviews.find((item) => item.gapCount)?.id ?? projectReviews[0].id)
    ));
  }, [projectReviews.map((item) => item.id).join("|")]);

  useEffect(() => {
    if (!apiBase || !accessToken || !profileLoaded || !localSkillTags.length) return;
    let cancelled = false;
    const fetchJson = createApiClient(apiBase, accessToken);
    fetchJson<{ skills?: string[] }>("/career-profile/skill-tags")
      .then((result) => {
        const next = (result.skills || []).map((item) => item.trim()).filter(Boolean);
        if (!cancelled && next.length) setRefinedSkillTags(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBase, accessToken, profileLoaded, skills, localSkillTags.length]);

  const completeness = profileLoaded
    ? profileCompleteness({ name: profileName, targetRole, targetCity, skills, resumeText })
    : null;
  const lastAnalysis = jobsLoaded ? latestJobAnalysisAt(jobs) : null;
  const reviewableInbox = homeInboxItems(inboxFacts, { resumeText, knownSkills: skillTags });
  const visibleInbox = inboxExpanded ? reviewableInbox : reviewableInbox.slice(0, HOME_INBOX_LIMIT);
  const hiddenInboxCount = Math.max(0, reviewableInbox.length - visibleInbox.length);
  const queue = homeActionQueue({
    profileLoaded,
    hasResume,
    completeness,
    lastAnalysis,
    jobsReady: jobsLoaded,
    pendingFactCount: reviewableInbox.length,
    jobs,
    conversations
  });
  const primary = queue[0];
  const moreActions = queue
    .filter((item) => item.id !== primary?.id)
    .filter((item) => item.kind !== "review" && item.kind !== "chat")
    .slice(0, 3);
  const continueItems = homeContinueItems({
    jobs: jobsLoaded ? jobs : [],
    conversations,
    excludeJobId: primary?.jobId,
    excludeConversationId: primary?.conversationId
  });
  const direction = targetRole?.trim()
    ? [targetRole.trim(), targetCity?.trim()].filter(Boolean).join(" · ")
    : "";

  function openQueueItem(item: HomeQueueItem) {
    if (item.kind === "review") {
      inboxRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      inboxRef.current?.focus();
      return;
    }
    if (item.kind === "profile") {
      onOpenProfile();
      return;
    }
    if (item.kind === "resume") {
      onOpenResume();
      return;
    }
    if (item.kind === "interview") {
      onOpenInterview();
      return;
    }
    if (item.kind === "chat") {
      onOpenChat?.(item.conversationId);
      return;
    }
    if (item.jobId) {
      onOpenJob?.(item.jobId);
      return;
    }
    onOpenAnalysis();
  }

  function openProject(experienceId?: string) {
    if (experienceId && onOpenProject) {
      onOpenProject(experienceId);
      return;
    }
    onOpenProfile();
  }

  function openContinueItem(item: HomeContinueItem) {
    if (item.kind === "chat") {
      onOpenChat?.(item.conversationId);
      return;
    }
    if (item.jobId) onOpenJob?.(item.jobId);
    else onOpenAnalysis();
  }

  async function reviewFact(factId: number, action: "confirm" | "reject") {
    setReviewingFactId(factId);
    try {
      if (apiBase && accessToken) {
        const fetchJson = createApiClient(apiBase, accessToken);
        await fetchJson(`/career-profile/facts/${factId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        });
      }
      setInboxFacts((current) => current.filter((item) => item.id !== factId));
      onFactsChanged?.();
    } catch {
      return;
    } finally {
      setReviewingFactId(null);
    }
  }

  const evidenceNote = !profileLoaded
    ? "资料尚未读取"
    : reviewableInbox.length
      ? `${reviewableInbox.length} 条待确认`
      : hasResume
        ? "已确认账本可用来出材料"
        : "还没有证据";
  const statusCards = [
    {
      key: "resume",
      label: "简历",
      value: metricValue(profileLoaded, hasResume ? "已保存" : "未保存"),
      note: !profileLoaded ? "资料尚未读取" : hasResume ? (resumeFilename || "已保存文本") : "还没有简历",
      icon: <FileText size={13} />,
      onClick: onOpenResume
    },
    {
      key: "evidence",
      label: "证据",
      value: metricValue(profileLoaded, reviewableInbox.length ? `${reviewableInbox.length}` : hasResume ? "已核对" : "未建立"),
      note: evidenceNote,
      icon: <NotebookPen size={13} />,
      onClick: onOpenProfile
    },
    {
      key: "analysis",
      label: "最近分析",
      value: metricValue(jobsLoaded, lastAnalysis ? formatHomeTime(lastAnalysis) : "暂无"),
      note: !jobsLoaded ? "时间稍后更新" : lastAnalysis ? "最近一次岗位分析" : "完成分析后会出现在这里",
      icon: <CalendarDays size={13} />,
      onClick: onOpenAnalysis
    }
  ];

  return (
    <section className="dashboard-page home-page">
      <div className="dashboard-hero" aria-labelledby="home-greeting-title">
        <div>
          <h2 id="home-greeting-title">{greetingName ? `你好，${greetingName}` : "你好"}</h2>
          <p>{direction ? `目标方向：${direction}` : "完善求职资料后，这里会显示你的求职方向。"}</p>
          {profileLoaded && primary ? <p className="home-hero-hint">{primary.detail}</p> : null}
        </div>
        {primary ? (
          <div className="home-hero-actions">
            <ActionButton variant="primary" icon={<ArrowRight size={16} />} onClick={() => openQueueItem(primary)}>
              {primary.label}
            </ActionButton>
          </div>
        ) : null}
      </div>

      <div className="home-status-strip" aria-label="资料快照">
        {statusCards.map((card) => (
          <button className="home-status-card" type="button" key={card.key} onClick={card.onClick}>
            <span className="home-status-kicker">
              <span className="home-status-icon" aria-hidden="true">{card.icon}</span>
              <small>{card.label}</small>
            </span>
            <strong>{card.value}</strong>
            <p title={card.note}>{card.note}</p>
            {card.meter != null ? (
              <div className="home-completeness-bar" role="meter" aria-label={card.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={card.meter}>
                <i style={{ width: `${card.meter}%` }} />
              </div>
            ) : null}
          </button>
        ))}
      </div>

      {profileLoaded && hasResume && projectSource ? (
        <HomeProjectMap
          reviews={projectReviews}
          selectedId={selectedProjectId}
          onSelect={setSelectedProjectId}
          onOpen={openProject}
        />
      ) : null}

      {profileLoaded && skillTags.length ? (
        <section className="home-skill-card" aria-label="技能标签">
          <div className="home-section-heading">
            <span aria-hidden="true"><Tags size={15} /></span>
            <h3>技能</h3>
          </div>
          <div className="home-skill-row">
            {skillTags.slice(0, 12).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </section>
      ) : null}

      {moreActions.length ? (
        <section className="home-queue" aria-label="接下来还可以">
          <div className="home-section-heading">
            <span aria-hidden="true"><ListOrdered size={15} /></span>
            <h3>接下来还可以</h3>
          </div>
          <div className="home-next-actions">
            {moreActions.map((item) => (
              <button
                type="button"
                className="workbench-task-card"
                key={item.id}
                onClick={() => openQueueItem(item)}
              >
                <span className="task-card-icon">{queueIcon(item.kind)}</span>
                <div>
                  <h3>{item.label}</h3>
                  <p>{item.detail}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {continueItems.length || reviewableInbox.length ? (
        <div className="home-followup">
          {continueItems.length ? (
            <section className="home-continue" aria-label="续上未完成">
              <div className="home-section-heading">
                <span aria-hidden="true"><History size={15} /></span>
                <h3>续上未完成</h3>
              </div>
              <ul>
                {continueItems.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => openContinueItem(item)}>
                      <span className="home-continue-icon" aria-hidden="true">
                        {item.kind === "chat" ? <MessageCircle size={15} /> : <Building2 size={15} />}
                      </span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <time dateTime={item.stamp}>{formatHomeTime(item.stamp)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {reviewableInbox.length ? (
            <section ref={inboxRef} className="home-inbox" aria-label="待确认" tabIndex={-1}>
              <div className="home-section-heading">
                <span aria-hidden="true"><CircleAlert size={15} /></span>
                <h3>待确认</h3>
                <small>{reviewableInbox.length}</small>
              </div>
              <ul>
                {visibleInbox.map((item) => (
                  <li key={item.id}>
                    <div className="home-inbox-copy">
                      <p className="home-inbox-title">{item.title}</p>
                      <p className="home-inbox-consequence">{item.consequence}</p>
                      {item.source ? (
                        <blockquote className="home-inbox-source">
                          <cite>{item.sourceLabel}</cite>
                          {item.source}
                        </blockquote>
                      ) : null}
                    </div>
                    <div className="home-inbox-actions">
                      <button type="button" disabled={reviewingFactId === item.id} onClick={() => void reviewFact(item.id, "confirm")}>
                        确认
                      </button>
                      <button type="button" className="is-quiet" disabled={reviewingFactId === item.id} onClick={() => void reviewFact(item.id, "reject")}>
                        不是
                      </button>
                    </div>
                  </li>
                ))}
                {hiddenInboxCount > 0 ? (
                  <li>
                    <div className="home-inbox-actions">
                      <button type="button" className="is-quiet" onClick={() => setInboxExpanded(true)}>
                        查看其余 {hiddenInboxCount} 条
                      </button>
                    </div>
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

    </section>
  );
}

function HomeProjectMap({
  reviews,
  selectedId,
  onSelect,
  onOpen
}: {
  reviews: HomeProjectReview[];
  selectedId: string;
  onSelect: (id: string) => void;
  onOpen: (experienceId?: string) => void;
}) {
  const selected = reviews.find((item) => item.id === selectedId) ?? reviews[0] ?? null;
  const filled = selected ? selected.lanes.filter((lane) => !lane.empty).length : 0;

  return (
    <section className="home-project-map" aria-label="项目证据">
      <div className="home-section-heading">
        <span aria-hidden="true"><Layers3 size={15} /></span>
        <h3>项目证据</h3>
        <small>{reviews.length ? `${reviews.length} 个项目` : "待拆分"}</small>
      </div>
      {reviews.length ? (
        <>
          <div className="home-project-tabs" aria-label="已识别项目">
            {reviews.map((item) => (
              <button
                type="button"
                aria-pressed={item.id === selected?.id}
                className={item.id === selected?.id ? "is-active" : undefined}
                key={item.id}
                onClick={() => onSelect(item.id)}
              >
                {item.title}
                {item.gapCount ? <span>{item.gapCount}</span> : null}
              </button>
            ))}
          </div>
          {selected ? (
            <div className="home-project-schematic">
              <header>
                <p>讲述链路 · {selected.title}</p>
                <span>{filled}/3 段可讲</span>
              </header>
              <ol>
                {selected.lanes.map((lane) => (
                  <li key={lane.key} className={lane.empty ? "is-empty" : undefined}>
                    <button type="button" onClick={() => onOpen(selected.id)}>
                      <small><b aria-hidden="true">{["①", "②", "③"][lane.index - 1]}</b>{lane.label}</small>
                      <strong>{lane.empty ? "待补充" : lane.value}</strong>
                    </button>
                  </li>
                ))}
              </ol>
              <footer>
                <span>{selected.gapCount ? `${selected.gapCount} 项待补充` : "证据可用，可回看讲述"}</span>
                <button type="button" className="is-quiet" onClick={() => onOpen(selected.id)}>
                  继续梳理
                </button>
              </footer>
            </div>
          ) : null}
        </>
      ) : (
        <div className="home-project-empty">
          <p>简历已保存，但还没有拆出可讲的项目证据。</p>
          <button type="button" className="is-quiet" onClick={() => onOpen()}>去完善证据</button>
        </div>
      )}
    </section>
  );
}
