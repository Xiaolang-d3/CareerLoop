import { useEffect, useRef, useState } from "react";
import type { createApiClient } from "../../api/client";
import type { ModelCatalog } from "../../types";
import "./model-connections.css";

type Stage = "classify" | "plan" | "execute";
type Policy = { version: number; roles: Partial<Record<Stage, string | null>>; strict_capabilities: boolean };
const stages: [Stage, string, string][] = [
  ["classify", "意图识别", "识别需要完成的任务"],
  ["plan", "任务规划", "安排步骤与失败后的重规划"],
  ["execute", "执行回答", "调用工具并生成最终回答"]
];
type Props = { fetchJson: ReturnType<typeof createApiClient>; catalog: ModelCatalog; disabled?: boolean; onApplied: () => Promise<void> };

export function ModelRoutingPanel({ fetchJson, catalog, disabled = false, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const task = useRef({ id: 0, writing: false, controller: null as AbortController | null });
  useEffect(() => () => { task.current.id += 1; task.current.controller?.abort(); }, [fetchJson]);
  const profiles = catalog.profiles.filter(profile => profile.enabled
    && (!catalog.service_connection_id || profile.connection_id === catalog.service_connection_id)
    && catalog.connections.some(connection => connection.id === profile.connection_id && connection.enabled));
  const missing = Boolean(draft && Object.values(draft.roles).some(id => id && !profiles.some(profile => profile.id === id)));
  const historical = Boolean(catalog.service_connection_id && draft && Object.values(draft.roles).some(id => {
    const profile = catalog.profiles.find(item => item.id === id);
    return profile && profile.connection_id !== catalog.service_connection_id;
  }));
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));

  async function request(save: boolean) {
    if (task.current.writing || (save && (!draft || !saved || disabled))) return;
    task.current.controller?.abort();
    const controller = new AbortController();
    const id = ++task.current.id;
    task.current.controller = controller;
    task.current.writing = save;
    const current = () => task.current.id === id && !controller.signal.aborted;
    setBusy(true); setError(""); setNotice("");
    try {
      const policy = await fetchJson<Policy>("/agent/model-routing", {
        signal: controller.signal,
        ...(save ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          roles: draft!.roles, strict_capabilities: draft!.strict_capabilities, expected_version: saved!.version
        }) } : {})
      });
      if (!current()) return;
      setSaved(policy); setDraft(policy);
      if (save) {
        setNotice("阶段模型分工已保存，从新任务开始生效；正在执行的任务继续使用原配置。");
        try { await onApplied(); }
        catch { if (current()) setNotice("阶段模型分工已保存，当前模型显示尚未刷新；重新进入工作区可读取最新配置。"); }
      }
    } catch (reason) {
      if (!current()) return;
      const conflict = typeof reason === "object" && reason !== null && "status" in reason && Number(reason.status) === 409;
      setError(conflict ? "模型路由已在其他页面更新。草稿已保留，请重新读取后修改。" : save
        ? `保存结果尚未确认，请重新读取核对。${reason instanceof Error ? reason.message : ""}`
        : reason instanceof Error ? reason.message : "读取模型路由失败");
    } finally {
      if (current()) { task.current.writing = false; setBusy(false); }
    }
  }

  return <section className="settings-card model-settings-card model-connections-card model-routing-card">
    <div className="model-connections-heading"><div><h3>阶段模型分工</h3><p>按任务阶段指定模型，会话中手动选择的执行模型优先。</p></div>
      <button type="button" aria-expanded={open} disabled={busy} onClick={() => { setOpen(!open); if (!open && !saved) void request(false); }}>{open ? "收起分工" : "配置分工"}</button></div>
    {open ? <>
      {error ? <p role="alert" className="model-capability-error">{error}</p> : null}
      {notice ? <p role="status" className="model-connections-notice">{notice}</p> : null}
      {busy && !saved ? <p role="status">正在读取模型路由…</p> : null}
      {draft ? <fieldset disabled={busy || disabled} className="model-routing-fields">
        {stages.map(([stage, title, description]) => <label key={stage}><span>{title}<small>{description}</small></span>
          <select aria-label={`${title}模型`} value={draft.roles[stage] || ""} onChange={event => setDraft({ ...draft, roles: { ...draft.roles, [stage]: event.target.value || null } })}>
            <option value="">使用账号默认模型</option>
            {draft.roles[stage] && !profiles.some(profile => profile.id === draft.roles[stage]) ? <option value={draft.roles[stage]!} disabled>{catalog.profiles.find(profile => profile.id === draft.roles[stage])?.model_name || "已停用或不存在的模型"}{catalog.profiles.some(profile => profile.id === draft.roles[stage] && catalog.service_connection_id && profile.connection_id !== catalog.service_connection_id) ? "（历史服务配置）" : ""}</option> : null}
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{catalog.connections.find(connection => connection.id === profile.connection_id)?.name} / {profile.model_name}</option>)}
          </select></label>)}
        <label className="model-routing-strict"><input type="checkbox" checked={draft.strict_capabilities} onChange={event => setDraft({ ...draft, strict_capabilities: event.target.checked })} />仅使用已确认支持所需能力的模型</label>
        <p className="model-connections-hint">开启后，图片、工具或流式能力未知的模型会被阻止调用。默认允许尝试未知能力，并明确记录为未验证。</p>
      </fieldset> : null}
      {missing ? <p role="alert" className="model-capability-error">{historical ? "所选阶段模型包含历史服务配置，请更换为当前服务的模型。" : "所选阶段模型已停用或不存在，请重新选择。"}</p> : null}
      <div className="model-connection-actions"><button type="button" disabled={busy || disabled || !dirty || missing} onClick={() => void request(true)}>{busy && saved ? "正在保存…" : "保存分工"}</button>
        <button type="button" disabled={busy} onClick={() => void request(false)}>重新读取</button>
        {dirty ? <button type="button" disabled={busy} onClick={() => { setDraft(saved); setError(""); }}>取消修改</button> : null}</div>
    </> : null}
  </section>;
}
