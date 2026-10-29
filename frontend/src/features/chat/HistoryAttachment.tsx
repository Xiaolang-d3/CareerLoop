import { createContext, useContext, useEffect, useRef, useState } from "react";
import { FileText, FolderPlus, ImagePlus } from "lucide-react";
import type { ChatAttachment, ChatWorkspaceProps } from "./types";
import "./results.css";

export const AttachmentThumbnailContext = createContext<ChatWorkspaceProps["onLoadAttachmentThumbnail"]>(undefined);

export function HistoryAttachment({ attachment, onPreview, onSave, variant = "attachment" }: {
  attachment: ChatAttachment; onPreview: () => void; onSave?: () => void; variant?: "attachment" | "generated";
}) {
  const loader = useContext(AttachmentThumbnailContext);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attachment.kind !== "image" || !loaderRef.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "240px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [attachment.id, attachment.kind]);
  useEffect(() => {
    if (!visible || !loaderRef.current || attachment.kind !== "image") return;
    const abort = new AbortController();
    let objectUrl = "";
    setUrl(""); setFailed(false);
    void loaderRef.current(attachment, abort.signal).then(blob => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.id, attachment.kind, visible, attempt]);
  const imageAttachment = attachment.kind === "image" && variant !== "generated";
  return <div className={variant === "generated" ? "generated-image-preview" : `chat-history-attachment${attachment.kind === "image" ? " is-image" : ""}`} ref={ref}>
    <button type="button" onClick={onPreview} aria-label={`预览 ${attachment.original_filename}`}>
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : attachment.kind === "image" ? <ImagePlus size={16} /> : <FileText size={16} />}
      {variant !== "generated" && !imageAttachment ? <span>{attachment.original_filename}</span> : null}
    </button>
    {imageAttachment ? <div className="chat-history-attachment-meta">
      <span className="chat-history-attachment-name" title={attachment.original_filename}>{attachment.original_filename}</span>
      {attachment.vision_status === "consented" ? <em>模型看图</em> : null}
    </div> : null}
    {failed ? <button type="button" onClick={() => setAttempt(value => value + 1)}>缩略图加载失败，重试</button> : null}
    {onSave ? <button type="button" className="chat-history-attachment-save" onClick={onSave} aria-label={`保存 ${attachment.original_filename} 到文件库`}><FolderPlus size={13} aria-hidden="true" />保存到文件库</button> : null}
  </div>;
}
