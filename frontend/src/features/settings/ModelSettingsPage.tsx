import { Activity, Bot, LoaderCircle, RefreshCw, Save } from "lucide-react";
import type { AgentSettings, ModelServiceMonitor } from "../../types";

type Props = {
  settings: AgentSettings;
  savedSettings: AgentSettings;
  editing: boolean;
  busy: boolean;
  monitor: ModelServiceMonitor | null;
  monitorBusy: boolean;
  availableModels: string[];
  discoveryBusy: boolean;
  discoveryError: string;
  onSettingsChange: (settings: AgentSettings) => void;
  onDiscoverModels: (force?: boolean) => void;
  onCheckService: () => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
};

const statusLabels: Record<ModelServiceMonitor["status"], string> = {
  healthy: "运行正常",
  degraded: "服务波动",
  unavailable: "当前不可用",
  unknown: "等待检测"
};

const requestKindLabels: Record<string, string> = {
  generate: "普通调用",
  stream: "流式调用",
  health_check: "主动检测"
};

function formatTime(value: string | null) {
  if (!value) return "暂无";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatLatency(value: number | null) {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
}

export function ModelSettingsPage({
  settings,
  savedSettings,
  editing,
  busy,
  monitor,
  monitorBusy,
  availableModels,
  discoveryBusy,
  discoveryError,
  onSettingsChange,
  onDiscoverModels,
  onCheckService,
  onBeginEdit,
  onCancelEdit,
  onSave
}: Props) {
  return (
    <section className="model-settings-page">
      <section className="settings-card model-settings-card persona-settings">
        <div className="settings-card-heading model-connection-heading">
          <span><Bot size={18} /></span>
          <div><h3>Agent 推理模型</h3><p>这是 Agent 分析岗位、生成材料和整理复盘时使用的推理服务。</p></div>
          <em className={editing ? "editing" : "locked"}>{editing ? "编辑中" : "已锁定"}</em>
        </div>
        <div className="model-name-setting">
          <div className="model-field-heading">
            <label htmlFor="model-name-input">模型名称</label>
            <button type="button" className="model-discovery-button" disabled={discoveryBusy} onClick={() => onDiscoverModels(true)}>
              <RefreshCw className={discoveryBusy ? "spinning" : ""} size={13} />
              {discoveryBusy ? "自动识别中…" : availableModels.length ? "重新识别" : "识别模型"}
            </button>
          </div>
          {availableModels.length ? (
            <select id="model-name-input" value={settings.model_name} disabled={!editing} onChange={(event) => onSettingsChange({ ...settings, model_name: event.target.value })}>
              {Array.from(new Set([settings.model_name, ...availableModels].filter(Boolean))).map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          ) : (
            <input id="model-name-input" value={settings.model_name} readOnly={!editing} placeholder="输入模型名称" onChange={(event) => onSettingsChange({ ...settings, model_name: event.target.value })} />
          )}
          <small className={discoveryError ? "model-discovery-error" : ""}>
            {discoveryBusy
              ? "正在从当前服务自动读取 /v1/models…"
              : discoveryError
                ? `${discoveryError}；当前服务可能不支持模型目录，可解锁后手动填写。`
                : availableModels.length
                  ? `已自动识别 ${availableModels.length} 个可用模型。`
                  : "保存的连接会自动读取模型列表；当前服务不支持时可手动输入。"}
          </small>
        </div>
        <label>
          <span>Base URL</span>
          <input value={settings.model_base_url} readOnly={!editing} placeholder="https://api.openai.com/v1" onChange={(event) => onSettingsChange({ ...settings, model_base_url: event.target.value })} onBlur={() => { if (editing && (settings.api_key || settings.api_key_configured)) onDiscoverModels(true); }} />
          <small>留空使用 OpenAI 默认地址；也可填写兼容服务地址。</small>
        </label>
        <label>
          <span>API Key</span>
          <input type="password" autoComplete="new-password" value={settings.api_key} readOnly={!editing} placeholder={settings.api_key_configured ? "已配置，留空则继续使用" : "请输入 API Key"} onChange={(event) => onSettingsChange({ ...settings, api_key: event.target.value })} onBlur={() => { if (editing && (settings.api_key || settings.api_key_configured)) onDiscoverModels(true); }} />
          <small>{settings.api_key_configured ? "当前已有可用密钥，系统不会显示原文。" : "密钥仅保存在本机后端。"}</small>
        </label>
        <div className="model-settings-actions">
          {editing ? (
            <>
              {savedSettings.api_key_configured ? <button className="secondary-button" disabled={busy} onClick={onCancelEdit}>取消</button> : null}
              <button className="primary-button" disabled={busy || !settings.model_name.trim()} onClick={onSave}>
                {busy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}{busy ? "应用中…" : "确认并应用"}
              </button>
            </>
          ) : <button className="secondary-button" onClick={onBeginEdit}>编辑或切换模型</button>}
        </div>
      </section>

      <section className="settings-card model-monitor-card">
        <div className="settings-card-heading model-monitor-heading">
          <span><Activity size={18} /></span>
          <div><h3>连接状态与调用质量</h3><p>仅统计调用结果，每 15 秒刷新；不保存你的提示词和回复内容。</p></div>
          <button className="secondary-button model-check-button" disabled={monitorBusy} onClick={onCheckService}>
            <RefreshCw className={monitorBusy ? "spinning" : ""} size={15} />{monitorBusy ? "检测中…" : "立即检测"}
          </button>
        </div>
        <div className={`model-monitor-status ${monitor?.status || "unknown"}`}>
          <i /><div><strong>{monitor ? statusLabels[monitor.status] : "正在读取状态"}</strong><small>{monitor?.status_message || "正在获取最近的模型调用记录…"}</small></div>
          <span>{monitor?.last_event_at ? `更新于 ${formatTime(monitor.last_event_at)}` : "暂无调用"}</span>
        </div>
        <div className="model-monitor-metrics">
          <article><span>成功率 · 24h</span><strong>{monitor?.summary.success_rate == null ? "—" : `${monitor.summary.success_rate}%`}</strong><small>{monitor ? `${monitor.summary.successful_requests} / ${monitor.summary.total_requests} 次成功` : "等待数据"}</small></article>
          <article><span>P95 响应耗时</span><strong>{formatLatency(monitor?.summary.p95_latency_ms ?? null)}</strong><small>平均 {formatLatency(monitor?.summary.average_latency_ms ?? null)}</small></article>
          <article><span>超时次数</span><strong>{monitor?.summary.timeout_count ?? "—"}</strong><small>{monitor?.summary.consecutive_failures ? `当前连续失败 ${monitor.summary.consecutive_failures} 次` : "当前无连续失败"}</small></article>
          <article><span>当前服务</span><strong className="model-monitor-name">{monitor?.model_name || settings.model_name || "—"}</strong><small>{monitor?.base_url || "OpenAI 默认地址"}</small></article>
        </div>
        {monitor?.error_breakdown.length ? <div className="model-monitor-errors"><span>近 24 小时异常</span><div>{monitor.error_breakdown.map((item) => <em key={item.code}>{item.label} {item.count}</em>)}</div></div> : null}
        <div className="model-monitor-events">
          <div className="model-monitor-section-title"><strong>最近调用</strong><span>仅记录类型、状态、耗时和错误分类</span></div>
          {monitor?.recent_events.length ? (
            <div className="model-monitor-event-list">
              {monitor.recent_events.slice(0, 6).map((event) => <div className={event.status} key={event.id}><i /><strong>{requestKindLabels[event.request_kind] || event.request_kind}</strong><span>{event.status === "success" ? formatLatency(event.latency_ms) : event.error_message || "调用失败"}</span><time>{formatTime(event.created_at)}</time></div>)}
            </div>
          ) : <div className="model-monitor-empty"><Activity size={20} /><span>还没有调用记录，点击“立即检测”生成第一条状态数据。</span></div>}
        </div>
      </section>
    </section>
  );
}
