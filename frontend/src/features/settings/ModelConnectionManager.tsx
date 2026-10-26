import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, RefreshCw } from "lucide-react";
import { ApiError, type createApiClient } from "../../api/client";
import type { ModelCatalog, ModelConnection, ModelProtocol, ModelServiceCheck, ProfileCapabilityReport } from "../../types";
import { ModelProfileCapabilities } from "./ModelProfileCapabilities";
import { connectionProtocolLabel } from "./protocolLabels";
import "./model-connections.css";
import { ModelSettingsDialog } from "./ModelSettingsDialog";
import { useComposerModelDiscovery } from "../chat/useComposerModelDiscovery";
import { ComposerModelParameters } from "../chat/ComposerModelParameters";

type Draft = { name: string; model_base_url: string; model_protocol: ModelProtocol; api_key: string; model_name: string };
const blankDraft: Draft = { name: "", model_base_url: "", model_protocol: "auto", api_key: "", model_name: "" };
const address = (value: string) => value.trim().replace(/\/+$/, "");
function keyOptional(draft: Draft) { return draft.model_protocol === "ollama" || (draft.model_protocol === "auto" && /ollama|:11434(?:\/|$)/i.test(draft.model_base_url)); }
type Props = {
  catalog: ModelCatalog; loading: boolean; busy: boolean; error: string; defaultLocked?: boolean; secretWritable?: boolean;
  fetchJson: ReturnType<typeof createApiClient>;
  onReload: () => Promise<void>;
  onMutate: (path: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) => Promise<boolean>;
  onDefaultChanged: () => Promise<void>;
  onEnsureProfile?: (connectionId: string, modelName: string, revision: number) => Promise<string | null>;
};

