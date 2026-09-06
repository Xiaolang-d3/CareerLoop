import {
  ArrowRight,
  CalendarDays,
  FilePlus2,
  FileText,
  History,
  MessageCircle,
  NotebookPen,
  Sparkles,
  Wand2
} from "lucide-react";
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
  sourceCount?: number;
  confirmedFactCount?: number;
  onOpenAnalysis: () => void;
  onOpenResume: () => void;
  onOpenInterview: () => void;
  onOpenProject?: (experienceId: string) => void;
  onOpenProfile: () => void;
  onOpenJob?: (jobId: number) => void;
  onOpenChat?: (conversationId?: number) => void;
  onOpenOrganize?: () => void;
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

function greetingPrefix(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
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
  sourceCount,
  confirmedFactCount,
  onOpenAnalysis,
  onOpenResume,
  onOpenInterview,
  onOpenProfile,
  onOpenJob,
  onOpenChat,
  onOpenOrganize
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
  const recentChats = [...conversations]
    .sort((a, b) => (b.last_message_at || b.updated_at).localeCompare(a.last_message_at || a.updated_at))
    .slice(0, 4);
  const activeTasks = conversations.filter((item) => item.task_status === "active").slice(0, 3);
  const recentAdded = reviewableInbox.slice(0, 4);
  const knowledgeCount = confirmedFactCount ?? (profileLoaded ? (hasResume ? Math.max(localSkillTags.length, 1) : 0) : null);
  const fileCount = sourceCount ?? (profileLoaded ? (hasResume ? 1 : 0) : null);
  const topicCount = profileLoaded ? localSkillTags.length : null;
  const chatCount = conversations.length;

  function openQueueItem(item: HomeQueueItem) {
    if (item.kind === "review" || item.kind === "profile") {
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
        : "知识库还是空的";

  const quickActions = [
    {
      key: "add",
      label: "添加内容",
      detail: "上传或粘贴资料",
      tone: "purple",
      icon: <FilePlus2 size={18} />,
      onClick: onOpenProfile
    },
    {
      key: "ask",
      label: "向我提问",
      detail: "基于你的知识库问答",
      tone: "blue",
      icon: <MessageCircle size={18} />,
      onClick: () => onOpenChat?.()
    },
    {
      key: "organize",
      label: "整理知识",
      detail: "梳理主题与结构",
      tone: "green",
      icon: <CalendarDays size={18} />,
      onClick: () => { if (onOpenOrganize) onOpenOrganize(); else onOpenProfile(); }
    },
    {
      key: "create",
      label: "生成内容",
      detail: "进入内容创作工作台",
      tone: "yellow",
      icon: <Wand2 size={18} />,
      onClick: onOpenResume
    }
  ] as const;

  const stats = [
    {
      key: "knowledge",
      label: "知识条目",
      value: metricValue(profileLoaded, knowledgeCount == null ? "—" : String(knowledgeCount)),
      note: evidenceNote,
      icon: <NotebookPen size={14} />,
      onClick: onOpenProfile
    },
    {
      key: "files",
      label: "文件",
      value: metricValue(profileLoaded, fileCount == null ? "—" : String(fileCount)),
      note: !profileLoaded ? "资料尚未读取" : hasResume ? (resumeFilename || "已保存文档") : "还没有文件",
      icon: <FileText size={14} />,
      onClick: onOpenResume
    },
    {
      key: "topics",
      label: "主题",
      value: metricValue(profileLoaded, topicCount == null ? "—" : String(topicCount)),
      note: !profileLoaded ? "资料尚未读取" : topicCount ? "来自已保存技能标签" : "主题会在确认资料后出现",
      icon: <Sparkles size={14} />,
      onClick: onOpenProfile
    },
    {
      key: "chats",
      label: "对话记录",
      value: String(chatCount),
      note: chatCount ? "可从右侧继续对话" : "还没有对话",
      icon: <MessageCircle size={14} />,
      onClick: () => onOpenChat?.()
    }
  ];

  return (
    <section className="dashboard-page home-page home-shell">
      <div className="dashboard-hero home-hero-grid" aria-labelledby="home-greeting-title">
        <div>
          <span className="home-hero-kicker">继续工作</span>
          <h2 id="home-greeting-title">{greetingName ? `${greetingPrefix()}，${greetingName} 👋` : `${greetingPrefix()} 👋`}</h2>
          <p>{primary?.detail || (!profileLoaded ? "资料读取后，这里会给出下一步。" : "从资料、对话或文档中选择一件事继续。")}</p>
          {direction ? <p className="home-hero-hint">当前资料方向：{direction}</p> : null}
          {primary ? (
            <div className="home-hero-actions">
              <button type="button" className="home-primary-cta" onClick={() => openQueueItem(primary)}>
                {primary.label}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
        <aside className="home-quote-card" aria-label="今日寄语">
          <p>知识不是被存储，而是被激活、连接和创造价值。</p>
        </aside>
      </div>

      <div className="home-quick-actions" aria-label="快捷操作">
        {quickActions.map((action) => (
          <button key={action.key} type="button" className={`home-quick-card tone-${action.tone}`} onClick={action.onClick}>
            <span className="home-quick-icon" aria-hidden="true">{action.icon}</span>
            <strong>{action.label}</strong>
            <small>{action.detail}</small>
          </button>
        ))}
      </div>

      <div className="home-mid-grid">
        <section className="home-panel" aria-label="我的知识概览">
          <div className="home-section-heading">
            <span aria-hidden="true"><NotebookPen size={15} /></span>
            <h3>我的知识概览</h3>
          </div>
          <div className="home-status-strip" aria-label="内容概览">
            {stats.map((card) => (
              <button className="home-status-card" type="button" key={card.key} onClick={card.onClick}>
                <span className="home-status-kicker">
                  <span className="home-status-icon" aria-hidden="true">{card.icon}</span>
                  <small>{card.label}</small>
                </span>
                <strong>{card.value}</strong>
                <p title={card.note}>{card.note}</p>
              </button>
            ))}
          </div>
        </section>

        <section className={`home-panel home-recent-added${recentAdded.length ? "" : " is-empty"}`} aria-label="最近添加">
          <div className="home-section-heading">
            <span aria-hidden="true"><FilePlus2 size={15} /></span>
            <h3>最近添加</h3>
          </div>
          {recentAdded.length ? (
            <ul>
              {recentAdded.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={onOpenProfile}>
                    <strong>{item.title}</strong>
                    <small>{item.sourceLabel} · {item.consequence}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="home-recent-empty">
              <p>{profileLoaded ? "还没有新的待确认内容。" : "资料读取后，这里会显示最近添加的条目。"}</p>
              <button type="button" onClick={onOpenProfile}>去知识库添加<ArrowRight size={14} /></button>
            </div>
          )}
        </section>
      </div>

      <div className="home-bottom-grid">
        <section className={`home-panel home-continue${recentChats.length || continueItems.length ? "" : " is-empty"}`} aria-label="最近对话">
          <div className="home-section-heading">
            <span aria-hidden="true"><MessageCircle size={15} /></span>
            <h3>最近对话</h3>
          </div>
          {recentChats.length ? (
            <ul>
              {recentChats.map((chat) => (
                <li key={chat.id}>
                  <button type="button" onClick={() => onOpenChat?.(chat.id)}>
                    <span className="home-continue-icon" aria-hidden="true"><MessageCircle size={15} /></span>
                    <span>
                      <strong>{chat.title || "未命名对话"}</strong>
                      <small>{chat.summary || "继续上次对话"}</small>
                    </span>
                    <time dateTime={chat.last_message_at || chat.updated_at}>{formatHomeTime(chat.last_message_at || chat.updated_at)}</time>
                  </button>
                </li>
              ))}
            </ul>
          ) : continueItems.length ? (
            <ul>
              {continueItems.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => openContinueItem(item)}>
                    <span className="home-continue-icon" aria-hidden="true">
                      {item.kind === "chat" ? <MessageCircle size={15} /> : <History size={15} />}
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
          ) : (
            <div className="home-recent-empty">
              <p>还没有进行中的内容，可以从一次对话开始。</p>
              <button type="button" onClick={() => onOpenChat?.()}>开始新对话<ArrowRight size={14} /></button>
            </div>
          )}
        </section>

        <section className={`home-panel home-tasks${activeTasks.length ? "" : " is-empty"}`} aria-label="正在进行的任务">
          <div className="home-section-heading">
            <span aria-hidden="true"><History size={15} /></span>
            <h3>正在进行的任务</h3>
          </div>
          {activeTasks.length ? (
            <ul>
              {activeTasks.map((task) => (
                <li key={task.id}>
                  <button type="button" onClick={() => onOpenChat?.(task.id)}>
                    <strong>{task.title || "进行中的对话任务"}</strong>
                    <small>{task.summary || "Agent 任务仍在进行，可从右侧继续。"}</small>
                    <span className="home-task-meter" aria-hidden="true"><i style={{ width: "62%" }} /></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="home-recent-empty">
              <p>当前没有进行中的 Agent 任务。</p>
            </div>
          )}
        </section>

        <section className="home-panel home-inspiration" aria-label="今日灵感">
          <div className="home-section-heading">
            <span aria-hidden="true"><Sparkles size={15} /></span>
            <h3>今日灵感</h3>
          </div>
          <p>把一次对话里的洞察沉淀成笔记，比收藏十篇文章更有价值。</p>
          <button type="button" className="home-inspiration-cta" onClick={() => { if (onOpenOrganize) onOpenOrganize(); else onOpenProfile(); }}>
            保存到灵感笔记
          </button>
        </section>
      </div>
    </section>
  );
}
