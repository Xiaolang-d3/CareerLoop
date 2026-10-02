import {
  ArrowRight,
  FilePlus2,
  FileText,
  History,
  MessageCircle,
  NotebookPen,
  Sparkles,
  Wand2
} from "lucide-react";
import type { Conversation } from "../../types";
import { homeInboxItems, type HomePendingFact } from "./home-metrics";

const EMPTY_CONVERSATIONS: Conversation[] = [];
const EMPTY_PENDING_FACTS: HomePendingFact[] = [];

export type HomePageProps = {
  displayName?: string;
  email?: string;
  libraryName?: string;
  sourceTitle?: string;
  libraryLoaded?: boolean;
  conversations?: Conversation[];
  pendingFacts?: HomePendingFact[];
  sourceCount?: number;
  enabledSourceCount?: number;
  confirmedFactCount?: number;
  onOpenProfile: () => void;
  onOpenChat?: (conversationId?: number) => void;
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
  libraryName,
  sourceTitle,
  enabledSourceCount = 0,
  libraryLoaded = false,
  conversations = EMPTY_CONVERSATIONS,
  pendingFacts = EMPTY_PENDING_FACTS,
  sourceCount,
  confirmedFactCount,
  onOpenProfile,
  onOpenChat,
}: HomePageProps) {
  const greetingName = libraryName?.trim() || displayName?.trim() || email?.split("@")[0] || "";
  const hasSources = enabledSourceCount > 0;
  const reviewableInbox = homeInboxItems(pendingFacts);
  const recentChats = [...conversations]
    .sort((a, b) => (b.last_message_at || b.updated_at).localeCompare(a.last_message_at || a.updated_at))
    .slice(0, 4);
  const activeTasks = conversations.filter((item) => item.task_status === "active").slice(0, 3);
  const recentWorkChats = [...conversations].filter((item) => item.task_status !== "active").sort((a, b) => (b.last_message_at || b.updated_at).localeCompare(a.last_message_at || a.updated_at)).slice(0, 4);
  const recentAdded = reviewableInbox.slice(0, 4);
  const knowledgeCount = confirmedFactCount ?? 0;
  const fileCount = sourceCount ?? (libraryLoaded ? 0 : null);
  const topicCount = pendingFacts.length;
  const chatCount = conversations.length;

  const evidenceNote = !libraryLoaded
    ? "资料尚未读取"
    : reviewableInbox.length
      ? `${reviewableInbox.length} 条待确认`
      : hasSources
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
      key: "create",
      label: "开始创作",
      detail: "在 AI 工作区起草与修改",
      tone: "yellow",
      icon: <Wand2 size={18} />,
      onClick: () => onOpenChat?.()
    }
  ] as const;

  const stats = [
    {
      key: "knowledge",
      label: "知识条目",
      value: metricValue(libraryLoaded, knowledgeCount == null ? "—" : String(knowledgeCount)),
      note: evidenceNote,
      icon: <NotebookPen size={14} />,
      onClick: onOpenProfile
    },
    {
      key: "files",
      label: "文件",
      value: metricValue(libraryLoaded, fileCount == null ? "—" : String(fileCount)),
      note: !libraryLoaded ? "资料尚未读取" : hasSources ? (sourceTitle || "已保存文档") : "还没有文件",
      icon: <FileText size={14} />,
      onClick: onOpenProfile
    },
    {
      key: "topics",
      label: "待确认",
      value: metricValue(libraryLoaded, topicCount == null ? "—" : String(topicCount)),
      note: !libraryLoaded ? "资料尚未读取" : topicCount ? "确认后用于问答与创作" : "暂无待确认内容",
      icon: <Sparkles size={14} />,
      onClick: onOpenProfile
    },
    {
      key: "chats",
      label: "对话记录",
      value: String(chatCount),
      note: chatCount ? "继续之前的对话" : "还没有对话",
      icon: <MessageCircle size={14} />,
      onClick: () => onOpenChat?.()
    }
  ];

  return (
    <section className="dashboard-page home-page home-shell">
      <div className="dashboard-hero" aria-labelledby="home-greeting-title">
        <div>
          <span className="home-hero-kicker">继续工作</span>
          <h2 id="home-greeting-title">{greetingName ? `${greetingPrefix()}，${greetingName} 👋` : `${greetingPrefix()} 👋`}</h2>
          <p>集中保存资料，基于知识提问，再把想法写成内容。</p>
          <div className="home-hero-actions">
            <button type="button" className="home-primary-cta" onClick={() => onOpenChat?.(recentChats[0]?.id)}>
              {recentChats.length ? "继续上次对话" : "开始新对话"}<ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
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

        <section className={`home-panel home-recent-added${recentAdded.length ? "" : " is-empty"}`} aria-label="待确认内容">
          <div className="home-section-heading">
            <span aria-hidden="true"><FilePlus2 size={15} /></span>
            <h3>待确认内容</h3>
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
              <p>{libraryLoaded ? "还没有新的待确认内容。" : "资料读取后，这里会显示待确认内容的条目。"}</p>
              <button type="button" onClick={onOpenProfile}>去知识库添加<ArrowRight size={14} /></button>
            </div>
          )}
        </section>
      </div>

      <div className="home-bottom-grid">
        <section className={`home-panel home-continue${activeTasks.length || recentWorkChats.length ? "" : " is-empty"}`} aria-label="继续工作">
          <div className="home-section-heading">
            <span aria-hidden="true"><History size={15} /></span>
            <h3>继续工作</h3>
          </div>
          {activeTasks.length ? (
            <ul>
              {activeTasks.map((task) => (
                <li key={task.id}>
                  <button type="button" onClick={() => onOpenChat?.(task.id)}>
                    <span className="home-continue-icon" aria-hidden="true"><MessageCircle size={15} /></span>
                    <span>
                      <strong>{task.title || "进行中的对话任务"}</strong>
                      <small>未结束 · {task.summary || "可打开对话继续。"}</small>
                    </span>
                    <time dateTime={task.last_message_at || task.updated_at}>{formatHomeTime(task.last_message_at || task.updated_at)}</time>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {recentWorkChats.length ? (
            <ul>
              {recentWorkChats.map((chat) => (
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
          ) : !activeTasks.length ? (
            <div className="home-recent-empty">
              <p>还没有进行中的内容，可以从一次对话开始。</p>
              <button type="button" onClick={() => onOpenChat?.()}>开始新对话<ArrowRight size={14} /></button>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
