import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function LibraryDialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="fl-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section
        ref={ref}
        className="fl-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
          if (event.key !== "Tab") return;
          const fields = [...ref.current!.querySelectorAll<HTMLElement>("button,input,textarea,select")].filter(
            (field) => !(field as HTMLButtonElement).disabled
          );
          const first = fields[0],
            last = fields.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="关闭弹窗" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
