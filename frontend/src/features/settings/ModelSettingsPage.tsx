import type { ReactNode } from "react";
import { Activity, Cpu, Gauge, Image, Layers3, LoaderCircle, RefreshCw, Save, ScanSearch, Wrench } from "lucide-react";
import { ActionButton } from "../../components/ui/ActionButton";
import type { AgentSettings, ModelCapabilityFlag, ModelCapabilityReport, ModelServiceMonitor } from "../../types";
import "./model-settings.css";

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
  capabilities: ModelCapabilityReport | null;
  capabilitiesBusy: boolean;
  onSettingsChange: (settings: AgentSettings) => void;
  onDiscoverModels: (force?: boolean) => void;
  onCheckService: () => void;
  onProbeCapabilities: () => void;
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

const capabilityLabels: Record<ModelCapabilityFlag["status"], string> = {
  supported: "支持",
  unsupported: "不支持",
  unknown: "未知"
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

function formatTokens(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function modelListItems(defaultName: string, available: string[], providerLabel: string) {
  const names = [defaultName, ...available].map((name) => name.trim()).filter(Boolean);
  return Array.from(new Set(names)).map((name) => ({
    name,
    providerLabel,
    isDefault: name === defaultName.trim()
  }));
}

function CapabilityRow({
  icon,
  label,
  flag
}: {
  icon: ReactNode;
  label: string;
  flag: ModelCapabilityFlag | undefined;
}) {
  const status = flag?.status || "unknown";
  return (
    <article className={`model-capability-row ${status}`}>
      <span>{icon}</span>
      <div>
        <strong>{label}</strong>
        <small>{flag?.detail || "尚未读取该能力"}</small>
      </div>
      <em>{capabilityLabels[status]}</em>
    </article>
  );
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
  capabilities,
  capabilitiesBusy,
  onSettingsChange,
  onDiscoverModels,
  onCheckService,
  onProbeCapabilities,
  onBeginEdit,
  onCancelEdit,
  onSave
}: Props) {
  const providerLabel = capabilities?.provider_label || "OpenAI 兼容";
  const fieldsLocked = !editing;
  const catalog = Array.from(new Set(availableModels.map((name) => name.trim()).filter(Boolean)));
  const models = modelListItems(settings.model_name, catalog, providerLabel);
  const remainingQuota = monitor?.usage?.remaining_quota ?? null;
  const quotaAvailable = Boolean(monitor?.usage?.quota_available && remainingQuota != null);
  const usedTokens = monitor?.usage?.total_tokens ?? monitor?.summary.total_tokens ?? 0;
  const windowHours = monitor?.usage?.window_hours ?? monitor?.window_hours ?? 24;

  return (
    <section className="model-settings-page">
      <div className="model-settings-top">
        <section className="settings-card model-settings-card persona-settings">
          <div className="settings-card-heading model-connection-heading">
            <span><Cpu size={18} /></span>
            <div><h3>模型连接</h3><p>对话、岗位分析和材料生成共用这一套 OpenAI 兼容连接。</p></div>
            <em className={editing ? "editing" : "locked"}>{editing ? "编辑中" : "已锁定"}</em>
          </div>
          <label>
            <span>服务协议</span>
            <input value="OpenAI 兼容" readOnly />
            <small>没有单独的供应商市场；通过 Base URL 接入官方或兼容服务。</small>
          </label>
          <div className="model-name-setting">
            <div className="model-field-heading">
              <label htmlFor="model-name-input">模型名称</label>
              <button type="button" className="model-discovery-button" disabled={discoveryBusy} onClick={() => onDiscoverModels(true)}>
                <RefreshCw className={discoveryBusy ? "spinning" : ""} size={13} />
                {discoveryBusy ? "自动识别中…" : catalog.length ? "重新识别" : "识别模型"}
              </button>
            </div>
            {catalog.length ? (
              <select id="model-name-input" value={settings.model_name} disabled={fieldsLocked} onChange={(event) => onSettingsChange({ ...settings, model_name: event.target.value })}>
                {Array.from(new Set([settings.model_name, ...catalog].filter(Boolean))).map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            ) : (
              <input id="model-name-input" value={settings.model_name} readOnly={fieldsLocked} placeholder="输入模型名称" onChange={(event) => onSettingsChange({ ...settings, model_name: event.target.value })} />
            )}
            <small className={discoveryError ? "model-discovery-error" : ""}>
              {discoveryBusy
                ? "正在从当前服务自动读取 /v1/models…"
                : discoveryError
                  ? `${discoveryError}。也可以解锁后手动填写模型名称。`
                  : catalog.length
                    ? `已自动识别 ${catalog.length} 个可用模型。`
                    : "保存的连接会自动读取模型列表；当前服务不支持时可手动输入。"}
            </small>
          </div>
          <label>
            <span>Base URL</span>
            <input value={settings.model_base_url} readOnly={fieldsLocked} placeholder="https://api.openai.com/v1" onChange={(event) => onSettingsChange({ ...settings, model_base_url: event.target.value })} onBlur={() => { if (editing && (settings.api_key || settings.api_key_configured)) onDiscoverModels(true); }} />
            <small>请填控制台里的 API 地址，不要填官网首页。兼容服务一般带 /v1，例如 https://cf.api.fan/v1。</small>
          </label>
          <label>
            <span>API Key</span>
            <input type="password" autoComplete="new-password" value={settings.api_key} readOnly={fieldsLocked} placeholder={settings.api_key_configured ? "已配置，留空则继续使用" : "请输入 API Key"} onChange={(event) => onSettingsChange({ ...settings, api_key: event.target.value })} onBlur={() => { if (editing && (settings.api_key || settings.api_key_configured)) onDiscoverModels(true); }} />
            <small>{settings.api_key_configured ? "当前已有可用密钥，系统不会显示原文。" : "密钥仅保存在本机后端。"}</small>
          </label>
          <div className="model-settings-actions">
            {editing ? (
              <>
                {savedSettings.api_key_configured ? <ActionButton variant="secondary" disabled={busy} onClick={onCancelEdit}>取消</ActionButton> : null}
                <ActionButton variant="primary" disabled={busy || !settings.model_name.trim()} onClick={onSave}>
                  {busy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}{busy ? "应用中…" : "确认并应用"}
                </ActionButton>
              </>
            ) : <ActionButton variant="secondary" onClick={onBeginEdit}>编辑或切换模型</ActionButton>}
          </div>
        </section>

        <div className="model-settings-panels">
          <section className="settings-card model-list-card">
            <div className="settings-card-heading">
              <span><Layers3 size={18} /></span>
              <div><h3>模型列表</h3><p>当前默认模型，以及服务目录里识别到的可用模型。</p></div>
            </div>
            {models.length ? (
              <div className="model-list-table" role="table" aria-label="模型列表">
                <div className="model-list-head" role="row">
                  <span>名称</span><span>服务商</span><span>默认</span>
                </div>
                {models.map((item) => (
                  <div className={`model-list-row${item.isDefault ? " default" : ""}`} role="row" key={item.name}>
                    <strong>{item.name}</strong>
                    <span>{item.providerLabel}</span>
                    <em>{item.isDefault ? "默认" : "—"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <div className="model-monitor-empty"><Layers3 size={20} /><span>尚未配置模型。解锁后填写名称，或从当前服务识别目录。</span></div>
            )}
          </section>

          <section className="settings-card model-quota-card">
            <div className="settings-card-heading">
              <span><Gauge size={18} /></span>
              <div><h3>模型额度</h3><p>只展示后端或调用记录里真实存在的用量，不会编造剩余额度。</p></div>
            </div>
            {quotaAvailable ? (
              <div className="model-quota-remaining">
                <span>剩余额度</span>
                <strong>{formatTokens(remainingQuota)}</strong>
              </div>
            ) : (
              <div className="model-quota-empty">
                <strong>暂无额度数据</strong>
                <span>当前服务没有返回剩余 token / 配额。下面是本地调用快照。</span>
              </div>
            )}
            <div className="model-monitor-metrics model-quota-metrics">
              <article>
                <span>近 {windowHours}h Token</span>
                <strong>{formatTokens(usedTokens)}</strong>
                <small>来自模型调用记录，不是服务商余额</small>
              </article>
              <article>
                <span>近 {windowHours}h 请求</span>
                <strong>{monitor ? formatTokens(monitor.summary.total_requests) : "—"}</strong>
                <small>{monitor ? `${monitor.summary.successful_requests} 次成功` : "等待监控数据"}</small>
              </article>
            </div>
          </section>

          <section className="settings-card model-capability-card">
            <div className="settings-card-heading model-monitor-heading">
              <span><ScanSearch size={18} /></span>
              <div><h3>模型能力检测</h3><p>先按模型 ID 判断，再可用一次轻量探测确认是否支持多模态。</p></div>
              <ActionButton variant="secondary" className="model-check-button" disabled={capabilitiesBusy} onClick={onProbeCapabilities}>
                <RefreshCw className={capabilitiesBusy ? "spinning" : ""} size={15} />
                {capabilitiesBusy ? "检测中…" : "检测"}
              </ActionButton>
            </div>
            <CapabilityRow icon={<Image size={16} />} label="是否支持多模态" flag={capabilities?.vision} />
            <CapabilityRow icon={<Activity size={16} />} label="流式输出" flag={capabilities?.streaming} />
            <CapabilityRow icon={<Wrench size={16} />} label="工具 / Function calling" flag={capabilities?.tools} />
            {capabilities?.probe_error ? <p className="model-capability-error">{capabilities.probe_error}</p> : null}
            {capabilities?.attachment_vision_enabled === false && capabilities.vision.status === "supported" ? (
              <p className="model-capability-note">模型侧通常支持看图，但应用看图开关 ATTACHMENT_VISION_ENABLED 尚未开启。</p>
            ) : null}
            {capabilities?.probed ? <p className="model-capability-note">多模态结果来自一次真实图片探测，不是评分。</p> : null}
          </section>
        </div>
      </div>

      <section className="settings-card model-monitor-card">
        <div className="settings-card-heading model-monitor-heading">
          <span><Activity size={18} /></span>
          <div><h3>连接状态与调用质量</h3><p>仅统计调用结果，每 15 秒刷新；不保存你的提示词和回复内容。</p></div>
          <ActionButton variant="secondary" className="model-check-button" disabled={monitorBusy} onClick={onCheckService}>
            <RefreshCw className={monitorBusy ? "spinning" : ""} size={15} />{monitorBusy ? "检测中…" : "立即检测"}
          </ActionButton>
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
