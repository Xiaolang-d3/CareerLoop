import { createContext, lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, LoaderCircle, Minus, Plus, RotateCcw, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatAttachment, ChatWorkspaceProps } from "./types";
import "./attachment-preview.css";

const PdfReader = lazy(() => import("../library/PdfReader"));
export const AttachmentPreviewContext = createContext<((attachment: ChatAttachment) => void) | null>(null);

export function attachmentFormat(attachment: ChatAttachment) {
  const extension = attachment.original_filename.split(".").at(-1)?.toLowerCase();
  if (attachment.kind === "image") return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "md") return "markdown";
  if (extension === "txt") return "text";
  if (extension === "docx") return "word";
  return "file";
}

function fileSize(bytes?: number) {
  if (bytes === undefined) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AttachmentPreviewDialog({ attachment, localFile, loadOriginal, onClose }: {
  attachment: ChatAttachment;
  localFile?: File;
  loadOriginal?: ChatWorkspaceProps["onLoadAttachment"];
  onClose: () => void;
}) {
  const format = attachmentFormat(attachment);
  const loaderRef = useRef(loadOriginal);
  loaderRef.current = loadOriginal;
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [imageWidth, setImageWidth] = useState<number | null>(null);

  function fitImage(image: HTMLImageElement) {
    const viewport = bodyRef.current;
    if (!viewport?.clientWidth || !viewport.clientHeight || !image.naturalWidth || !image.naturalHeight) return;
    setImageWidth(Math.min(image.naturalWidth, Math.max(1, viewport.clientWidth - 48), Math.max(1, viewport.clientHeight - 48) * image.naturalWidth / image.naturalHeight));
  }

  useEffect(() => {
    if (!url || !bodyRef.current) return;
    const observer = new ResizeObserver(() => { if (imageRef.current) fitImage(imageRef.current); });
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [url]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setLoading(true);
    setError("");
    setBlob(null);
    setUrl("");
    setBytes(null);
    setText("");
    setZoom(1);
    setImageWidth(null);
    async function load() {
      try {
        if (!localFile && !loaderRef.current) throw new Error("暂时无法读取原文件，请重新添加附件");
        const result = localFile ? { file: localFile, parsedText: attachment.parsed_text } : await loaderRef.current!(attachment, controller.signal);
        const original = result.file;
        if (controller.signal.aborted) return;
        if (format === "pdf") {
          const pdfBytes = new Uint8Array(await original.arrayBuffer());
          if (controller.signal.aborted) return;
          setBytes(pdfBytes);
        } else if (format === "image") {
          objectUrl = URL.createObjectURL(original);
          setUrl(objectUrl);
        } else if (format === "text" || format === "markdown") {
          const textBytes = await original.arrayBuffer();
          let originalText: string;
          try { originalText = new TextDecoder("utf-8", { fatal: true }).decode(textBytes); }
          catch { originalText = new TextDecoder("gb18030").decode(textBytes); }
          if (controller.signal.aborted) return;
          setText(originalText);
        } else if (format === "word") {
          setText(result.parsedText || "");
        }
        setBlob(original);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "附件读取失败，请重试");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, attachment.parsed_text, format, localFile, attempt]);

  function download() {
    if (!blob) return;
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = attachment.original_filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    const revoke = URL.revokeObjectURL.bind(URL);
    window.setTimeout(() => revoke(downloadUrl), 1_000);
  }

  const formatLabel = { image: "图片", pdf: "PDF", markdown: "Markdown", text: "文本", word: "Word", file: "附件" }[format];
  return createPortal(
    <div className="chat-attachment-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="chat-attachment-dialog" role="dialog" aria-modal="true" aria-label={`${attachment.original_filename} 预览`}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); onClose(); }
          if (event.key !== "Tab") return;
          const fields = [...dialogRef.current!.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],[tabindex='0']")].filter(field => !field.closest("[hidden]"));
          const first = fields[0], last = fields.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <header className="chat-attachment-heading">
          <div className="chat-attachment-title"><FileText size={20} aria-hidden="true" /><div><h2 title={attachment.original_filename}>{attachment.original_filename}</h2><p>{formatLabel}{fileSize(blob?.size ?? attachment.size_bytes) ? ` · ${fileSize(blob?.size ?? attachment.size_bytes)}` : ""}</p></div></div>
          <div className="chat-attachment-actions">
            <button type="button" onClick={download} disabled={!blob} aria-label="下载原文件"><Download size={16} /> <span>下载</span></button>
            <button ref={closeRef} type="button" className="chat-attachment-close" onClick={onClose} aria-label="关闭附件预览"><X size={19} /></button>
          </div>
        </header>
        {format === "word" ? <p className="chat-attachment-note">当前显示提取的文字内容，完整排版请下载原文件查看。</p> : null}
        {format === "image" && url && !error ? <nav className="chat-image-controls" aria-label="图片缩放">
          <button type="button" aria-label="缩小图片" disabled={zoom <= .5} onClick={() => setZoom(current => Math.max(.5, current - .25))}><Minus size={16} /></button>
          <button type="button" aria-label="重置图片缩放" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="放大图片" disabled={zoom >= 3} onClick={() => setZoom(current => Math.min(3, current + .25))}><Plus size={16} /></button>
        </nav> : null}
        <div ref={bodyRef} className={`chat-attachment-body is-${format}`} aria-busy={loading}>
          {loading ? <div className="chat-attachment-empty" role="status"><LoaderCircle size={20} className="spinning" /><p>正在打开附件…</p></div>
            : error ? <div className="chat-attachment-empty"><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(current => current + 1)}><RotateCcw size={15} />重新加载</button></div>
            : format === "pdf" && bytes ? <Suspense fallback={<p className="chat-attachment-empty" role="status">正在加载 PDF 阅读器…</p>}><PdfReader bytes={bytes} title={attachment.original_filename} /></Suspense>
            : format === "image" && url ? <div className="chat-image-frame" style={{ width: `${Math.max(1, zoom) * 100}%` }}><img ref={imageRef} src={url} alt={attachment.original_filename} style={imageWidth ? { width: imageWidth * zoom, maxWidth: "none" } : undefined} onLoad={(event) => fitImage(event.currentTarget)} onError={() => setError("图片无法显示，请重新加载或下载原文件查看")} /></div>
            : format === "markdown" ? <article className="chat-attachment-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{text || "文件没有文字内容。"}</ReactMarkdown></article>
            : format === "text" || format === "word" ? <pre className="chat-attachment-text">{text || (format === "word" ? "暂无提取文字，可下载原文件查看。" : "文件没有文字内容。")}</pre>
            : <div className="chat-attachment-empty"><FileText size={28} /><p>此格式暂不支持在线预览，可下载原文件查看。</p></div>}
        </div>
      </section>
    </div>, document.body
  );
}
