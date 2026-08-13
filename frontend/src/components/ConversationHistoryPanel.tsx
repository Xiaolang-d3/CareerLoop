import { useEffect, useState } from "react";
import { Archive, History, MessageCircle, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Conversation } from "../types";

type Props = {
  conversations: Conversation[];
  currentConversationId: number | null;
  busy: boolean;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
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
  mobileOpen = false,
  onCloseMobile,
  onSelect,
  onCreate,
  onRename,
  onArchive,
  onRemove
}: Props) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  useEffect(() => setOpenMenuId(null), [currentConversationId, mobileOpen]);

  function closeMobile() {
    onCloseMobile?.();
  }

  return (
    <aside className={`conversation-history-panel ${mobileOpen ? "mobile-open" : ""}`} aria-label="对话记录">
      <header>
        <div><History size={15} /><strong>对话记录</strong></div>
        <button className="conversation-history-close" type="button" onClick={closeMobile} aria-label="关闭对话记录"><X size={16} /></button>
      </header>
      <button className="conversation-history-new" type="button" onClick={() => { onCreate(); closeMobile(); }} disabled={busy}>
        <Plus size={15} /><span>{busy ? "正在创建…" : "新建对话"}</span>
      </button>
      <div className="conversation-history-list">
        {conversations.map((conversation, index) => (
          <div className={`conversation-history-item ${conversation.id === currentConversationId ? "active" : ""} ${conversation.status}`} key={conversation.id}>
            <button className="conversation-history-select" type="button" onClick={() => { onSelect(conversation.id); closeMobile(); setOpenMenuId(null); }}>
              <MessageCircle size={14} />
              <span><strong>{conversation.title}</strong><small>{conversation.task_status === "active" ? "进行中" : conversation.status === "archived" ? "已归档" : "最近对话"}</small></span>
            </button>
            <div className="conversation-history-actions">
              <button type="button" onClick={() => setOpenMenuId((current) => current === conversation.id ? null : conversation.id)} title="更多操作" aria-label={`${conversation.title} 的更多操作`} aria-expanded={openMenuId === conversation.id}>
                <MoreHorizontal size={16} />
              </button>
              {openMenuId === conversation.id ? <div className={`conversation-history-menu ${conversations.length <= 3 || index < Math.ceil(conversations.length / 2) ? "opens-down" : "opens-up"}`} role="menu">
                <button role="menuitem" onClick={() => { onRename(conversation); setOpenMenuId(null); }}><Pencil size={13} />重命名</button>
                <button role="menuitem" onClick={() => { onArchive(conversation); setOpenMenuId(null); }}><Archive size={13} />{conversation.status === "active" ? "归档" : "恢复"}</button>
                <button className="danger" role="menuitem" onClick={() => { onRemove(conversation); setOpenMenuId(null); }}><Trash2 size={13} />删除</button>
              </div> : null}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
