import { useState, type ReactNode } from "react";
import { Activity, ChevronDown, Cpu, Gauge, Image, LoaderCircle, RefreshCw, Save, ScanSearch, Wrench } from "lucide-react";
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

function resolvedProtocol(modelName: string, configured: AgentSettings["model_protocol"], baseUrl: string) {
  if (configured !== "auto") return configured;
  const normalizedBaseUrl = baseUrl.trim();
  if (/anthropic\.com/i.test(normalizedBaseUrl)) return "anthropic";
  if (/generativelanguage\.googleapis\.com/i.test(normalizedBaseUrl)) return "gemini";
  if (/ollama/i.test(normalizedBaseUrl) || /:11434(?:\/|$)/i.test(normalizedBaseUrl)) return "ollama";
  if (/claude/i.test(modelName)) return "anthropic";
  if (/gemini/i.test(modelName)) return "gemini";
  return "openai";
}

function protocolLabel(protocol: Exclude<AgentSettings["model_protocol"], "auto">) {
  return {
    openai: "OpenAI 兼容 Chat Completions",
    responses: "OpenAI Responses API",
    anthropic: "Anthropic Messages API",
    gemini: "Google Gemini generateContent",
    ollama: "Ollama Chat API"
  }[protocol];
}

function protocolBaseUrl(protocol: Exclude<AgentSettings["model_protocol"], "auto">) {
  return {
    openai: "https://api.openai.com/v1",
    responses: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    ollama: "http://127.0.0.1:11434"
  }[protocol];
}

