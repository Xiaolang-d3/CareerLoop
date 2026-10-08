import { ArrowRight, MessageCircle } from "lucide-react";
import type { Conversation } from "../../types";

const EMPTY_CONVERSATIONS: Conversation[] = [];

export type HomePageProps = {
  displayName?: string;
  email?: string;
  libraryName?: string;
  libraryLoaded?: boolean;
  conversations?: Conversation[];
  sourceCount?: number;
  confirmedFactCount?: number;
  pendingFactCount?: number;
  conversationBusy?: boolean;
  onOpenChat?: (conversationId?: number) => void;
};

function parseHomeTime(value: string) {
  const normalized = value.replace(" ", "T");
  // SQLite timestamps are UTC even when the API returns no explicit offset.
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
}

function formatHomeTime(value: string) {
  const parsed = parseHomeTime(value);
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

export function HomePage({
  displayName,
  email,
  libraryName,
  libraryLoaded = false,
  conversations = EMPTY_CONVERSATIONS,
  sourceCount = 0,
  confirmedFactCount = 0,
  pendingFactCount = 0,
  conversationBusy = false,
  onOpenChat
}: HomePageProps) {
  const greetingName = libraryName?.trim() || displayName?.trim() || email?.split("@")[0] || "";
  const recentChats = [...conversations]
    .sort(
      (a, b) =>
        (parseHomeTime(b.last_message_at || b.updated_at).getTime() || 0) -
        (parseHomeTime(a.last_message_at || a.updated_at).getTime() || 0)
    )
    .slice(0, 3);
  const stats = [
    { label: "文件", value: sourceCount },
    { label: "已确认知识", value: confirmedFactCount },
    { label: "待确认", value: pendingFactCount }
  ];

  return (
    <section className="dashboard-page home-page">
      <div className="dashboard-hero" aria-labelledby="home-greeting-title">
        <div>
          <h2 id="home-greeting-title">{greetingName ? `${greetingPrefix()}，${greetingName}` : greetingPrefix()}</h2>
          <p>从一次对话开始，接着把事情做好。</p>
          <button type="button" className="home-primary-cta" disabled={conversationBusy} onClick={() => onOpenChat?.()}>
            {conversationBusy ? "正在创建…" : "开始新对话"}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <section className="home-overview" aria-label="资料概览">
        <dl>
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{libraryLoaded ? stat.value : "—"}</dd>
            </div>
          ))}
        </dl>
        {!libraryLoaded && <p role="status">资料尚未读取</p>}
      </section>

      <section className="home-recent" aria-labelledby="home-recent-title">
        <h3 id="home-recent-title">最近对话</h3>
        {recentChats.length ? (
          <ul>
            {recentChats.map((chat) => (
              <li key={chat.id}>
                <button type="button" onClick={() => onOpenChat?.(chat.id)}>
                  <MessageCircle size={18} aria-hidden="true" />
                  <strong>{chat.title.trim() || "未命名对话"}</strong>
                  <time dateTime={chat.last_message_at || chat.updated_at}>
                    {formatHomeTime(chat.last_message_at || chat.updated_at)}
                  </time>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="home-empty">还没有对话，开始后会显示在这里。</p>
        )}
      </section>
    </section>
  );
}
