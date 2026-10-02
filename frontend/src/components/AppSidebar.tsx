import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  Home,
  MessageCircle,
  Settings
} from "lucide-react";
import { type ReactNode } from "react";
import { sidebarHighlightForView, type SidebarHighlight } from "../constants";
import type { ViewKey } from "../types";
import type { SettingsPage } from "../routing";

export type ProductNavKey = "dashboard" | "library" | "chat" | "settings";

type PrefetchPage = "chat" | "library" | "dashboard" | "settings";

type SidebarItem = {
  key: ProductNavKey;
  label: string;
  icon: ReactNode;
  active: boolean;
  prefetch?: PrefetchPage;
  onClick: () => void;
};

type AppSidebarProps = {
  collapsed: boolean;
  activeView: ViewKey;
  onToggle: () => void;
  onGoHome: () => void;
  onPrefetchPage: (page: PrefetchPage) => void;
  settingsPage?: SettingsPage;
  onSelectNav: (key: ProductNavKey) => void;
  identity?: ReactNode;
};

const MOBILE_KEYS: ProductNavKey[] = ["dashboard", "library", "chat", "settings"];

export function AppSidebar({
  collapsed,
  activeView,
  onToggle,
  onGoHome,
  onPrefetchPage,
  settingsPage,
  onSelectNav,
  identity
}: AppSidebarProps) {
  const highlighted = sidebarHighlightForView(activeView, { settingsPage });
  const isActive = (key: SidebarHighlight) => highlighted === key;

  const primaryItems: SidebarItem[] = [
    { key: "dashboard", label: "首页", icon: <Home size={18} />, active: isActive("dashboard"), prefetch: "dashboard", onClick: () => onSelectNav("dashboard") },
    { key: "library", label: "我的知识库", icon: <BookOpen size={18} />, active: isActive("library"), prefetch: "library", onClick: () => onSelectNav("library") },
    { key: "chat", label: "AI 工作区", icon: <MessageCircle size={18} />, active: isActive("chat"), prefetch: "chat", onClick: () => onSelectNav("chat") }
  ];

  const secondaryItems: SidebarItem[] = [
    { key: "settings", label: "设置", icon: <Settings size={18} />, active: isActive("settings"), prefetch: "settings", onClick: () => onSelectNav("settings") }
  ];

  const mobileItems = [...primaryItems, ...secondaryItems].filter((item) => MOBILE_KEYS.includes(item.key));

  function renderItem(item: SidebarItem, extraClass = "") {
    return (
      <button
        className={`nav-item ${item.active ? "active" : ""} ${extraClass}`.trim()}
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
            <img className="brand-mark-image" src="/dengdeng-icon-v1.png" alt="" />
          </span>
          <span className="brand-copy">
            <strong>灯灯</strong>
            <small>一起想清楚，一步步做好</small>
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

      <div className="sidebar-toggle-footer">
        <button className="sidebar-toggle sidebar-bottom-toggle" type="button" onClick={onToggle} title={collapsed ? "展开侧边栏" : "收起侧边栏"} aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}>
          {collapsed ? <ChevronsRight size={16} strokeWidth={2.1} /> : <ChevronsLeft size={16} strokeWidth={2.1} />}
        </button>
      </div>
    </aside>
  );
}
