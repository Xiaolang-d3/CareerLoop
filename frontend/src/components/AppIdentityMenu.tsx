import { ChevronDown, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { ViewKey } from "../types";
import type { SettingsPage } from "../routing";

type PrefetchPage = "library" | "account" | "settings";

export type AppIdentityMenuProps = {
  userEmail?: string;
  accountName?: string;
  avatarUrl?: string | null;
  activeView?: ViewKey;
  settingsPage?: SettingsPage;
  onOpenProfile: () => void;
  onOpenAccount?: () => void;
  onOpenSettings?: () => void;
  onLogout: () => void;
  onPrefetchPage?: (page: PrefetchPage) => void;
};

function identityInitial(accountName?: string, userEmail?: string) {
  return (accountName?.trim() || userEmail || "?").slice(0, 1).toUpperCase();
}

export function AppIdentityMenu({
  userEmail,
  accountName,
  avatarUrl,
  activeView,
  settingsPage,
  onOpenProfile,
  onOpenAccount,
  onOpenSettings,
  onLogout,
  onPrefetchPage
}: AppIdentityMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingFocus = useRef<"first" | "last">("first");
  const menuId = useId();
  const displayName = accountName?.trim() || userEmail?.split("@")[0] || "本地账户";
  const accountActive = activeView === "settings" && settingsPage === "account";
  const libraryActive = activeView === "settings" && settingsPage === "library";

  useEffect(() => {
    if (!open) return;
    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[openingFocus.current === "last" ? items.length - 1 : 0]?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!userEmail) return null;

  function closeAnd(action: () => void) {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  }

  function moveMenuFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div className="app-identity" ref={rootRef} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        ref={triggerRef}
        className={`sidebar-identity ${accountActive || libraryActive ? "active" : ""}`}
        type="button"
        onClick={() => { openingFocus.current = "first"; setOpen((current) => !current); }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openingFocus.current = event.key === "ArrowUp" ? "last" : "first";
          if (open) {
            const items = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
            items?.[openingFocus.current === "last" ? items.length - 1 : 0]?.focus();
          } else setOpen(true);
        }}
        title={accountName?.trim() ? `${accountName.trim()} · ${userEmail}` : userEmail}
        aria-label="账号菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <span className="sidebar-identity-avatar" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : (
            <span className="sidebar-identity-glyph">{identityInitial(accountName, userEmail)}</span>
          )}
        </span>
        <ChevronDown className="app-identity-chevron" size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div className="app-identity-menu" id={menuId} role="menu" aria-label="账号菜单" onKeyDown={moveMenuFocus}>
          <div className="app-identity-summary">
            <strong title={displayName}>{displayName}</strong>
            <small title={userEmail}>{userEmail}</small>
          </div>
          <div role="group" aria-label="账户与设置">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-current={libraryActive ? "page" : undefined}
              onClick={() => closeAnd(onOpenProfile)}
              onMouseEnter={() => onPrefetchPage?.("library")}
              onFocus={() => onPrefetchPage?.("library")}
            >
              <UserRound size={16} aria-hidden="true" />
              资料库
            </button>
            {onOpenAccount ? (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-current={accountActive ? "page" : undefined}
                onClick={() => closeAnd(onOpenAccount)}
                onMouseEnter={() => onPrefetchPage?.("account")}
                onFocus={() => onPrefetchPage?.("account")}
              >
                <ShieldCheck size={16} aria-hidden="true" />
                账号与安全
              </button>
            ) : null}
            {onOpenSettings ? (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-current={activeView === "settings" && settingsPage === "overview" ? "page" : undefined}
                onClick={() => closeAnd(onOpenSettings)}
                onMouseEnter={() => onPrefetchPage?.("settings")}
                onFocus={() => onPrefetchPage?.("settings")}
              >
                <Settings size={16} aria-hidden="true" />
                设置
              </button>
            ) : null}
          </div>
          <div className="app-identity-divider" role="separator" />
          <button
            className="danger"
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => closeAnd(onLogout)}
          >
            <LogOut size={16} aria-hidden="true" />
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
