import {
  Archive,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CircleDot,
  Layers3,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound
} from "lucide-react";
import type { ReactNode } from "react";
import type { AttachmentConfig } from "./ChatWorkspace";
import type { AgentCapabilities, Conversation, ViewKey } from "../types";

type AppSidebarProps = {
  collapsed: boolean;
  activeView: ViewKey;
  conversations: Conversation[];
  currentConversationId: number | null;
  conversationBusy: boolean;
  jobCount: number;
  applicationCount: number;
  capabilities: AgentCapabilities | null;
  attachmentConfig: AttachmentConfig | null;
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
  jobCount,
  applicationCount,
  capabilities,
  attachmentConfig,
  onToggle,
  onSelectView,
  onSelectConversation,
  onCreateConversation,
  onRenameConversation,
  onArchiveConversation,
  onRemoveConversation
}: AppSidebarProps) {
  const navItems: Array<{ key: ViewKey; label: string; icon: ReactNode; count?: number }> = [
    { key: "chat", label: "Agent 对话", icon: <MessageCircle size={18} /> },
    { key: "profile", label: "我的资料", icon: <UserRound size={18} /> },
    { key: "jobs", label: "岗位工作台", icon: <BriefcaseBusiness size={18} />, count: jobCount },
    { key: "tools", label: "Agent 工具", icon: <Bot size={18} />, count: capabilities?.tools.length },
    { key: "agent", label: "Agent 设置", icon: <SlidersHorizontal size={18} /> },
    { key: "applications", label: "投递记录", icon: <Layers3 size={18} />, count: applicationCount },
    { key: "review", label: "求职复盘", icon: <BarChart3 size={18} /> }
  ];

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <span className="brand-mark"><Sparkles size={19} /></span>
        <div className="brand-copy"><strong>BossCopilot</strong><small>求职 Agent</small></div>
        <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? "展开侧边栏" : "收起侧边栏"} aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="nav" aria-label="主导航">
        <span className="nav-label">工作空间</span>
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

      <div className="sidebar-status">
        <div className="status-heading"><CircleDot size={13} /><strong>{capabilities ? "本地 Agent 已就绪" : "正在连接"}</strong></div>
        <p>{attachmentConfig?.vision_ready ? "安全辅助 · 截图可按次授权看图" : "安全辅助 · 附件默认本地解析"}</p>
      </div>
    </aside>
  );
}
