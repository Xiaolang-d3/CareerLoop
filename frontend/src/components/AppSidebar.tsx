import {
  Archive,
  BarChart3,
  BriefcaseBusiness,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AgentCapabilities, Conversation, ViewKey } from "../types";

type AppSidebarProps = {
  collapsed: boolean;
  activeView: ViewKey;
  conversations: Conversation[];
  currentConversationId: number | null;
  conversationBusy: boolean;
  capabilities: AgentCapabilities | null;
  onToggle: () => void;
  onSelectView: (view: ViewKey) => void;
  onSelectConversation: (conversationId: number) => void;
  onCreateConversation: () => void;
  onRenameConversation: (conversation: Conversation) => void;
  onArchiveConversation: (conversation: Conversation) => void;
  onRemoveConversation: (conversation: Conversation) => void;
};

export function AppSidebar({
  collapsed,
  activeView,
  conversations,
  currentConversationId,
  conversationBusy,
  capabilities,
  onToggle,
  onSelectView,
  onSelectConversation,
  onCreateConversation,
  onRenameConversation,
  onArchiveConversation,
  onRemoveConversation
}: AppSidebarProps) {
  const navItems: Array<{ key: ViewKey; label: string; icon: ReactNode; count?: number }> = [
    { key: "workbench", label: "工作台", icon: <BriefcaseBusiness size={18} /> },
    { key: "dashboard", label: "数据看板", icon: <BarChart3 size={18} /> },
    { key: "chat", label: "对话", icon: <MessageCircle size={18} /> },
    { key: "settings", label: "设置", icon: <Settings size={18} /> }
  ];

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <span className="brand-monogram">B</span>
          <i />
        </span>
        <div className="brand-copy"><strong>BossCopilot</strong></div>
        <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? "展开侧边栏" : "收起侧边栏"} aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="nav" aria-label="主导航">
        {navItems.map((item) => (
          <button
            className={`nav-item ${activeView === item.key ? "active" : ""}`}
            key={item.key}
            onClick={() => onSelectView(item.key)}
            aria-current={activeView === item.key ? "page" : undefined}
          >
            {item.icon}<span>{item.label}</span>
            {item.count !== undefined ? <em>{item.count}</em> : null}
          </button>
        ))}
      </nav>

      <section className="conversation-panel" aria-label="对话列表">
        <div className="conversation-heading">
          <span>我的对话 <em>{conversations.filter((item) => item.status === "active").length}</em></span>
          <button onClick={onCreateConversation} disabled={conversationBusy} title="新建对话">
            <Plus size={14} /><strong>新对话</strong>
          </button>
        </div>
        <div className="conversation-list">
          {conversations.map((conversation) => (
            <div className={`conversation-item ${conversation.id === currentConversationId ? "active" : ""} ${conversation.status}`} key={conversation.id}>
              <button className="conversation-select" onClick={() => onSelectConversation(conversation.id)}>
                <MessageCircle size={14} />
                <span><strong>{conversation.title}</strong><small>{conversation.task_status === "active" ? "进行中" : conversation.status === "archived" ? "已归档" : `${conversation.message_count ?? 0} 条消息`}</small></span>
              </button>
              <div className="conversation-actions">
                <button onClick={() => onRenameConversation(conversation)} title="重命名" aria-label="重命名对话"><Pencil size={12} /></button>
                <button onClick={() => onArchiveConversation(conversation)} title={conversation.status === "active" ? "归档" : "恢复"} aria-label={conversation.status === "active" ? "归档对话" : "恢复对话"}><Archive size={12} /></button>
                <button onClick={() => onRemoveConversation(conversation)} title="删除" aria-label="删除对话"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </section>

    </aside>
  );
}
