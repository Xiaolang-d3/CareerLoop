import { ChevronDown, Cpu, Settings2, TriangleAlert } from "lucide-react";

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

/** 输入框工具栏里的模型切换：未配置时引导设置，不可用时给出明确提醒。 */
export function ComposerModelPicker(props: Props) {
  if (!props.configured) {
    return (
      <button
        type="button"
        className="composer-model-picker composer-model-picker--setup"
        onClick={props.onOpenSettings}
        title="还没有可用的模型，先去设置添加模型连接"
      >
        <Settings2 size={15} />
        <span>未配置模型，去设置</span>
      </button>
    );
  }

  const warning = props.profileDisabled
    ? "当前选择的模型已停用，请切换模型或恢复默认"
    : props.serviceUnavailable
      ? "当前模型服务不可用，可切换其他模型或检查设置"
      : "";
  const label = props.currentModelName || props.defaultModelName || "默认模型";

  return (
    <span className={`composer-model-picker${warning ? " composer-model-picker--warning" : ""}`} title={warning || `当前模型：${label}`}>
      {warning ? <TriangleAlert size={15} aria-hidden="true" /> : <Cpu size={15} aria-hidden="true" />}
      <select
        aria-label="切换模型"
        aria-describedby={warning ? "composer-model-warning" : undefined}
        value={props.selectedProfileId ?? ""}
        disabled={props.busy || !props.canSelect}
        onChange={(event) => void props.onChange(event.target.value || null)}
      >
        <option value="">跟随默认{props.defaultModelName ? `（${props.defaultModelName}）` : ""}</option>
        {props.profileDisabled && props.selectedProfileId ? (
          <option value={props.selectedProfileId} disabled>
            {label}（已停用）
          </option>
        ) : null}
        {props.profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.connection_name} / {profile.model_name}
          </option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden="true" className="composer-model-picker-caret" />
      {warning ? (
        <span id="composer-model-warning" className="composer-model-picker-warning" role="status">
          {props.profileDisabled ? "已停用" : "服务不可用"}
        </span>
      ) : null}
      {props.busy ? <small role="status">保存中…</small> : null}
      {warning && props.onOpenSettings ? (
        <button type="button" className="composer-model-picker-settings" onClick={props.onOpenSettings} aria-label="打开模型设置">
          <Settings2 size={14} />
        </button>
      ) : null}
    </span>
  );
}
