import { useEffect, useState } from "react";
import type { createApiClient } from "../../api/client";
import type { ModelProfile, ProfileCapabilityReport, ReasoningEffort } from "../../types";
import "./model-parameters.css";

export type ModelParameterUpdate = {
  reasoning_effort: ReasoningEffort | null;
};

export type ComposerModelSettings = {
  profile: ModelProfile;
  protocol?: string;
  fetchJson: ReturnType<typeof createApiClient>;
  onSave: (profileId: string, revision: number, update: ModelParameterUpdate) => Promise<boolean>;
  error?: string;
  capabilityReport?: ProfileCapabilityReport | null;
};

export function ComposerModelParameters({ settings, disabled }: { settings: ComposerModelSettings; disabled: boolean }) {
  const { profile, fetchJson } = settings;
  const [effort, setEffort] = useState<ReasoningEffort | "">(profile.reasoning_effort ?? "");
  const [loadedReport, setReport] = useState<ProfileCapabilityReport | null>(null);
  const report = settings.capabilityReport ?? loadedReport;
  const [capabilityError, setCapabilityError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setCapabilityError(false);
    void fetchJson<ProfileCapabilityReport>(`/agent/model-profiles/${encodeURIComponent(profile.id)}/capabilities`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setReport(value?.capabilities ? value : null); })
      .catch(() => { if (!controller.signal.aborted) setCapabilityError(true); });
    return () => controller.abort();
  }, [profile.id, fetchJson]);

  const protocol = report?.protocol || settings.protocol;
  const imageOnly = protocol === "images";
  const unsupported = report?.capabilities.reasoning.status === "unsupported";
  const locked = disabled || saving || !profile.enabled || imageOnly;
  const dirty = effort !== (profile.reasoning_effort ?? "");

  async function save() {
    if (locked || !dirty) return;
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      if (await settings.onSave(profile.id, profile.revision, { reasoning_effort: effort || null })) setSaved(true);
      else setError("未能保存，请检查提示后重试。");
    } catch { setError("保存失败，请稍后重试。"); }
    finally { setSaving(false); }
  }

  return <form className="model-parameters" aria-label={`${profile.model_name} 思考设置`} onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(); }}>
    <p className="model-parameters-scope"><strong>{profile.model_name}</strong><span>应用于此模型的所有对话，下次回复生效。</span></p>
    {imageOnly ? <p className="model-parameter-help">图片模型不支持此思考设置。</p> : null}
    <fieldset disabled={locked}>
      <label><span>思考程度</span><select aria-label="思考程度" value={effort} onChange={event => { setEffort(event.target.value as ReasoningEffort | ""); setSaved(false); }}>
        <option value="">自动</option>
        <option value="low" disabled={unsupported}>轻度</option><option value="medium" disabled={unsupported}>标准</option><option value="high" disabled={unsupported}>深度</option>
      </select></label>
      <p className="model-parameter-help">{unsupported ? "此模型不支持调整思考程度，可选自动清除原设置。" : report?.capabilities.reasoning.status === "supported" ? "思考越深入，通常耗时越长。自动由模型决定。" : capabilityError ? "暂时无法确认该模型是否支持调整思考程度。" : "此模型是否支持调整思考程度尚未确认。"}</p>
    </fieldset>
    {error || settings.error ? <p className="model-menu-status model-menu-error" role="alert">{settings.error || error}</p> : null}
    <div className="model-parameters-actions"><span role="status">{saved && !dirty ? "已保存" : ""}</span><button type="submit" disabled={locked || !dirty}>{saving ? "保存中…" : "保存设置"}</button></div>
  </form>;
}
