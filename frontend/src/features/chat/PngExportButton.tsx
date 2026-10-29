import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { downloadBlob } from "./result-files";
import { imageToPng, pngFilename } from "./image-png";

export function PngExportButton({ filename, load, disabled = false }: {
  filename: string; load: (signal: AbortSignal) => Promise<Blob>; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function exportPng() {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError("");
    try {
      const original = await load(abort.signal);
      if (abort.signal.aborted) return;
      const png = await imageToPng(original);
      if (!abort.signal.aborted) downloadBlob(png, pngFilename(filename));
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "PNG 导出失败，请重试");
    } finally {
      if (!abort.signal.aborted) { setBusy(false); controller.current = null; }
    }
  }
  return <>
    <button type="button" disabled={disabled || busy} onClick={() => void exportPng()}><Download size={14} aria-hidden="true" />{busy ? "正在导出…" : "导出 PNG"}</button>
    {error ? <span role="alert">{error}</span> : null}
  </>;
}
