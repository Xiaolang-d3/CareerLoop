import type { ReactNode } from "react";
import { AppIdentityMenu, type AppIdentityMenuProps } from "./AppIdentityMenu";

type AppTopBarProps = Partial<AppIdentityMenuProps> & {
  children?: ReactNode;
  section?: string;
  title?: string;
  onTitleClick?: () => void;
  titleClickLabel?: string;
};

export function AppTopBar({ children, section, title, onTitleClick, titleClickLabel, ...identity }: AppTopBarProps) {
  const hasIdentity = Boolean(identity.onOpenProfile && identity.onLogout);
  const actions = children ?? (hasIdentity ? <AppIdentityMenu {...(identity as AppIdentityMenuProps)} /> : null);
  return (
    <header className={`app-topbar${title ? "" : " is-titleless"}`}>
      {title ? (
        <div className="app-topbar-context">
          {section ? <span>{section}</span> : null}
          {onTitleClick ? (
            <button
              type="button"
              className="app-topbar-title-button"
              onClick={onTitleClick}
              aria-label={titleClickLabel || "重命名"}
              title={titleClickLabel || "重命名"}
            >
              <h1>{title}</h1>
            </button>
          ) : (
            <h1>{title}</h1>
          )}
        </div>
      ) : null}
      {actions ? <div className="app-topbar-actions">{actions}</div> : null}
    </header>
  );
}
