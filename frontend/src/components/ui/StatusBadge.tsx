import type { ReactNode } from "react";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  icon?: ReactNode;
  className?: string;
};

export function StatusBadge({
  children,
  tone = "neutral",
  icon,
  className = ""
}: StatusBadgeProps) {
  return (
    <span className={`ui-status-badge ui-status-${tone} ${className}`.trim()}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
