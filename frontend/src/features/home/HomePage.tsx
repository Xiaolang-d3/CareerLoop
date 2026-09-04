import {
  ArrowRight,
  Building2,
  FileText,
  History,
  MessageCircle,
  NotebookPen
} from "lucide-react";
import { ActionButton } from "../../components/ui/ActionButton";
import type { Conversation, JobProject } from "../../types";
import {
  homeActionQueue,
  homeContinueItems,
  homeInboxItems,
  homeSkillTags,
  latestJobAnalysisAt,
  profileCompleteness,
  type HomeContinueItem,
  type HomePendingFact,
  type HomeProjectInput,
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

export function HomePage({
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
  onOpenAnalysis,
  onOpenResume,
  onOpenInterview,
  onOpenProfile,
  onOpenJob,
  onOpenChat,
}: HomePageProps) {
  const greetingName = profileName?.trim() || displayName?.trim() || email?.split("@")[0] || "";
  const hasResume = Boolean((resumeText || "").trim());
  const localSkillTags = homeSkillTags(skills || "");
  const completeness = profileLoaded
    ? profileCompleteness({ name: profileName, targetRole, targetCity, skills, resumeText })
    : null;
  const lastAnalysis = jobsLoaded ? latestJobAnalysisAt(jobs) : null;
  const reviewableInbox = homeInboxItems(pendingFacts, { resumeText, knownSkills: localSkillTags });
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
  const primary = queue.find((item) => item.kind === "chat") ?? queue[0];
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
      onOpenProfile();
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

  function openContinueItem(item: HomeContinueItem) {
    if (item.kind === "chat") {
      onOpenChat?.(item.conversationId);
      return;
    }
    if (item.jobId) onOpenJob?.(item.jobId);
    else onOpenAnalysis();
  }

  const evidenceNote = !profileLoaded
    ? "资料尚未读取"
    : reviewableInbox.length
      ? `${reviewableInbox.length} 条待确认`
      : hasResume
        ? "已确认资料可用于分析和创作"
        : "资料库还是空的";
  const statusCards: Array<{
    key: string;
    label: string;
    value: string;
    note: string;
    icon: React.ReactNode;
    onClick: () => void;
    meter?: number;
  }> = [
    {
      key: "resume",
      label: "工作台",
      value: metricValue(profileLoaded, hasResume ? "已保存" : "未保存"),
      note: !profileLoaded ? "资料尚未读取" : hasResume ? (resumeFilename || "已保存文本") : "还没有简历",
      icon: <FileText size={13} />,
      onClick: onOpenResume
    },
    {
      key: "evidence",
      label: "资料库",
      value: metricValue(profileLoaded, reviewableInbox.length ? `${reviewableInbox.length}` : hasResume ? "已核对" : "未建立"),
      note: evidenceNote,
      icon: <NotebookPen size={13} />,
      onClick: onOpenProfile
    },
  ];

  return (
    <section className="dashboard-page home-page">
      <div className="dashboard-hero" aria-labelledby="home-greeting-title">
        <div>
          <span className="home-hero-kicker">继续工作</span>
          <h2 id="home-greeting-title">{greetingName ? `你好，${greetingName}` : "你好"}</h2>
          <p>{primary?.detail || "从资料、对话或文档中选择一件事继续。"}</p>
          {direction ? <p className="home-hero-hint">当前资料方向：{direction}</p> : null}
        </div>
        {primary ? (
          <div className="home-hero-actions">
            <ActionButton variant="primary" icon={<ArrowRight size={16} />} onClick={() => openQueueItem(primary)}>
              {primary.label}
            </ActionButton>
          </div>
        ) : null}
      </div>

      <div className="home-status-strip" aria-label="内容概览">
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

      <div className="home-followup">
        {continueItems.length ? (
            <section className="home-continue" aria-label="最近工作">
              <div className="home-section-heading">
                <span aria-hidden="true"><History size={15} /></span>
                <h3>最近工作</h3>
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
        ) : (
            <section className="home-continue is-empty" aria-label="最近工作">
              <div className="home-section-heading">
                <span aria-hidden="true"><History size={15} /></span>
                <h3>最近工作</h3>
              </div>
              <div className="home-recent-empty">
                <p>还没有进行中的内容，可以从一次对话开始。</p>
                <button type="button" onClick={() => onOpenChat?.()}>开始新对话<ArrowRight size={14} /></button>
              </div>
            </section>
        )}
      </div>

    </section>
  );
}