export function ModelConnectionManager({ catalog, loading, busy, error, defaultLocked = false, secretWritable, fetchJson, onReload, onMutate, onDefaultChanged, onEnsureProfile }: Props) {
  const [editor, setEditor] = useState<{ id: string | null; revision: number; originalAddress: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modelName, setModelName] = useState("");
  const [modelFilter, setModelFilter] = useState("");

  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticMessage, setDiagnosticMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [archiveCandidate, setArchiveCandidate] = useState<string | null>(null);
  // Set when a check/discovery says this model rejects Chat Completions.
  const [protocolSuggestion, setProtocolSuggestion] = useState<string | null>(null);
  const [recheckConnectionId, setRecheckConnectionId] = useState<string | null>(null);
  const [capabilityProfileId, setCapabilityProfileId] = useState<string | null>(null);
  const [parameterCapabilityReport, setParameterCapabilityReport] = useState<ProfileCapabilityReport | null>(null);
  const diagnosticRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const currentConnection = catalog.connections.find(item => item.id === selectedId && item.enabled) ?? null;
  const service = useComposerModelDiscovery({ fetchJson, scope: "model-settings", connection: currentConnection ?? undefined });
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const canDiscover = Boolean(currentConnection && (currentConnection.api_key_configured || keyOptional({ ...blankDraft, model_protocol: currentConnection.model_protocol, model_base_url: currentConnection.model_base_url })));
  useEffect(() => { if (canDiscover) void service.discover(); }, [service.discover, canDiscover]);
  const savedProfiles = new Map<string, ModelCatalog["profiles"][number]>();
  for (const profile of catalog.profiles.filter(item => item.connection_id === selectedId)) {
    const previous = savedProfiles.get(profile.model_name);
    if (!previous || profile.id === catalog.default_profile_id || (profile.enabled && !previous.enabled && previous.id !== catalog.default_profile_id)) savedProfiles.set(profile.model_name, profile);
  }
  async function openModelSettings(name: string) {
    if (!currentConnection || busy) return;
    const id = currentConnection.id;
    const profile = savedProfiles.get(name);
    const profileId = profile?.id ?? await onEnsureProfile?.(id, name, currentConnection.revision);
    if (profileId && selectedRef.current === id) {
      setNotice(""); setParameterCapabilityReport(null); setCapabilityProfileId(profileId);
    }
  }
  async function useModel(name: string) {
    if (!currentConnection || busy || defaultLocked) return;
    const connectionId = currentConnection.id;
    const profile = savedProfiles.get(name);
    if (profile && !profile.enabled) { setNotice("此模型已停用，请在设置中启用后再选择。"); return; }
    const profileId = profile?.id ?? await onEnsureProfile?.(connectionId, name, currentConnection.revision);
    if (profileId && selectedRef.current === connectionId) await setDefault(profileId);
  }
  const defaultProfile = catalog.profiles.find(item => item.id === catalog.default_profile_id);
  const defaultConnectionId = defaultProfile?.connection_id;
  useEffect(() => { setEditor(null); setDraft({ ...blankDraft }); setSelectedId(null); setNotice(""); setCapabilityProfileId(null); }, [fetchJson]);
  useEffect(() => {
    diagnosticRef.current.id += 1;
    diagnosticRef.current.controller?.abort();
    setDiagnosticMessage(""); setDiagnosticBusy(false); setProtocolSuggestion(null);
    return () => { diagnosticRef.current.id += 1; diagnosticRef.current.controller?.abort(); };
  }, [selectedId, currentConnection?.revision, fetchJson]);
  useEffect(() => {
    // Re-run the check once the switched connection revision has arrived.
    if (!recheckConnectionId || busy || currentConnection?.id !== recheckConnectionId || currentConnection.model_protocol !== "responses") return;
    setRecheckConnectionId(null);
    void diagnose("check");
  }, [recheckConnectionId, busy, currentConnection?.id, currentConnection?.revision, currentConnection?.model_protocol]);

  function closeEditor() { setEditor(null); setDraft({ ...blankDraft }); }
  function editConnection(connection?: ModelConnection) {
    setNotice("");
    setEditor({ id: connection?.id ?? null, revision: connection?.revision ?? 0, originalAddress: connection?.model_base_url ?? "" });
    setDraft(connection ? { ...blankDraft, name: connection.name, model_base_url: connection.model_base_url, model_protocol: connection.model_protocol } : { ...blankDraft });
  }
  async function saveConnection() {
    if (!editor || busy) return;
    const existing = catalog.connections.find(item => item.id === editor.id);
    const changedAddress = address(draft.model_base_url) !== address(editor.originalAddress);
    if (!keyOptional(draft) && !draft.api_key.trim() && (!existing?.api_key_configured || changedAddress)) return;
    const body = editor.id ? { name: draft.name, model_base_url: draft.model_base_url, model_protocol: draft.model_protocol, api_key: draft.api_key, expected_revision: editor.revision }
      : { ...draft, model_name: draft.model_name.trim() || undefined };
    // Keep credentials only while editing. Every submission attempt clears the input.
    setDraft(current => ({ ...current, api_key: "" }));
    const success = await onMutate(editor.id ? `/agent/model-connections/${encodeURIComponent(editor.id)}` : "/agent/model-connections", editor.id ? "PATCH" : "POST", body);
    if (success) { closeEditor(); setNotice("连接已保存。展开此连接即可读取服务模型，聊天与生图共用此连接。"); }
    else setNotice("连接未确认保存，密钥输入已清除；请检查结果后重新填写。 ");
  }
  async function setDefault(profileId: string) {
    if (defaultLocked || busy) return;
    if (await onMutate("/agent/model-default", "POST", { profile_id: profileId })) {
      await onDefaultChanged();
      setNotice("默认模型已更新，从下一次对话生效。");
    }
  }
  async function addModel() {
    if (!currentConnection || !modelName.trim() || busy) return;
    if (await onMutate("/agent/model-profiles", "POST", { connection_id: currentConnection.id, model_name: modelName.trim() })) {
      setModelName(""); setNotice("模型已添加，可以设为默认或在对话中选择。");
    }
  }
  async function switchToResponses() {
    if (!currentConnection || busy) return;
    const connectionId = currentConnection.id;
    if (await onMutate(`/agent/model-connections/${encodeURIComponent(connectionId)}`, "PATCH", { model_protocol: "responses", expected_revision: currentConnection.revision })) {
      setProtocolSuggestion(null);
      setNotice("已改用 OpenAI Responses API，正在重新检测此连接…");
      setRecheckConnectionId(connectionId);
    }
  }
  async function diagnose(kind: "discover" | "check") {
    if (!currentConnection || busy || diagnosticBusy) return;
    if (kind === "discover") { void service.discover(true); return; }
    diagnosticRef.current.controller?.abort();
    const id = ++diagnosticRef.current.id;
    const controller = new AbortController(); diagnosticRef.current.controller = controller;
    const connectionId = currentConnection.id;
    setDiagnosticBusy(true); setDiagnosticMessage(""); setProtocolSuggestion(null);
    const current = () => diagnosticRef.current.id === id && !controller.signal.aborted;
    try {
      const result = await fetchJson<Pick<ModelServiceCheck, "available" | "check_error_message" | "suggested_protocol"> & { check_scope?: string }>(`/agent/model-connections/${encodeURIComponent(connectionId)}/check`, { method: "POST", signal: controller.signal });
      if (current()) {
        setDiagnosticMessage(result.available ? result.check_scope === "catalog" ? "模型目录检测成功；选择模型后可检查实际调用。" : "连接检测成功。" : result.check_error_message || "连接检测未通过。");
        if (!result.available && result.suggested_protocol === "responses") setProtocolSuggestion(connectionId);
      }
    } catch (reason) {
      if (current()) {
        setDiagnosticMessage(reason instanceof Error ? reason.message : "读取连接诊断失败，可手动添加模型。");
        if (reason instanceof ApiError && reason.details?.suggested_protocol === "responses") setProtocolSuggestion(connectionId);
      }
    }
    finally { if (current()) setDiagnosticBusy(false); }
  }
  const parameterProfile = catalog.profiles.find(profile => profile.id === capabilityProfileId);
  const parameterConnection = catalog.connections.find(connection => connection.id === parameterProfile?.connection_id);
  const existingEditor = catalog.connections.find(item => item.id === editor?.id);
  const needsKey = !keyOptional(draft) && !draft.api_key.trim() && (!existingEditor?.api_key_configured || address(draft.model_base_url) !== address(editor?.originalAddress ?? ""));

  return <section className="settings-card model-settings-card model-connections-card" aria-labelledby="model-connections-title">
    <div className="model-connections-heading"><div><h3 id="model-connections-title">连接与模型</h3><p>展开连接读取服务模型，聊天与生图共用此连接。</p></div><button className="model-connections-add" type="button" disabled={busy} onClick={() => editConnection()}><Plus size={14} />添加连接</button></div>
    {error ? <p className="model-capability-error" role="alert">{error}<button type="button" disabled={busy || loading} onClick={() => void onReload()}>重新读取</button></p> : null}
    {notice && !editor && !parameterProfile ? <p className="model-connections-notice" role="status">{notice}</p> : null}
    {defaultLocked ? <p className="model-connections-hint">默认配置有未保存的修改，保存或取消后可切换默认模型。</p> : null}
    {loading && !catalog.connections.length ? <p role="status">正在读取连接…</p> : null}
    {!loading && !catalog.connections.some(item => item.enabled) ? <p className="model-connections-hint">还没有连接，添加服务地址和密钥后读取模型列表。</p> : null}
    <div className="model-connection-list">{catalog.connections.filter(item => item.enabled).map(connection => <article key={connection.id} className={selectedId === connection.id ? "selected" : ""}>
      <div className="model-connection-head">
      <button className="model-connection-select" type="button" aria-expanded={selectedId === connection.id} onClick={() => { setSelectedId(current => current === connection.id ? null : connection.id); setModelName(""); setModelFilter(""); setArchiveCandidate(null); setCapabilityProfileId(null); }}><strong>{connection.name || connection.model_base_url || "默认服务"}<ChevronDown size={14} aria-hidden="true" /></strong><small>{connection.model_base_url || "官方默认地址"} · {connection.api_key_configured ? "密钥已配置" : "未配置密钥"}{defaultConnectionId === connection.id ? " · 默认连接" : ""}</small><small>{selectedId === connection.id ? service.busy ? "正在读取服务模型…" : service.models.length ? `服务返回 ${service.models.length} 个模型` : "展开后读取服务模型" : "展开后读取服务模型"}</small></button>
      <div className="model-connection-actions"><button type="button" disabled={busy} onClick={() => editConnection(connection)}>编辑连接</button></div>
      </div>
      {archiveCandidate === connection.id ? <div className="model-archive-confirm"><span>停用后，该连接的模型将无法用于新对话。</span><button type="button" disabled={busy} onClick={async () => { if (await onMutate(`/agent/model-connections/${encodeURIComponent(connection.id)}`, "DELETE")) { setArchiveCandidate(null); if (selectedId === connection.id) setSelectedId(null); } }}>确认停用</button><button type="button" disabled={busy} onClick={() => setArchiveCandidate(null)}>取消</button></div> : null}
      {selectedId === connection.id ? <>
        {service.models.length > 8 ? <input type="search" aria-label="搜索服务模型" placeholder="搜索服务返回的模型…" value={modelFilter} onChange={event => setModelFilter(event.target.value)} /> : null}
        <div className="model-profile-list service-model-list">{service.models.filter(name => name.toLowerCase().includes(modelFilter.trim().toLowerCase())).map(name => {
          const profile = savedProfiles.get(name);
          return <div key={name} className={profile?.id === catalog.default_profile_id ? "model-profile-row is-default" : "model-profile-row"}>
            <span><strong>{name}</strong>{profile?.id === catalog.default_profile_id ? <small>新对话使用</small> : profile && !profile.enabled ? <small>已停用</small> : /^gpt-image-/i.test(name) ? <small>图片模型 · 复用此连接</small> : null}</span>
            <div>{profile?.id !== catalog.default_profile_id ? <button type="button" aria-label={`${name} 用于新对话`} disabled={busy || defaultLocked || (!profile && !onEnsureProfile)} onClick={() => void useModel(name)}>使用</button> : null}<button type="button" aria-label={`${name} 设置`} disabled={busy} onClick={() => void openModelSettings(name)}>设置</button></div>
          </div>;
        })}</div>
        {service.busy ? <p role="status" className="model-connections-hint">正在读取服务模型…</p> : service.error ? <p role="alert" className="model-capability-error">{service.error}</p> : !service.models.length ? <p className="model-connections-hint">{canDiscover ? "服务尚未返回模型，可刷新列表或手动填写。" : "请先编辑此连接并配置密钥，再读取模型列表。"}</p> : null}

        <details className="model-connection-more"><summary>连接选项</summary><p className="model-connections-hint">接口协议：{connectionProtocolLabel(connection.model_protocol, connection.detected_protocol)}</p><button type="button" disabled={busy || connection.id === defaultConnectionId} onClick={() => setArchiveCandidate(connection.id)}>停用连接</button></details>
      </> : null}
    </article>)}</div>
    {currentConnection ? <div className="model-add-profile">
      <div className="model-connection-actions"><button type="button" disabled={busy || service.busy || !canDiscover} onClick={() => void diagnose("discover")}><RefreshCw size={13} />读取模型列表</button><button type="button" disabled={busy || diagnosticBusy || !canDiscover} onClick={() => void diagnose("check")}>检测此连接</button></div>
      {service.models.length > 0 ? <p role="status">已读取 {service.models.length} 个模型，列表以服务返回为准；仅选用或保存参数时记录配置。</p> : null}
      {diagnosticMessage ? <p role="status">{diagnosticMessage}</p> : null}
      {(protocolSuggestion === currentConnection.id || service.suggestedProtocol === "responses") ? <div className="model-protocol-suggestion" role="alert"><span>该模型不支持 Chat Completions，改用 OpenAI Responses API</span><button type="button" disabled={busy || diagnosticBusy} onClick={() => void switchToResponses()}>改用 Responses 并重新检测</button></div> : null}
      <details><summary>服务未提供目录时手动填写</summary><label htmlFor="additional-model-name">为 {currentConnection.name || "此连接"} 添加模型</label><div className="model-connection-actions"><input id="additional-model-name" placeholder="输入服务商提供的模型名称" value={modelName} disabled={busy} onChange={event => setModelName(event.target.value)} /><button type="button" disabled={busy || !modelName.trim()} onClick={() => void addModel()}>添加模型</button></div></details>
      {[...savedProfiles.values()].some(profile => !service.models.includes(profile.model_name)) ? <details><summary>已保存的历史配置</summary><p className="model-connections-hint">以下配置不代表服务当前可用的模型，仅供已有对话和参数管理。</p>{[...savedProfiles.values()].filter(profile => !service.models.includes(profile.model_name)).map(profile => <button type="button" key={profile.id} aria-label={`${profile.model_name} 历史配置`} onClick={() => setCapabilityProfileId(profile.id)}>{profile.model_name}</button>)}</details> : null}
    </div> : null}
    {parameterProfile ? <ModelSettingsDialog title={`${parameterProfile.model_name} 设置`} locked={busy} onClose={() => setCapabilityProfileId(null)}>
      <ComposerModelParameters key={`${parameterProfile.id}:${parameterProfile.revision}`} disabled={busy} settings={{ profile: parameterProfile, protocol: parameterConnection?.detected_protocol || parameterConnection?.model_protocol, fetchJson, error, capabilityReport: parameterCapabilityReport,
        onSave: async (id, revision, update) => {
          const saved = await onMutate(`/agent/model-profiles/${encodeURIComponent(id)}`, "PATCH", { ...update, expected_revision: revision });
          if (saved) setNotice("思考设置已保存，所有使用此模型的对话从后续请求生效。");
          return saved;
        }
      }} />
      {notice ? <p className="model-connections-notice" role="status">{notice}</p> : null}
      <details className="model-profile-advanced"><summary>更多选项</summary>
        <div className="model-connection-actions"><button type="button" disabled={busy || defaultLocked || !parameterProfile.enabled || parameterProfile.id === catalog.default_profile_id} onClick={() => void setDefault(parameterProfile.id)}>设为默认</button><button type="button" disabled={busy || parameterProfile.id === catalog.default_profile_id} onClick={() => void onMutate(`/agent/model-profiles/${encodeURIComponent(parameterProfile.id)}`, "PATCH", { enabled: !parameterProfile.enabled, expected_revision: parameterProfile.revision })}>{parameterProfile.enabled ? "停用模型" : "启用模型"}</button></div>
        <ModelProfileCapabilities profileId={parameterProfile.id} modelName={parameterProfile.model_name} fetchJson={fetchJson} disabled={busy} onReport={setParameterCapabilityReport} />
      </details>
    </ModelSettingsDialog> : null}
    {editor ? <ModelSettingsDialog title={editor.id ? "编辑连接" : "添加连接"} locked={busy} onClose={closeEditor}><div className="model-connections-card model-settings-card">{notice && <p role="status" className="model-connections-notice">{notice}</p>}{error && <p role="alert" className="model-capability-error">{error}</p>}<form className="model-connection-editor" onSubmit={event => { event.preventDefault(); void saveConnection(); }}>
      <label>连接名称（可选）<input value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="如工作模型、本地模型" /></label>
      <label>连接 Base URL<input type="url" autoComplete="off" value={draft.model_base_url} disabled={busy} onChange={event => setDraft({ ...draft, model_base_url: event.target.value, api_key: "" })} placeholder="服务商提供的 API 根地址" /></label>
      <label>连接 API Key<input type="password" autoComplete="new-password" value={draft.api_key} disabled={busy || secretWritable === false} onChange={event => setDraft({ ...draft, api_key: event.target.value })} placeholder={existingEditor?.api_key_configured && !needsKey ? "留空继续使用此连接的密钥" : keyOptional(draft) ? "本地 Ollama 可留空" : "请输入此连接的密钥"} /><small>{address(draft.model_base_url) !== address(editor.originalAddress) && editor.id ? "地址已更改，请填写新地址的密钥；不会复用原连接密钥。" : "密钥不会显示原文，提交或取消后清空输入。"}</small></label>
      {!editor.id ? <label>模型名称（可选）<input value={draft.model_name} disabled={busy} onChange={event => setDraft({ ...draft, model_name: event.target.value })} placeholder="留空，保存连接后从服务读取" /></label> : null}
      <details><summary>接口协议<ChevronDown size={13} /></summary><select aria-label="连接接口协议" value={draft.model_protocol} disabled={busy} onChange={event => setDraft({ ...draft, model_protocol: event.target.value as ModelProtocol })}>{["auto", "openai", "responses", "images", "anthropic", "gemini", "ollama"].map(value => <option key={value} value={value}>{({ auto: "自动匹配", openai: "OpenAI 兼容", responses: "OpenAI Responses", images: "OpenAI Images（文生图）", anthropic: "Anthropic", gemini: "Gemini", ollama: "Ollama" } as Record<string, string>)[value]}</option>)}</select></details>
      {(draft.model_protocol === "images" || /^gpt-image-/i.test(draft.model_name.trim())) && <p className="model-connections-hint">图片模型共用此连接的服务地址、API Key 和模型目录；请确认该密钥具备生图权限，检测不会生成图片。</p>}
      {secretWritable === false && needsKey ? <p className="model-connections-hint">当前密钥存储不可写，恢复后才能新增密钥连接。</p> : null}
      <div className="model-connection-actions"><button type="button" disabled={busy} onClick={closeEditor}>取消编辑</button><button type="submit" disabled={busy || needsKey || (secretWritable === false && Boolean(draft.api_key.trim()))}>{busy ? "提交中…" : "保存连接"}</button></div>
    </form></div></ModelSettingsDialog> : null}
  </section>;
}
