import {
  ChevronsLeft,
  ChevronsRight,
  FileSearch,
  Home,
  Layers3,
  MessageCircle,
  Settings,
} from "lucide-react";
import { type ReactNode } from "react";
import { sidebarHighlightForView } from "../constants";
import type { ViewKey } from "../types";
import type { SettingsPage } from "../routing";

type PrefetchPage = "chat" | "workbench" | "project-lab" | "settings" | "account" | "dashboard";

type SidebarItem = {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  prefetch: PrefetchPage;
  onClick: () => void;
};

type AppSidebarProps = {
  collapsed: boolean;
  activeView: ViewKey;
  onToggle: () => void;
  onGoHome: () => void;
  onPrefetchPage: (page: PrefetchPage) => void;
  settingsPage?: SettingsPage;
  onSelectView: (view: ViewKey) => void;
  identity?: ReactNode;
};

export function AppSidebar({
  collapsed,
  activeView,
  onToggle,
  onGoHome,
  onPrefetchPage,
  settingsPage,
  onSelectView,
  identity
}: AppSidebarProps) {
  const highlighted = sidebarHighlightForView(activeView);
  const navItems: SidebarItem[] = [
    { key: "dashboard", label: "首页", icon: <Home size={18} />, active: highlighted === "dashboard", prefetch: "dashboard", onClick: () => onSelectView("dashboard") },
    { key: "workbench", label: "分析", icon: <FileSearch size={18} />, active: highlighted === "workbench", prefetch: "workbench", onClick: () => onSelectView("workbench") },
    { key: "project-lab", label: "项目", icon: <Layers3 size={18} />, active: highlighted === "project-lab", prefetch: "project-lab", onClick: () => onSelectView("project-lab") },
    { key: "chat", label: "对话", icon: <MessageCircle size={18} />, active: highlighted === "chat", prefetch: "chat", onClick: () => onSelectView("chat") },
    { key: "settings", label: "设置", icon: <Settings size={18} />, active: highlighted === "settings" && settingsPage !== "profile" && settingsPage !== "account", prefetch: "settings", onClick: () => onSelectView("settings") }
  ];

  function renderItem(item: SidebarItem, extraClass = "") {
    return (
      <button
        className={`nav-item ${item.active ? "active" : ""} ${extraClass}`.trim()}
        key={item.key}
        onClick={item.onClick}
        onMouseEnter={() => onPrefetchPage(item.prefetch)}
        onFocus={() => onPrefetchPage(item.prefetch)}
        aria-current={item.active ? "page" : undefined}
        aria-label={item.label}
        title={collapsed ? item.label : undefined}
      >
        {item.icon}<span>{item.label}</span>
      </button>
    );
  }

  return (
    <aside className={`sidebar context-navigation ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <button className="brand-home" type="button" onClick={onGoHome} aria-label="返回首页" title="返回首页">
          <span className="brand-mark" aria-hidden="true">
            <img className="brand-mark-image" src="/careerloop-mark-v2.png" alt="" />
          </span>
          <span className="brand-copy"><strong>CareerLoop</strong><small>求职，持续推进</small></span>
        </button>
      </div>

      <nav className="nav nav-desktop" aria-label="主导航">
        <p className="nav-label">工作台</p>
        {navItems.map((item) => renderItem(item))}
      </nav>

      <nav className="nav nav-mobile" aria-label="移动端主导航">
        {navItems.map((item) => renderItem(item, "mobile-nav-item"))}
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
