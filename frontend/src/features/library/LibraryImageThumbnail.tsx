import { useEffect, useRef, useState } from "react";
import { FileImage } from "lucide-react";
import type { LibrarySource, LibrarySourceDetail } from "../../types";

export function LibraryImageThumbnail({ source, loadOriginal }: {
  source: LibrarySource;
  loadOriginal?: (source: LibrarySourceDetail, signal?: AbortSignal) => Promise<Blob>;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const loader = useRef(loadOriginal);
  loader.current = loadOriginal;
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setUrl("");
    setFailed(false);
    if (!visible || !source.file_available || !loader.current) return;
    const controller = new AbortController();
    let objectUrl = "";
    // Reuse the authenticated file loader; browsing thumbnails must not mark files as opened.
    void loader.current({ ...source, content: "", redacted_content: "", metadata: {} }, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        if (!blob.type.startsWith("image/")) throw new Error("图片不可用");
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source.id, source.updated_at, source.file_available, visible]);
  return <span className="fl-image-thumbnail" ref={element}>
    {url && !failed ? <img src={url} alt={source.title} onError={() => setFailed(true)} />
      : <span className="fl-image-placeholder"><FileImage size={30} /><span>{failed || !source.file_available || !loadOriginal ? "图片暂不可预览" : "正在加载图片…"}</span></span>}
  </span>;
}
