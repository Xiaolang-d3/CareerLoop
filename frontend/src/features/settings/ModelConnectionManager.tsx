import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, RefreshCw } from "lucide-react";
import type { createApiClient } from "../../api/client";
import type { ModelCatalog, ModelConnection, ModelProtocol } from "../../types";
import "./model-connections.css";

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
};

export function ModelConnectionManager({ catalog, loading, busy, error, defaultLocked = false, secretWritable, fetchJson, onReload, onMutate, onDefaultChanged }: Props) {
  const [editor, setEditor] = useState<{ id: string | null; revision: number; originalAddress: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modelName, setModelName] = useState("");
  const [catalogModels, setCatalogModels] = useState<string[]>([]);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticMessage, setDiagnosticMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [archiveCandidate, setArchiveCandidate] = useState<string | null>(null);
  const diagnosticRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const currentConnection = catalog.connections.find(item => item.id === selectedId && item.enabled) ?? null;
  const defaultProfile = catalog.profiles.find(item => item.id === catalog.default_profile_id);
  const defaultConnectionId = defaultProfile?.connection_id;
  useEffect(() => { setEditor(null); setDraft({ ...blankDraft }); setSelectedId(null); setNotice(""); }, [fetchJson]);
  useEffect(() => {
    diagnosticRef.current.id += 1;
    diagnosticRef.current.controller?.abort();
    setCatalogModels([]); setDiagnosticMessage(""); setDiagnosticBusy(false);
    return () => { diagnosticRef.current.id += 1; diagnosticRef.current.controller?.abort(); };
  }, [selectedId, currentConnection?.revision, fetchJson]);

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
      : { ...draft };
    // Keep credentials only while editing. Every submission attempt clears the input.
    setDraft(current => ({ ...current, api_key: "" }));
    const success = await onMutate(editor.id ? `/agent/model-connections/${encodeURIComponent(editor.id)}` : "/agent/model-connections", editor.id ? "PATCH" : "POST", body);
    if (success) { closeEditor(); setNotice("连接已保存。选择该连接可添加模型或查看诊断。"); }
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
  async function diagnose(kind: "discover" | "check") {
    if (!currentConnection || busy || diagnosticBusy) return;
    diagnosticRef.current.controller?.abort();
    const id = ++diagnosticRef.current.id;
    const controller = new AbortController(); diagnosticRef.current.controller = controller;
    const connectionId = currentConnection.id;
    setDiagnosticBusy(true); setDiagnosticMessage("");
    const current = () => diagnosticRef.current.id === id && !controller.signal.aborted;
    try {
      if (kind === "discover") {
        const result = await fetchJson<{ models: string[] }>(`/agent/model-connections/${encodeURIComponent(connectionId)}/discover`, { method: "POST", signal: controller.signal });
        if (current()) { setCatalogModels(Array.from(new Set(result.models))); setDiagnosticMessage(`已读取 ${result.models.length} 个模型，是否可用以实际调用为准。`); }
      } else {
        const result = await fetchJson<{ available: boolean; check_error_message?: string | null }>(`/agent/model-connections/${encodeURIComponent(connectionId)}/check`, { method: "POST", signal: controller.signal });
        if (current()) setDiagnosticMessage(result.available ? "连接检测成功。" : result.check_error_message || "连接检测未通过。");
      }
    } catch (reason) { if (current()) setDiagnosticMessage(reason instanceof Error ? reason.message : "读取连接诊断失败，可手动添加模型。"); }
    finally { if (current()) setDiagnosticBusy(false); }
  }
  const existingEditor = catalog.connections.find(item => item.id === editor?.id);
  const needsKey = !keyOptional(draft) && !draft.api_key.trim() && (!existingEditor?.api_key_configured || address(draft.model_base_url) !== address(editor?.originalAddress ?? ""));

  return <section className="settings-card model-settings-card model-connections-card" aria-labelledby="model-connections-title">
    <div className="model-connections-heading"><div><h3 id="model-connections-title">连接与模型</h3><p>保存多个服务连接，在模块内管理模型；每个连接独立保管密钥。</p></div><button type="button" disabled={busy} onClick={() => editConnection()}><Plus size={14} />添加连接</button></div>
    {error ? <p className="model-capability-error" role="alert">{error}<button type="button" disabled={busy || loading} onClick={() => void onReload()}>重新读取</button></p> : null}
    {notice ? <p className="model-connections-notice" role="status">{notice}</p> : null}
    {defaultLocked ? <p className="model-connections-hint">默认配置有未保存的修改，保存或取消后可切换默认模型。</p> : null}
    {loading && !catalog.connections.length ? <p role="status">正在读取连接…</p> : null}
    {!loading && !catalog.connections.some(item => item.enabled) ? <p className="model-connections-hint">还没有可管理的连接，添加服务地址、密钥和首个模型即可。</p> : null}
    <div className="model-connection-list">{catalog.connections.filter(item => item.enabled).map(connection => <article key={connection.id} className={selectedId === connection.id ? "selected" : ""}>
      <button className="model-connection-select" type="button" aria-pressed={selectedId === connection.id} onClick={() => { setSelectedId(connection.id); setModelName(""); setArchiveCandidate(null); }}><strong>{connection.name || connection.model_base_url || "默认服务"}</strong><small>{connection.model_base_url || "官方默认地址"} · {connection.api_key_configured ? "密钥已配置" : "未配置密钥"}{defaultConnectionId === connection.id ? " · 默认连接" : ""}</small></button>
      <div className="model-connection-actions"><button type="button" disabled={busy} onClick={() => editConnection(connection)}>编辑连接</button><button type="button" disabled={busy || connection.id === defaultConnectionId} onClick={() => setArchiveCandidate(connection.id)}>停用连接</button></div>
      {archiveCandidate === connection.id ? <div className="model-archive-confirm"><span>停用后，该连接的模型将无法用于新对话。</span><button type="button" disabled={busy} onClick={async () => { if (await onMutate(`/agent/model-connections/${encodeURIComponent(connection.id)}`, "DELETE")) { setArchiveCandidate(null); if (selectedId === connection.id) setSelectedId(null); } }}>确认停用</button><button type="button" disabled={busy} onClick={() => setArchiveCandidate(null)}>取消</button></div> : null}
      <div className="model-profile-list">{catalog.profiles.filter(profile => profile.connection_id === connection.id).map(profile => <div key={profile.id}><span><strong>{profile.model_name}</strong><small>{profile.id === catalog.default_profile_id ? "默认模型" : profile.enabled ? "可选择" : "已停用"}</small></span><div><button type="button" disabled={busy || defaultLocked || !profile.enabled || profile.id === catalog.default_profile_id} onClick={() => void setDefault(profile.id)}>设为默认</button><button type="button" disabled={busy || profile.id === catalog.default_profile_id} onClick={() => void onMutate(`/agent/model-profiles/${encodeURIComponent(profile.id)}`, "PATCH", { enabled: !profile.enabled, expected_revision: profile.revision })}>{profile.enabled ? "停用模型" : "启用模型"}</button></div></div>)}</div>
    </article>)}</div>
    {currentConnection ? <div className="model-add-profile"><label htmlFor="additional-model-name">为 {currentConnection.name || "此连接"} 添加模型</label><div><input id="additional-model-name" list="connection-model-suggestions" placeholder="输入模型名称" value={modelName} disabled={busy} onChange={event => setModelName(event.target.value)} /><datalist id="connection-model-suggestions">{catalogModels.map(model => <option key={model} value={model} />)}</datalist><button type="button" disabled={busy || !modelName.trim()} onClick={() => void addModel()}>添加模型</button></div><div className="model-connection-actions"><button type="button" disabled={busy || diagnosticBusy} onClick={() => void diagnose("discover")}><RefreshCw size={13} />读取模型列表</button><button type="button" disabled={busy || diagnosticBusy} onClick={() => void diagnose("check")}>检测此连接</button></div>{diagnosticMessage ? <p role="status">{diagnosticMessage}</p> : null}</div> : null}
    {editor ? <form className="model-connection-editor" onSubmit={event => { event.preventDefault(); void saveConnection(); }}>
      <h4>{editor.id ? "编辑连接" : "添加连接"}</h4>
      <label>连接名称（可选）<input value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="如工作模型、本地模型" /></label>
      <label>连接 Base URL<input type="url" autoComplete="off" value={draft.model_base_url} disabled={busy} onChange={event => setDraft({ ...draft, model_base_url: event.target.value, api_key: "" })} placeholder="服务商提供的 API 根地址" /></label>
      <label>连接 API Key<input type="password" autoComplete="new-password" value={draft.api_key} disabled={busy || secretWritable === false} onChange={event => setDraft({ ...draft, api_key: event.target.value })} placeholder={existingEditor?.api_key_configured && !needsKey ? "留空继续使用此连接的密钥" : keyOptional(draft) ? "本地 Ollama 可留空" : "请输入此连接的密钥"} /><small>{address(draft.model_base_url) !== address(editor.originalAddress) && editor.id ? "地址已更改，请填写新地址的密钥；不会复用原连接密钥。" : "密钥不会显示原文，提交或取消后清空输入。"}</small></label>
      {!editor.id ? <label>首个模型名称<input value={draft.model_name} disabled={busy} onChange={event => setDraft({ ...draft, model_name: event.target.value })} placeholder="如服务商提供的对话模型 ID" /></label> : null}
      <details><summary>接口协议<ChevronDown size={13} /></summary><select aria-label="连接接口协议" value={draft.model_protocol} disabled={busy} onChange={event => setDraft({ ...draft, model_protocol: event.target.value as ModelProtocol })}>{["auto", "openai", "responses", "anthropic", "gemini", "ollama"].map(value => <option key={value} value={value}>{({ auto: "自动匹配", openai: "OpenAI 兼容", responses: "OpenAI Responses", anthropic: "Anthropic", gemini: "Gemini", ollama: "Ollama" } as Record<string, string>)[value]}</option>)}</select></details>
      {secretWritable === false && needsKey ? <p className="model-connections-hint">当前密钥存储不可写，恢复后才能新增密钥连接。</p> : null}
      <div className="model-connection-actions"><button type="button" disabled={busy} onClick={closeEditor}>取消编辑</button><button type="submit" disabled={busy || needsKey || (!editor.id && !draft.model_name.trim()) || (secretWritable === false && Boolean(draft.api_key.trim()))}>{busy ? "提交中…" : "保存连接"}</button></div>
    </form> : null}
  </section>;
}
