import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronsDownUp, ChevronsUpDown, Maximize2, Minimize2, Minus, Plus, RotateCcw } from "lucide-react";
import { collectExpandableIds, parseMermaidMindmap, type MindmapNode } from "./mindmap-source";
import "./ChatWorkspaceMindmap.css";

const minScale = 0.6;
const maxScale = 1.8;
const scaleStep = 0.15;

export function ChatWorkspaceMindmap({
  source,
  streaming = false
}: {
  source: string;
  streaming?: boolean;
}) {
  const normalizedSource = source.endsWith("\n") ? source.slice(0, -1) : source;
  const tree = useMemo(() => streaming ? null : parseMermaidMindmap(normalizedSource), [normalizedSource, streaming]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(tree ? collectExpandableIds(tree) : []));
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(document.fullscreenElement === rootRef.current);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (document.fullscreenElement === rootRef.current) return;
      setFullscreen(false);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (streaming) {
    return (
      <div className="chat-mindmap is-pending" data-testid="interactive-mindmap">
        <div className="chat-mindmap-pending" role="status">思维导图生成中，完成后可展开查看…</div>
      </div>
    );
  }

  if (!tree) {
    return <MindmapFallback source={normalizedSource} />;
  }

  const expandable = collectExpandableIds(tree, 0, 0);
  const allCollapsed = expandable.every((id) => collapsed.has(id));

  function toggleNode(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setScaleClamped(next: number) {
    setScale(Math.min(maxScale, Math.max(minScale, Number(next.toFixed(2)))));
  }

  function resetView() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  async function toggleFullscreen() {
    const node = rootRef.current;
    if (document.fullscreenElement === node) {
      await document.exitFullscreen?.();
      setFullscreen(false);
      return;
    }
    if (fullscreen) {
      setFullscreen(false);
      return;
    }
    if (node && typeof node.requestFullscreen === "function") {
      try {
        await node.requestFullscreen();
        if (document.fullscreenElement === node) {
          setFullscreen(true);
          return;
        }
      } catch {
        // Fall through to the in-app overlay when the browser blocks native fullscreen.
      }
    }
    setFullscreen(true);
  }

  function toggleAll() {
    setCollapsed(allCollapsed ? new Set() : new Set(expandable));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    dragRef.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <>
      {fullscreen && document.fullscreenElement !== rootRef.current ? (
        <button className="chat-mindmap-backdrop" type="button" aria-label="关闭全屏背景" onClick={() => void toggleFullscreen()} />
      ) : null}
      <div
        ref={rootRef}
        className={`chat-mindmap is-ready${fullscreen ? " is-fullscreen" : ""}`}
        data-testid="interactive-mindmap"
      >
      <div className="chat-mindmap-toolbar">
        <p>点击节点展开或收起，拖动画布移动；可全屏查看或复位视图。</p>
        <div className="chat-mindmap-actions">
          <button type="button" onClick={() => setScaleClamped(scale - scaleStep)} aria-label="缩小">
            <Minus size={14} />
          </button>
          <button type="button" onClick={() => setScaleClamped(scale + scaleStep)} aria-label="放大">
            <Plus size={14} />
          </button>
          <button type="button" onClick={resetView} aria-label="复位视图">
            <RotateCcw size={14} />
          </button>
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "退出全屏" : "全屏展示"}>
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" onClick={toggleAll} aria-label={allCollapsed ? "展开全部" : "收起分支"}>
            {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
            <span>{allCollapsed ? "展开全部" : "收起分支"}</span>
          </button>
        </div>
      </div>
      <div
        className="chat-mindmap-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="chat-mindmap-world"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        >
          <MindmapBranch node={tree} collapsed={collapsed} onToggle={toggleNode} root />
        </div>
      </div>
    </div>
    </>
  );
}

function MindmapFallback({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);

  async function copySource() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="chat-mindmap is-error" data-testid="interactive-mindmap">
      <div className="chat-mindmap-fallback" role="alert">
        <div className="chat-mindmap-fallback-header">
          <span>
            <strong>暂时无法显示这张思维导图</strong>
            <small>源码可能不完整或语法不受支持。</small>
          </span>
          <button type="button" onClick={() => void copySource()}>{copied ? "已复制" : "复制源码"}</button>
        </div>
        <pre><code className="language-mermaid">{source}</code></pre>
      </div>
    </div>
  );
}

function MindmapBranch({
  node,
  collapsed,
  onToggle,
  root = false
}: {
  node: MindmapNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  root?: boolean;
}) {
  const folded = collapsed.has(node.id);
  const childCount = node.children.length;
  const expanded = childCount > 0 && !folded;

  return (
    <div className={`chat-mindmap-branch${root ? " is-root" : ""}`}>
      {childCount ? (
        <button
          type="button"
          className={`chat-mindmap-node${root ? " is-root" : ""}${expanded ? " is-expanded" : " is-folded"}`}
          aria-expanded={expanded}
          onClick={() => onToggle(node.id)}
        >
          <span>{node.label}</span>
          <small>{folded ? `+${childCount}` : childCount}</small>
        </button>
      ) : (
        <span className={`chat-mindmap-node is-leaf${root ? " is-root" : ""}`}>{node.label}</span>
      )}
      {expanded ? (
        <div className="chat-mindmap-children">
          {node.children.map((child) => (
            <MindmapBranch key={child.id} node={child} collapsed={collapsed} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
