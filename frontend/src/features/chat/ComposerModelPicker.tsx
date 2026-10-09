import { Check, ChevronUp, Settings2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

type ModelProfileOption = { id: string; model_name: string; connection_name: string };

type Props = {
  configured: boolean;
  currentModelName?: string;
  defaultModelName?: string;
  profiles: ModelProfileOption[];
  selectedProfileId: string | null;
  profileDisabled: boolean;
  serviceUnavailable: boolean;
  busy: boolean;
  canSelect: boolean;
  onChange: (profileId: string | null) => void | Promise<void>;
  onOpenSettings?: () => void;
};

const VENDORS: Array<{ match: RegExp; key: string; label: string }> = [
  { match: /gpt|openai|o[134]-|chatgpt/i, key: "openai", label: "G" },
  { match: /claude|anthropic/i, key: "claude", label: "C" },
  { match: /deepseek/i, key: "deepseek", label: "D" },
  { match: /qwen|tongyi|通义/i, key: "qwen", label: "Q" },
  { match: /glm|zhipu|智谱/i, key: "glm", label: "Z" },
  { match: /grok|xai/i, key: "grok", label: "X" },
  { match: /gemini|google/i, key: "gemini", label: "G" },
  { match: /kimi|moonshot/i, key: "kimi", label: "K" },
  { match: /doubao|豆包/i, key: "doubao", label: "豆" },
  { match: /llama|ollama|mistral/i, key: "local", label: "L" }
];

function vendorOf(name: string) {
  return VENDORS.find((vendor) => vendor.match.test(name)) ?? { key: "default", label: (name.trim()[0] || "?").toUpperCase() };
}

function ModelIcon({ name }: { name: string }) {
  const vendor = vendorOf(name);
  return <span className={`model-icon model-icon--${vendor.key}`} aria-hidden="true">{vendor.label}</span>;
}

/** 输入框工具栏里的模型切换：胶囊按钮 + 向上弹出的分组菜单。 */
export function ComposerModelPicker(props: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 16);
      setMenuStyle({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), bottom: window.innerHeight - rect.top + 8, width, maxHeight: Math.max(160, Math.min(440, rect.top - 16)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { const target = event.target as Node; if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    const target = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]:not([aria-disabled="true"])') ?? listRef.current?.querySelector<HTMLElement>('[role="option"]');
    target?.focus();
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!props.configured) {
    return (
      <button type="button" className="model-pill model-pill--setup" onClick={props.onOpenSettings} title="还没有可用的模型，先去设置添加模型连接">
        <Settings2 size={15} />
        <span>未配置模型，去设置</span>
      </button>
    );
  }

  const label = props.currentModelName || props.defaultModelName || "默认模型";
  const warning = props.profileDisabled ? "已停用" : props.serviceUnavailable ? "服务不可用" : "";
  const groups = new Map<string, ModelProfileOption[]>();
  for (const profile of props.profiles) groups.set(profile.connection_name, [...(groups.get(profile.connection_name) ?? []), profile]);
  const disabled = props.busy || !props.canSelect;

  const choose = (profileId: string | null) => {
    setOpen(false);
    if (profileId !== props.selectedProfileId) void props.onChange(profileId);
  };
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); rootRef.current?.querySelector<HTMLElement>(".model-pill")?.focus(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
  };
  const option = (id: string | null, name: string, text?: string) => {
    const selected = (props.selectedProfileId ?? null) === id;
    return (
      <button key={id ?? "default"} type="button" role="option" aria-selected={selected} className={`model-option${selected ? " is-selected" : ""}`} onClick={() => choose(id)}>
        <ModelIcon name={name} />
        <span className="model-option-name">{text ?? name}</span>
        {selected ? <Check size={15} className="model-option-check" aria-hidden="true" /> : null}
      </button>
    );
  };

  return (
    <div className="model-picker" ref={rootRef}>
      {open ? createPortal(
        <div className="model-menu" id={listId} role="listbox" aria-label="选择模型" ref={listRef} onKeyDown={onListKey} style={menuStyle}>
          <div className="model-menu-scroll">
            {warning ? (
              <p className="model-menu-alert">
                <TriangleAlert size={14} aria-hidden="true" />
                {props.profileDisabled ? "当前模型已停用，请换一个模型" : "当前模型服务不可用，可以换一个模型或检查设置"}
              </p>
            ) : null}
            <div className="model-menu-group-label">默认</div>
            {option(null, props.defaultModelName || "默认模型", `跟随默认${props.defaultModelName ? ` · ${props.defaultModelName}` : ""}`)}
            {Array.from(groups.entries()).map(([group, items]) => (
              <div key={group} role="group" aria-label={group}>
                <div className="model-menu-group-label">{group}</div>
                {items.map((profile) => option(profile.id, profile.model_name))}
              </div>
            ))}
            {props.profileDisabled && props.selectedProfileId ? (
              <div role="option" aria-selected="true" aria-disabled="true" className="model-option is-disabled">
                <ModelIcon name={label} /><span className="model-option-name">{label}</span><small>已停用</small>
              </div>
            ) : null}
          </div>
          {props.onOpenSettings ? (
            <button type="button" className="model-menu-footer" onClick={() => { setOpen(false); props.onOpenSettings?.(); }}>
              <Settings2 size={14} aria-hidden="true" />管理模型
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}
      <button
        type="button"
        className={`model-pill${warning ? " model-pill--warning" : ""}${open ? " is-open" : ""}`}
        aria-label={`切换模型，当前 ${label}${warning ? `（${warning}）` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        title={warning ? `当前模型${warning}` : props.canSelect ? `当前模型：${label}` : "开始对话后可切换模型"}
        onClick={() => setOpen((value) => !value)}
      >
        {warning ? <TriangleAlert size={15} aria-hidden="true" className="model-pill-alert" /> : <ModelIcon name={label} />}
        <span className="model-pill-name">{label}</span>
        {warning ? <span className="model-pill-badge" role="status">{warning}</span> : null}
        {props.busy ? <small className="model-pill-busy" role="status">保存中…</small> : <ChevronUp size={14} aria-hidden="true" className="model-pill-caret" />}
      </button>
    </div>
  );
}
