import {
  BookOpen,
  Brain,
  ChevronsLeft,
  ChevronsRight,
  FilePenLine,
  FolderKanban,
  Home,
  Lightbulb,
  MessageCircle,
  Network,
  Settings,
  Sparkles,
  Wrench
} from "lucide-react";
import { type ReactNode } from "react";
import { sidebarHighlightForView, type SidebarHighlight } from "../constants";
import type { ViewKey } from "../types";
import type { PlaceholderPage, SettingsPage, WorkbenchPage } from "../routing";

export type ProductNavKey =
  | "dashboard"
  | "library"
  | "chat"
  | "organize"
  | "workspace"
  | "notes"
  | "review"
  | "graph"
  | "tools"
  | "settings";

type PrefetchPage = "chat" | "workbench" | "profile" | "dashboard" | "settings";

type SidebarItem = {
  key: ProductNavKey;
  label: string;
  icon: ReactNode;
  active: boolean;
  prefetch?: PrefetchPage;
  onClick: () => void;
  stub?: boolean;
};

type AppSidebarProps = {
  collapsed: boolean;
  activeView: ViewKey;
  onToggle: () => void;
  onGoHome: () => void;
  onPrefetchPage: (page: PrefetchPage) => void;
  settingsPage?: SettingsPage;
  workbenchPage?: WorkbenchPage;
  placeholderPage?: PlaceholderPage;
  onSelectNav: (key: ProductNavKey) => void;
  identity?: ReactNode;
};

const MOBILE_KEYS: ProductNavKey[] = ["dashboard", "library", "chat", "workspace", "settings"];

export function AppSidebar({
  collapsed,
  activeView,
  onToggle,
  onGoHome,
  onPrefetchPage,
  settingsPage,
  workbenchPage,
  placeholderPage,
  onSelectNav,
  identity
}: AppSidebarProps) {
  const highlighted = sidebarHighlightForView(activeView, { settingsPage, workbenchPage, placeholderPage });
  const isActive = (key: SidebarHighlight) => highlighted === key;

  const primaryItems: SidebarItem[] = [
    { key: "dashboard", label: "首页", icon: <Home size={18} />, active: isActive("dashboard"), prefetch: "dashboard", onClick: () => onSelectNav("dashboard") },
    { key: "library", label: "我的知识库", icon: <BookOpen size={18} />, active: isActive("library"), prefetch: "profile", onClick: () => onSelectNav("library") },
    { key: "chat", label: "AI 问答", icon: <MessageCircle size={18} />, active: isActive("chat"), prefetch: "chat", onClick: () => onSelectNav("chat") },
    { key: "organize", label: "知识整理", icon: <FolderKanban size={18} />, active: isActive("organize"), onClick: () => onSelectNav("organize"), stub: true },
    { key: "workspace", label: "内容创作", icon: <FilePenLine size={18} />, active: isActive("workspace"), prefetch: "workbench", onClick: () => onSelectNav("workspace") }
  ];

  const secondaryItems: SidebarItem[] = [
    { key: "notes", label: "灵感笔记", icon: <Lightbulb size={18} />, active: isActive("notes"), onClick: () => onSelectNav("notes"), stub: true },
    { key: "review", label: "回顾与复盘", icon: <Brain size={18} />, active: isActive("review"), onClick: () => onSelectNav("review"), stub: true },
    { key: "graph", label: "知识图谱", icon: <Network size={18} />, active: isActive("graph"), onClick: () => onSelectNav("graph"), stub: true },
    { key: "tools", label: "智能工具", icon: <Wrench size={18} />, active: isActive("tools"), onClick: () => onSelectNav("tools"), stub: true },
    { key: "settings", label: "设置", icon: <Settings size={18} />, active: isActive("settings"), prefetch: "settings", onClick: () => onSelectNav("settings") }
  ];

  const mobileItems = [...primaryItems, ...secondaryItems].filter((item) => MOBILE_KEYS.includes(item.key));

  function renderItem(item: SidebarItem, extraClass = "") {
    return (
      <button
        className={`nav-item ${item.active ? "active" : ""} ${item.stub ? "is-stub" : ""} ${extraClass}`.trim()}
        key={item.key}
        onClick={item.onClick}
        onMouseEnter={() => item.prefetch && onPrefetchPage(item.prefetch)}
        onFocus={() => item.prefetch && onPrefetchPage(item.prefetch)}
        aria-current={item.active ? "page" : undefined}
        aria-label={item.label}
        title={collapsed ? item.label : undefined}
      >
        {item.icon}<span>{item.label}</span>
      </button>
    );
  }

  return (
    <aside className={`sidebar context-navigation shell-light ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <button className="brand-home" type="button" onClick={onGoHome} aria-label="返回首页" title="返回首页">
          <span className="brand-mark" aria-hidden="true">
            <img className="brand-mark-image" src="/careerloop-mark-v2.png" alt="" />
          </span>
          <span className="brand-copy">
            <strong>CareerLoop</strong>
            <small>让知识成为更好的自己</small>
          </span>
        </button>
      </div>

      <nav className="nav nav-desktop" aria-label="主导航">
        <p className="nav-label">工作台</p>
        {primaryItems.map((item) => renderItem(item))}
        <p className="nav-label nav-label-secondary">更多</p>
        {secondaryItems.map((item) => renderItem(item))}
      </nav>

      <nav className="nav nav-mobile" aria-label="移动端主导航">
        {mobileItems.map((item) => renderItem(item, "mobile-nav-item"))}
      </nav>

      {identity ? <div className="sidebar-identity-slot">{identity}</div> : null}

      <div className="sidebar-quick-search" aria-hidden={collapsed}>
        <Sparkles size={14} aria-hidden="true" />
        <span>快速搜索…</span>
      </div>

      <div className="sidebar-toggle-footer">
        <button className="sidebar-toggle sidebar-bottom-toggle" type="button" onClick={onToggle} title={collapsed ? "展开侧边栏" : "收起侧边栏"} aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}>
          {collapsed ? <ChevronsRight size={16} strokeWidth={2.1} /> : <ChevronsLeft size={16} strokeWidth={2.1} />}
        </button>
      </div>
    </aside>
  );
}
