import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./model-settings.css";

export function ModelSettingsDialog({ title, locked = false, onClose, children }: {
  title: string; locked?: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const backdrop = ref.current?.parentElement;
    const siblings = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== backdrop);
    const states = siblings.map(node => [node, node.inert] as const);
    siblings.forEach(node => { node.inert = true; });
    (ref.current?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled)")
      ?? ref.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? ref.current)?.focus();
    return () => {
      document.body.style.overflow = overflow;
      states.forEach(([node, inert]) => { node.inert = inert; });
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div className="model-dialog-backdrop">
      <section ref={ref} className="model-settings-page model-settings-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          if (!locked) onClose();
        }
        if (event.key !== "Tab") return;
        const fields = Array.from(ref.current?.querySelectorAll<HTMLElement>("*") ?? []).filter(field => {
          if (!field.matches("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex='0']")) return false;
          const details = field.closest("details");
          return !details || details.open || field === details.querySelector("summary");
        });
        const first = fields[0], last = fields.at(-1);
        if (!first) { event.preventDefault(); ref.current?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
        <header className="model-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭模型设置" disabled={locked} onClick={onClose}><X size={18} /></button></header>
        {children}
      </section>
    </div>, document.body
  );
}
