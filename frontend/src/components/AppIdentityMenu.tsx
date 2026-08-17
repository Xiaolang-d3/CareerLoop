import { LogOut, Settings, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ViewKey } from "../types";
import type { SettingsPage } from "../routing";

type PrefetchPage = "profile" | "account";

export type AppIdentityMenuProps = {
  userEmail?: string;
  accountName?: string;
  avatarUrl?: string | null;
  activeView?: ViewKey;
  settingsPage?: SettingsPage;
  onOpenProfile: () => void;
  onOpenAccount?: () => void;
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
  onLogout,
  onPrefetchPage
}: AppIdentityMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const displayName = accountName?.trim() || userEmail || "";
  const accountActive = activeView === "settings" && settingsPage === "account";
  const profileActive = activeView === "settings" && settingsPage === "profile";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
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
    action();
  }

  return (
    <div className="app-identity" ref={rootRef}>
      <button
        className={`sidebar-identity ${accountActive || profileActive ? "active" : ""}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={accountName?.trim() ? `${accountName.trim()} · ${userEmail}` : userEmail}
        aria-label="账号菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <span className="sidebar-identity-avatar" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : (
            <span className="sidebar-identity-glyph">{identityInitial(accountName, userEmail)}</span>
          )}
        </span>
      </button>
      {open ? (
        <div className="app-identity-menu" id={menuId} role="menu" aria-label="账号菜单">
          <div className="app-identity-summary">
            <span className="sidebar-identity-avatar" aria-hidden="true">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : (
                <span className="sidebar-identity-glyph">{identityInitial(accountName, userEmail)}</span>
              )}
            </span>
            <div>
              <strong>{displayName}</strong>
              {accountName?.trim() ? <small>{userEmail}</small> : null}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            aria-current={profileActive ? "page" : undefined}
            onClick={() => closeAnd(onOpenProfile)}
            onMouseEnter={() => onPrefetchPage?.("profile")}
            onFocus={() => onPrefetchPage?.("profile")}
          >
            <UserRound size={15} />
            求职资料
          </button>
          {onOpenAccount ? (
            <button
              type="button"
              role="menuitem"
              aria-current={accountActive ? "page" : undefined}
              onClick={() => closeAnd(onOpenAccount)}
              onMouseEnter={() => onPrefetchPage?.("account")}
              onFocus={() => onPrefetchPage?.("account")}
            >
              <Settings size={15} />
              账号与安全
            </button>
          ) : null}
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => closeAnd(onLogout)}
          >
            <LogOut size={15} />
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
