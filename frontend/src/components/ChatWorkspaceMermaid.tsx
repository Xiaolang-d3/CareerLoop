import { useEffect, useId, useRef, useState } from "react";
import "./ChatWorkspaceMermaid.css";

type MermaidStatus = "idle" | "loading" | "ready" | "error";

let mermaidInitialized = false;
let mermaidLoadPromise: Promise<(typeof import("mermaid"))["default"]> | null = null;
let mermaidRenderQueue: Promise<void> = Promise.resolve();

function loadMermaid() {
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = import("mermaid")
      .then(({ default: mermaid }) => {
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme: "base",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            flowchart: { htmlLabels: false },
            themeVariables: {
              primaryColor: "#f2efff",
              primaryTextColor: "#302b55",
              primaryBorderColor: "#8d82dc",
              lineColor: "#77708f",
              secondaryColor: "#eef7f4",
              tertiaryColor: "#faf9ff",
              background: "#ffffff",
              mainBkg: "#f7f5ff",
              nodeBorder: "#8d82dc",
              clusterBkg: "#faf9ff",
              clusterBorder: "#d9d4ef",
              edgeLabelBackground: "#ffffff"
            }
          });
          mermaidInitialized = true;
        }
        return mermaid;
      })
      .catch((error) => {
        mermaidLoadPromise = null;
        throw error;
      });
  }
  return mermaidLoadPromise;
}

function renderMermaid(id: string, source: string) {
  const task = mermaidRenderQueue.then(async () => {
    const mermaid = await loadMermaid();
    return mermaid.render(id, source);
  });
  mermaidRenderQueue = task.then(() => undefined, () => undefined);
  return task;
}

function sourceWithoutMarkdownNewline(source: string): string {
  return source.endsWith("\n") ? source.slice(0, -1) : source;
}

export function ChatWorkspaceMermaid({
  source: rawSource,
  streaming = false
}: {
  source: string;
  streaming?: boolean;
}) {
  const source = sourceWithoutMarkdownNewline(rawSource);
  const reactId = useId();
  const containerId = `chat-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const renderAttemptRef = useRef(0);
  const [status, setStatus] = useState<MermaidStatus>("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    let cancelled = false;

    container?.replaceChildren();
    setCopied(false);

    if (streaming || !source.trim()) {
      setStatus("idle");
      return () => {
        cancelled = true;
        container?.replaceChildren();
      };
    }

    setStatus("loading");
    const attempt = ++renderAttemptRef.current;

    void renderMermaid(`${containerId}-render-${attempt}`, source)
      .then(({ svg, bindFunctions }) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        bindFunctions?.(containerRef.current);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        containerRef.current?.replaceChildren();
        setStatus("error");
      });

    return () => {
      cancelled = true;
      container?.replaceChildren();
    };
  }, [containerId, source, streaming]);

  async function copySource() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`chat-mermaid is-${status}`} data-testid="mermaid-diagram">
      {streaming ? (
        <div className="chat-mermaid-pending" role="status">图表生成中，完成后显示…</div>
      ) : (
        <>
          <div
            ref={containerRef}
            id={containerId}
            className="chat-mermaid-canvas"
            role="img"
            aria-label="Mermaid 图表"
          />
          {status === "loading" ? <div className="chat-mermaid-pending" role="status">正在绘制图表…</div> : null}
          {status === "error" ? (
            <div className="chat-mermaid-fallback" role="alert">
              <div className="chat-mermaid-fallback-header">
                <span>
                  <strong>暂时无法显示这张图</strong>
                  <small>图表源码可能不完整或语法不受支持。</small>
                </span>
                <button type="button" onClick={() => void copySource()}>
                  {copied ? "已复制" : "复制源码"}
                </button>
              </div>
              <pre><code className="language-mermaid">{source}</code></pre>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
