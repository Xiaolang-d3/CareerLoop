import { useEffect, useRef, type ReactNode } from "react";
import { MessageCircle, Maximize2, X } from "lucide-react";
import "./AssistantSurface.css";

type Props = { page: boolean; open: boolean; busy: boolean; onOpen: () => void; onClose: () => void; onExpand: () => void; children: ReactNode };
export function AssistantSurface({ page, open, busy, onOpen, onClose, onExpand, children }: Props) {
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const visible = page || open;
  useEffect(() => {
    if (open && !page) panel.current?.focus();
  }, [open, page]);
  function close() { onClose(); launcher.current?.focus(); }
  return <>
    {!page ? <button ref={launcher} className="assistant-launcher" type="button" aria-label={open ? "收起 AI 助手" : "打开 AI 助手"} aria-expanded={open} aria-controls="assistant-surface" onClick={open ? close : onOpen}><MessageCircle size={22} /><span>{busy ? "AI 正在处理…" : "AI 助手"}</span></button> : null}
    <aside ref={panel} id="assistant-surface" tabIndex={-1} hidden={!visible} role={page ? undefined : "dialog"} aria-label={page ? "AI 问答" : "AI 助手"} className={`chat-dock assistant-surface ${page ? "assistant-page" : "assistant-popup"}`} onKeyDown={(event) => { if (event.key === "Escape" && !page) { event.stopPropagation(); close(); } }}>
      <header className="chat-dock-header"><div><strong>{page ? "AI 问答" : "CareerLoop 助手"}</strong><small>{busy ? "正在处理你的任务" : "基于你的知识，一起思考与创作"}</small></div>
        {!page ? <div className="assistant-controls"><button type="button" onClick={onExpand} aria-label="在独立页面打开对话" title="在独立页面打开"><Maximize2 size={18} /></button><button type="button" onClick={close} aria-label="关闭对话框"><X size={20} /></button></div> : null}
      </header>
      <div className="chat-dock-body">{children}</div>
    </aside>
  </>;
}
