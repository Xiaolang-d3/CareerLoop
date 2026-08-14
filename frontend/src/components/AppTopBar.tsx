import type { ReactNode } from "react";
import { AppIdentityMenu, type AppIdentityMenuProps } from "./AppIdentityMenu";

type AppTopBarProps = Partial<AppIdentityMenuProps> & {
  children?: ReactNode;
  section?: string;
  title?: string;
};

export function AppTopBar({ children, section, title, ...identity }: AppTopBarProps) {
  const hasIdentity = Boolean(identity.onOpenProfile && identity.onLogout);
  const actions = children ?? (hasIdentity ? <AppIdentityMenu {...(identity as AppIdentityMenuProps)} /> : null);
  return (
    <header className="app-topbar">
      {title ? (
        <div className="app-topbar-context">
          {section ? <span>{section}</span> : null}
          <h1>{title}</h1>
        </div>
      ) : null}
      {actions ? <div className="app-topbar-actions">{actions}</div> : null}
    </header>
  );
}