function protocolBaseUrlHelp(protocol: Exclude<AgentSettings["model_protocol"], "auto">) {
  if (protocol === "anthropic") return "填写 Anthropic 服务根地址，系统按 Messages 协议请求 /v1/messages。";
  if (protocol === "gemini") return "填写 Gemini API 版本根地址，系统按 generateContent 协议组装模型路径。";
  if (protocol === "ollama") return "填写 Ollama 服务根地址，系统会请求 /api/chat 和 /api/tags。";
  if (protocol === "responses") return "填写 Responses API 根地址；系统会在该根地址下请求 /responses。";
  return "填写 Chat Completions 的完整 API 根地址；系统不会自动添加 /v1。";
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
  const [manualModel, setManualModel] = useState(false);
  const effectiveProtocol = resolvedProtocol(settings.model_name, settings.model_protocol, settings.model_base_url);
  const effectiveProtocolLabel = protocolLabel(effectiveProtocol);
  const catalog = Array.from(new Set(availableModels.map((name) => name.trim()).filter(Boolean)));
  const remainingQuota = monitor?.usage?.remaining_quota ?? null;
  const quotaAvailable = Boolean(monitor?.usage?.quota_available && remainingQuota != null);
  const usedTokens = monitor?.usage?.total_tokens ?? monitor?.summary.total_tokens ?? 0;
  const windowHours = monitor?.usage?.window_hours ?? monitor?.window_hours ?? 24;
  function changeSettings(next: AgentSettings) {
    if (!editing) onBeginEdit();
    onSettingsChange(next);
  }
  function discoverOnBlur() {
    if (editing && !busy && (effectiveProtocol === "ollama" || settings.api_key || settings.api_key_configured)) onDiscoverModels();
  }

  return (
    <section className="model-settings-page">
      {savedSettings.secret_migration_warning ? <p className="model-settings-warning" role="alert">{savedSettings.secret_migration_warning}。旧密钥仍保留在本地数据库中，修复钥匙串后再次保存即可迁移。</p> : null}
      <section className="settings-card model-settings-card model-connection-card">
        <div className="settings-card-heading model-connection-heading">
          <span><Cpu size={18} /></span>
          <div><h3>连接你的模型</h3><p>填写服务地址和密钥，再选择要使用的模型。</p></div>
        </div>
        <label>
          <span id="model-base-url-label">Base URL</span>
          <input aria-labelledby="model-base-url-label" aria-describedby="model-base-url-help" type="url" autoComplete="off" spellCheck={false} value={settings.model_base_url} disabled={busy} placeholder={protocolBaseUrl(effectiveProtocol)} onChange={(event) => changeSettings({ ...settings, model_base_url: event.target.value })} onBlur={discoverOnBlur} />
          <small id="model-base-url-help">填写服务商提供的 API 地址，包含其要求的 /v1 等路径。</small>
        </label>
        <label>
          <span id="model-api-key-label">API Key</span>
          <input aria-labelledby="model-api-key-label" aria-describedby="model-api-key-help" type="password" autoComplete="new-password" value={settings.api_key} disabled={busy} placeholder={effectiveProtocol === "ollama" ? "本地 Ollama 可留空" : settings.api_key_configured ? "已配置，留空则继续使用" : "请输入 API Key"} onChange={(event) => changeSettings({ ...settings, api_key: event.target.value })} onBlur={discoverOnBlur} />
          <small id="model-api-key-help">{effectiveProtocol === "ollama" ? "本地 Ollama 可不填写密钥。" : settings.api_key_configured ? "已保存密钥；留空继续使用，不显示原文。" : "填写服务商提供的密钥。"}</small>
        </label>
        <div className="model-name-setting">
          <div className="model-field-heading">
            <label htmlFor="model-name-input">模型名称</label>
            <button type="button" className="model-discovery-button" disabled={busy || discoveryBusy} onClick={() => onDiscoverModels(true)}>
              <RefreshCw className={discoveryBusy ? "spinning" : ""} size={13} />
              {discoveryBusy ? "读取中…" : "刷新列表"}
            </button>
          </div>
          {catalog.length > 0 && !manualModel ? (
            <select id="model-name-input" value={settings.model_name} disabled={busy} onChange={(event) => changeSettings({ ...settings, model_name: event.target.value })}>
              {!settings.model_name && <option value="">选择模型</option>}
              {Array.from(new Set([settings.model_name, ...catalog].filter(Boolean))).map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          ) : (
            <input id="model-name-input" value={settings.model_name} disabled={busy} placeholder="输入模型名称" onChange={(event) => changeSettings({ ...settings, model_name: event.target.value })} />
          )}
          {catalog.length > 0 && <button className="model-manual-button" type="button" disabled={busy} onClick={() => setManualModel(!manualModel)}>{manualModel ? "从列表选择" : "手动填写"}</button>}
          <small className={discoveryError ? "model-discovery-error" : ""}>
            {discoveryBusy
              ? "正在读取模型列表…"
              : discoveryError
                ? "未能读取模型列表，可手动填写模型名称。"
                : catalog.length
                  ? `${catalog.length} 个模型可选择，是否可用以连接检测为准。`
                  : "可直接填写模型名称，或读取服务商的模型列表。"}
          </small>
        </div>
        <div className="model-settings-actions">
          <p role="status">{editing ? "有未保存的修改" : `当前模型：${savedSettings.model_name || "尚未配置"}`}</p>
          {editing && <ActionButton variant="secondary" disabled={busy} onClick={onCancelEdit}>取消</ActionButton>}
          <ActionButton variant="primary" disabled={busy || !editing || !settings.model_name.trim()} onClick={onSave}>
            {busy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}{busy ? "保存中…" : "保存并应用"}
          </ActionButton>
        </div>
        <p className="model-save-note">保存后从下一次对话生效。</p>
      </section>
      <details className="model-advanced-settings">
        <summary><strong>高级设置</strong><span>接口协议与连接诊断</span><ChevronDown size={16} /></summary>
        <div className="model-settings-panels">
          <section className="settings-card model-settings-card model-protocol-card">
            <label>
              <span id="model-protocol-label">接口协议</span>
              <select aria-labelledby="model-protocol-label" value={settings.model_protocol} disabled={busy} onChange={(event) => changeSettings({ ...settings, model_protocol: event.target.value as AgentSettings["model_protocol"] })}>
                <option value="auto">自动匹配（当前：{effectiveProtocolLabel}）</option>
                <option value="openai">OpenAI 兼容 Chat Completions</option>
                <option value="responses">OpenAI Responses API</option>
                <option value="anthropic">Anthropic Messages API</option>
                <option value="gemini">Google Gemini generateContent</option>
                <option value="ollama">Ollama Chat API</option>
              </select>
              <small>默认自动匹配，服务商有明确要求时再更改。</small>
              <small>{protocolBaseUrlHelp(effectiveProtocol)}</small>
            </label>
            {discoveryError && <p className="model-capability-error" role="alert">模型列表读取失败：{discoveryError}</p>}
          </section>

          <p className="model-diagnostics-note">以下诊断来自已保存的连接。{editing ? "保存修改后可重新检测。" : ""}</p>

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
              <ActionButton variant="secondary" className="model-check-button" disabled={busy || editing || capabilitiesBusy} onClick={onProbeCapabilities}>
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
          <section className="settings-card model-monitor-card">
            <div className="settings-card-heading model-monitor-heading">
              <span><Activity size={18} /></span>
              <div><h3>连接状态与调用质量</h3><p>仅统计调用结果，每 15 秒刷新；不保存你的提示词和回复内容。</p></div>
              <ActionButton variant="secondary" className="model-check-button" disabled={busy || editing || monitorBusy} onClick={onCheckService}>
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
              <article><span>当前服务</span><strong className="model-monitor-name">{monitor?.model_name || savedSettings.model_name || "—"}</strong><small>{protocolLabel(monitor?.protocol || resolvedProtocol(savedSettings.model_name, savedSettings.model_protocol, savedSettings.model_base_url))} · {monitor?.base_url || "官方默认地址"}</small></article>
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
        </div>
      </details>
    </section>
  );
}
