import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { HistoryAttachment } from "./HistoryAttachment";
import { AttachmentPreviewContext } from "./AttachmentPreviewDialog";
import { ResultActionsContext } from "./result-types";
import { downloadBlob } from "./result-files";
import type { ChatAttachment, ChatWorkspaceProps } from "./types";

export const AssetOriginalContext = createContext<ChatWorkspaceProps["onLoadAttachment"]>(undefined);

export function GeneratedImage({ asset, messageId }: { asset: ChatAttachment; messageId: number }) {
  const preview = useContext(AttachmentPreviewContext);
  const save = useContext(ResultActionsContext);
  const load = useContext(AssetOriginalContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function download() {
    if (!load || controller.current && !controller.current.signal.aborted) return;
    const abort = new AbortController();
    controller.current = abort; setBusy(true); setError("");
    try {
      const { file } = await load(asset, abort.signal);
      if (!abort.signal.aborted) downloadBlob(file, asset.original_filename);
    } catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "图片下载失败"); }
    finally { if (!abort.signal.aborted) { setBusy(false); controller.current = null; } }
  }
  return <figure className="chat-generated-image" aria-label="模型生成图片">
    <HistoryAttachment attachment={asset} onPreview={() => preview?.(asset)} onSave={save && messageId > 0 ? () => save(messageId, `asset:${asset.id}`, true) : undefined} />
    <figcaption><span>{asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ""}AI 生成</span>{load ? <button type="button" disabled={busy} onClick={() => void download()}><Download size={14} />{busy ? "正在下载…" : "下载原图"}</button> : null}</figcaption>
    {error ? <p role="alert">{error}</p> : null}
  </figure>;
}
