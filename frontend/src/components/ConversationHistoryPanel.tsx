import { useEffect, useMemo, useState } from "react";
import { Archive, History, MessageCircle, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Conversation } from "../types";

export type ConversationTimeGroup = {
  label: string;
  items: Conversation[];
};

function parseConversationDate(value: string): Date | null {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function conversationGroupLabel(value: string, now = new Date()): string {
  const date = parseConversationDate(value);
  if (!date) return "更早";
  const dayDiff = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / 86_400_000);
  if (dayDiff <= 0) return "今天";
  if (dayDiff === 1) return "昨天";
  if (dayDiff < 7) return "最近 7 天";
  return "更早";
}

export function formatConversationTime(value: string, now = new Date()): string {
  const date = parseConversationDate(value);
  if (!date) return value;
  const dayDiff = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / 86_400_000);
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  if (dayDiff <= 0) return time;
  if (dayDiff === 1) return `昨天 ${time}`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric"
  }).format(date);
}

export function groupConversationsByTime(conversations: Conversation[], now = new Date()): ConversationTimeGroup[] {
  const order = ["今天", "昨天", "最近 7 天", "更早"];
  const buckets = new Map<string, Conversation[]>();
  for (const conversation of conversations) {
    const label = conversationGroupLabel(conversation.last_message_at || conversation.updated_at, now);
    const items = buckets.get(label) ?? [];
    items.push(conversation);
    buckets.set(label, items);
  }
  return order.flatMap((label) => {
    const items = buckets.get(label);
    return items?.length ? [{ label, items }] : [];
  });
}

function conversationSubtitle(conversation: Conversation, now = new Date()): string {
  if (conversation.task_status === "active") return "进行中";
  if (conversation.status === "archived") return "已归档";
  return formatConversationTime(conversation.last_message_at || conversation.updated_at, now);
}

type Props = {
  conversations: Conversation[];
  currentConversationId: number | null;
  busy: boolean;
  open?: boolean;
  onClose?: () => void;
  onSelect: (conversationId: number) => void;
  onCreate: () => void;
  onRename: (conversation: Conversation) => void;
  onArchive: (conversation: Conversation) => void;
  onRemove: (conversation: Conversation) => void;
};

export function ConversationHistoryPanel({
  conversations,
  currentConversationId,
  busy,
  open = false,
  onClose,
  onSelect,
  onCreate,
  onRename,
  onArchive,
  onRemove
}: Props) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const groups = useMemo(() => groupConversationsByTime(conversations), [conversations]);

  useEffect(() => setOpenMenuId(null), [currentConversationId, open]);

  function closeDrawer() {
    onClose?.();
  }

  return (
    <aside
      id="conversation-history-drawer"
      className={`conversation-history-panel ${open ? "drawer-open" : ""}`}
      hidden={!open}
      aria-label="对话记录"
    >
      <header>
        <div><History size={15} /><strong>对话记录</strong></div>
        <button className="conversation-history-close" type="button" onClick={closeDrawer} aria-label="关闭对话记录"><X size={16} /></button>
      </header>
      <button className="conversation-history-new" type="button" onClick={() => { onCreate(); closeDrawer(); }} disabled={busy}>
        <Plus size={15} /><span>{busy ? "正在创建…" : "新建对话"}</span>
      </button>
      <div className="conversation-history-list">
        {groups.map((group) => (
          <section className="conversation-history-group" key={group.label} aria-label={group.label}>
            <h3>{group.label}</h3>
            {group.items.map((conversation, index) => (
              <div className={`conversation-history-item ${conversation.id === currentConversationId ? "active" : ""} ${conversation.status}`} key={conversation.id}>
                <button className="conversation-history-select" type="button" onClick={() => { onSelect(conversation.id); closeDrawer(); setOpenMenuId(null); }}>
                  <MessageCircle size={14} />
                  <span><strong>{conversation.title}</strong><small>{conversationSubtitle(conversation)}</small></span>
                </button>
                <div className="conversation-history-actions">
                  <button type="button" onClick={() => setOpenMenuId((current) => current === conversation.id ? null : conversation.id)} title="更多操作" aria-label={`${conversation.title} 的更多操作`} aria-expanded={openMenuId === conversation.id}>
                    <MoreHorizontal size={16} />
                  </button>
                  {openMenuId === conversation.id ? <div className={`conversation-history-menu ${group.items.length <= 3 || index < Math.ceil(group.items.length / 2) ? "opens-down" : "opens-up"}`} role="menu">
                    <button role="menuitem" onClick={() => { onRename(conversation); setOpenMenuId(null); }}><Pencil size={13} />重命名</button>
                    <button role="menuitem" onClick={() => { onArchive(conversation); setOpenMenuId(null); }}><Archive size={13} />{conversation.status === "active" ? "归档" : "恢复"}</button>
                    <button className="danger" role="menuitem" onClick={() => { onRemove(conversation); setOpenMenuId(null); }}><Trash2 size={13} />删除</button>
                  </div> : null}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
