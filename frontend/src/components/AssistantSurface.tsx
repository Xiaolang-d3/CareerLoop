import { useEffect, useRef, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";
import "./AssistantSurface.css";

type Props = { page: boolean; open: boolean; busy: boolean; onClose: () => void; onExpand: () => void; children: ReactNode };
export function AssistantSurface({ page, open, busy, onClose, onExpand, children }: Props) {
  const panel = useRef<HTMLElement>(null);
  const visible = page || open;
  useEffect(() => {
    if (open && !page) panel.current?.focus();
  }, [open, page]);
  function close() { onClose(); }
  return <>
    <aside ref={panel} id="assistant-surface" tabIndex={-1} hidden={!visible} role={page ? undefined : "dialog"} aria-label={page ? "AI 工作区" : "AI 助手"} className={`chat-dock assistant-surface ${page ? "assistant-page" : "assistant-popup"}`} onKeyDown={(event) => { if (event.key === "Escape" && !page) { event.stopPropagation(); close(); } }}>
      <header className="chat-dock-header"><div><strong>{page ? "AI 工作区" : "CareerLoop 助手"}</strong><small>{busy ? "正在处理你的任务" : "基于你的知识，一起思考与创作"}</small></div>
        {!page ? <div className="assistant-controls"><button type="button" onClick={onExpand} aria-label="在独立页面打开对话" title="在独立页面打开"><Maximize2 size={18} /></button><button type="button" onClick={close} aria-label="关闭对话框"><X size={20} /></button></div> : null}
      </header>
      <div className="chat-dock-body">{children}</div>
    </aside>
  </>;
}
