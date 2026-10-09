import type { ReactNode } from "react";

type AppTopBarProps = {
  children?: ReactNode;
  section?: string;
  title?: string;
  onTitleClick?: () => void;
  titleClickLabel?: string;
};

export function AppTopBar({ children, section, title, onTitleClick, titleClickLabel }: AppTopBarProps) {
  if (!title && !children) return null;
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
      {children ? <div className="app-topbar-actions">{children}</div> : null}
    </header>
  );
}
