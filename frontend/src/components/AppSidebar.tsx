import {
  ChevronLeft,
  ChevronRight,
  FileSearch,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Settings,
  UserRound,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ViewKey } from "../types";
import type { PreparationPage, SettingsPage } from "../routing";

type PrefetchPage = "chat" | "profile" | "workbench" | "settings";

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
  onLogout: () => void;
  onGoHome: () => void;
  onPrefetchPage: (page: PrefetchPage) => void;
  preparationPage?: PreparationPage;
  settingsPage?: SettingsPage;
  onSelectView: (view: ViewKey) => void;
  onSelectPreparationPage?: (page: PreparationPage) => void;
  onOpenProfile: () => void;
};

export function AppSidebar({
  collapsed,
  activeView,
  onToggle,
  onLogout,
  onGoHome,
  onPrefetchPage,
  settingsPage,
  onSelectView,
  onOpenProfile
}: AppSidebarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItems: SidebarItem[] = [
    { key: "workbench", label: "简历分析", icon: <FileSearch size={18} />, active: activeView === "workbench", prefetch: "workbench", onClick: () => onSelectView("workbench") },
    { key: "chat", label: "对话", icon: <MessageCircle size={18} />, active: activeView === "chat", prefetch: "chat", onClick: () => onSelectView("chat") },
    { key: "profile", label: "个人资料", icon: <UserRound size={18} />, active: activeView === "settings" && settingsPage === "profile", prefetch: "profile", onClick: onOpenProfile },
    { key: "settings", label: "设置", icon: <Settings size={18} />, active: activeView === "settings" && settingsPage !== "profile", prefetch: "settings", onClick: () => onSelectView("settings") }
  ];
  const navByKey = new Map(navItems.map((item) => [item.key, item]));
  const desktopGroups = [
    { label: "求职", keys: ["workbench", "chat"] },
    { label: "账户", keys: ["profile", "settings"] }
  ];
  const mobilePrimaryKeys = ["workbench", "chat"];
  const mobileMoreKeys = ["profile", "settings"];
  const mobileMoreActive = mobileMoreKeys.some((key) => navByKey.get(key)?.active);

  function renderItem(item: SidebarItem, extraClass = "") {
    return (
      <button
        className={`nav-item ${item.active ? "active" : ""} ${extraClass}`.trim()}
        key={item.key}
        onClick={() => {
          setMobileMenuOpen(false);
          item.onClick();
        }}
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
          <span className="brand-copy"><strong>CareerLoop</strong><small>Career, in motion</small></span>
        </button>
        <div className="brand-tools">
          <button className="sidebar-toggle sidebar-edge-toggle" type="button" onClick={onToggle} title={collapsed ? "展开侧边栏" : "收起侧边栏"} aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}>
            {collapsed ? <ChevronRight size={16} strokeWidth={1.75} /> : <ChevronLeft size={16} strokeWidth={1.75} />}
          </button>
        </div>
      </div>

      <nav className="nav nav-desktop" aria-label="主导航">
        {desktopGroups.map((group) => (
          <section className="nav-group" aria-labelledby={`nav-group-${group.label}`} key={group.label}>
            <span className="nav-group-label" id={`nav-group-${group.label}`}>{group.label}</span>
            <div className="nav-group-items">
              {group.keys.map((key) => navByKey.get(key)).filter((item): item is SidebarItem => Boolean(item)).map((item) => renderItem(item))}
            </div>
          </section>
        ))}
      </nav>

      <nav className="nav nav-mobile" aria-label="移动端主导航">
        {mobilePrimaryKeys.map((key) => navByKey.get(key)).filter((item): item is SidebarItem => Boolean(item)).map((item) => renderItem(item, "mobile-nav-item"))}
        <button
          className={`nav-item mobile-nav-item mobile-more-toggle ${mobileMoreActive ? "active" : ""}`}
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-more-navigation"
          aria-label="更多导航"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={18} /><span>更多</span>
        </button>
        {mobileMenuOpen ? (
          <div className="mobile-more-navigation" id="mobile-more-navigation" aria-label="更多工作区">
            {mobileMoreKeys.map((key) => navByKey.get(key)).filter((item): item is SidebarItem => Boolean(item)).map((item) => renderItem(item, "mobile-more-item"))}
          </div>
        ) : null}
      </nav>

      <footer className="sidebar-session-actions">
        <button className="sidebar-logout" type="button" onClick={onLogout} title="退出登录" aria-label="退出登录">
          <LogOut size={18} />
          <span>退出登录</span>
        </button>
      </footer>

    </aside>
  );
}
