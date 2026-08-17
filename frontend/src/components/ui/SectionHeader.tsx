import type { ReactNode } from "react";

type SectionHeaderProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  level?: 1 | 2 | 3;
  className?: string;
};

export function SectionHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
  level = 2,
  className = ""
}: SectionHeaderProps) {
  const Heading = `h${level}` as "h1" | "h2" | "h3";
  return (
    <header className={`ui-section-header ${className}`.trim()}>
      <div className="ui-section-copy">
        {eyebrow ? <span className="ui-eyebrow">{eyebrow}</span> : null}
        {title ? <Heading>{title}</Heading> : null}
        {meta}
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-section-actions">{actions}</div> : null}
    </header>
  );
}
