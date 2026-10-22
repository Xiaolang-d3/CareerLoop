import { Check, ChevronRight, ChevronUp, RefreshCw, Search, Settings2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ChatWorkspaceProps } from "./types";
import { ComposerModelParameters, type ComposerModelSettings } from "./ComposerModelParameters";

type ModelProfileOption = { id: string; model_name: string; connection_name: string; connection_id?: string };
type ModelOption = { id?: string; model_name: string };

type Props = {
  configured: boolean;
  currentModelName?: string;
  defaultModelName?: string;
  profiles: ModelProfileOption[];
  serviceModels?: ChatWorkspaceProps["serviceModels"];
  onDiscover?: (refresh?: boolean) => Promise<void>;
  onServiceChange?: (modelName: string) => Promise<void>;
  selectedProfileId: string | null;
  profileDisabled: boolean;
  serviceUnavailable: boolean;
  busy: boolean;
  canSelect: boolean;
  onChange: (profileId: string | null) => void | Promise<void>;
  onOpenSettings?: () => void;
  modelSettings?: ComposerModelSettings;
};

/** 输入框工具栏里的模型切换：胶囊按钮 + 向上弹出的分组菜单。 */
export function ComposerModelPicker(props: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"models" | "parameters">("models");
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const discoverRef = useRef(props.onDiscover);
  discoverRef.current = props.onDiscover;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    void discoverRef.current?.();
  }, [open, props.serviceModels?.connection_id, props.serviceModels?.revision]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(340, window.innerWidth - 16);
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
    const target = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]:not([aria-disabled="true"])') ?? listRef.current?.querySelector<HTMLElement>('[role="option"]') ?? listRef.current?.querySelector<HTMLElement>("button");
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
  const groups = new Map<string, { name: string; items: ModelOption[] }>();
  const service = props.serviceModels;
  if (service) groups.set(service.connection_id, { name: service.connection_name, items: [] });
  for (const profile of props.profiles) {
    const key = profile.connection_id ?? profile.connection_name;
    const group = groups.get(key) ?? { name: profile.connection_name, items: [] };
    group.items.push(profile);
    groups.set(key, group);
  }
  if (service) {
    const group = groups.get(service.connection_id)!;
    for (const name of service.models) {
      if (!group.items.some(profile => profile.model_name === name)) group.items.push({ model_name: name });
    }
  }
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = Array.from(groups.entries()).map(([key, group]) => [key, { ...group, items: group.items.filter(item => `${item.model_name} ${group.name}`.toLowerCase().includes(normalizedQuery)) }] as const).filter(([, group]) => group.items.length);
  const count = Array.from(groups.values()).reduce((total, group) => total + group.items.length, 0);
  const visibleCount = visibleGroups.reduce((total, [, group]) => total + group.items.length, 0);
  const disabled = props.busy || !props.canSelect;

  const choose = (profileId: string) => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLElement>(".model-pill")?.focus();
    if (profileId !== props.selectedProfileId) void props.onChange(profileId);
  };
  const chooseService = (modelName: string) => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLElement>(".model-pill")?.focus();
    void props.onServiceChange?.(modelName);
  };
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); rootRef.current?.querySelector<HTMLElement>(".model-pill")?.focus(); return; }
    if (panel !== "models" || !(event.target as HTMLElement).matches('[role="option"]')) return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
  };
  const option = (id: string | undefined, name: string) => {
    const selected = id !== undefined && props.selectedProfileId === id;
    return (
      <button key={id ?? `service:${name}`} type="button" role="option" aria-label={name} aria-selected={selected} disabled={disabled} className={`model-option${selected ? " is-selected" : ""}`} onClick={() => id === undefined ? chooseService(name) : choose(id)} title={name}>
        <span className="model-option-copy">
          <span className="model-option-name">{name}</span>
        </span>
        {selected ? <Check size={15} className="model-option-check" aria-hidden="true" /> : null}
      </button>
    );
  };

  return (
    <div className="model-picker" ref={rootRef}>
      {open ? createPortal(
        <div className="model-menu" id={listId} role="dialog" aria-label="模型与参数" ref={listRef} onKeyDown={onListKey} style={menuStyle}>
          {props.modelSettings ? <div className="model-menu-tabs" role="group" aria-label="模型菜单页面">
            <button type="button" aria-pressed={panel === "models"} onClick={() => setPanel("models")}>切换模型</button>
            <button type="button" aria-pressed={panel === "parameters"} onClick={() => setPanel("parameters")}>思考设置</button>
          </div> : null}
          {panel === "parameters" && props.modelSettings ? <ComposerModelParameters key={`${props.modelSettings.profile.id}:${props.modelSettings.profile.revision}`} settings={props.modelSettings} disabled={disabled} /> : <>
          <div className="model-menu-tools">
            <div className="model-menu-heading"><span>可选模型 <small>{normalizedQuery ? visibleCount : count}</small></span>{service ? <button type="button" aria-label="刷新模型列表" disabled={service.busy || disabled} onClick={() => void props.onDiscover?.(true)} title="刷新当前服务的模型列表"><RefreshCw size={14} className={service.busy ? "spinning" : undefined} aria-hidden="true" /></button> : null}</div>
            <label className="model-menu-search"><Search size={15} aria-hidden="true" /><input aria-label="搜索模型" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模型或连接" autoComplete="off" /></label>
            {service?.busy ? <p className="model-menu-status" role="status">正在读取服务模型…</p> : null}
            {service?.error ? <p className="model-menu-status model-menu-error" role="alert">{service.error} <button type="button" disabled={service.busy || disabled} onClick={() => void props.onDiscover?.(true)}>重试</button></p> : null}
          </div>
          <div className="model-menu-scroll" role="listbox" aria-label="选择模型">
            {warning ? (
              <p className="model-menu-alert">
                <TriangleAlert size={14} aria-hidden="true" />
                {props.profileDisabled ? "当前模型已停用，请换一个模型" : "当前模型服务不可用，可以换一个模型或检查设置"}
              </p>
            ) : null}
            {visibleGroups.map(([key, group]) => (
              <div key={key} role="group" aria-label={group.name}>
                <div className="model-menu-group-label">{group.name} <span>{group.items.length}</span></div>
                {group.items.map((profile) => option(profile.id, profile.model_name))}
              </div>
            ))}
            {normalizedQuery && !visibleGroups.length ? <p className="model-menu-status">没有匹配的模型</p> : null}
            {props.profileDisabled && props.selectedProfileId ? (
              <div role="option" aria-selected="true" aria-disabled="true" className="model-option is-disabled">
                <span className="model-option-copy"><span className="model-option-name">{label}</span></span><small>已停用</small>
              </div>
            ) : null}
          </div>
          </>}
          {props.onOpenSettings ? (
            <button type="button" className="model-menu-footer" onClick={() => { setOpen(false); props.onOpenSettings?.(); }}>
              <Settings2 size={14} aria-hidden="true" /><span>管理模型</span><ChevronRight size={14} className="model-menu-footer-arrow" aria-hidden="true" />
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}
      <button
        type="button"
        className={`model-pill${warning ? " model-pill--warning" : ""}${open ? " is-open" : ""}`}
        aria-label={`切换模型，当前 ${label}${warning ? `（${warning}）` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        title={warning ? `当前模型${warning}` : props.canSelect ? `当前模型：${label}` : "开始对话后可切换模型"}
        onClick={() => setOpen((value) => !value)}
      >
        {warning ? <TriangleAlert size={15} aria-hidden="true" className="model-pill-alert" /> : null}
        <span className="model-pill-name">{label}</span>
        {warning ? <span className="model-pill-badge" role="status">{warning}</span> : null}
        {props.busy ? <small className="model-pill-busy" role="status">保存中…</small> : <ChevronUp size={14} aria-hidden="true" className="model-pill-caret" />}
      </button>
    </div>
  );
}
