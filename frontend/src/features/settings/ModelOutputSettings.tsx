import { useState } from "react";
import type { ModelProfile } from "../../types";

const fields = [{ key: "chat", label: "对话输出" }, { key: "image_generation", label: "图片生成" }, { key: "video_generation", label: "视频生成" }] as const;
type Status = "supported" | "unsupported" | "unknown";
export function ModelOutputSettings({ profile, busy, onSave }: { profile: ModelProfile; busy: boolean; onSave: (capabilities: Record<string, Status>) => Promise<boolean> }) {
  const [draft, setDraft] = useState<Record<string, Status> | null>(null);
  const [message, setMessage] = useState("");
  return <section className="model-output-settings" aria-label="模型输出能力">
    <div className="model-connections-heading"><div><h4>模型输出能力</h4><p>自动识别仅供参考。图片输入与图片生成是不同能力。</p></div>{!draft ? <button type="button" disabled={busy} onClick={() => { setMessage(""); setDraft(Object.fromEntries(fields.map(field => [field.key, (profile.capabilities?.[field.key] as Status) || "unknown"]))); }}>编辑能力</button> : null}</div>
    {draft ? <><div className="model-output-fields">{fields.map(field => <label key={field.key}>{field.label}<select aria-label={`${profile.model_name} ${field.label}`} disabled={busy} value={draft[field.key]} onChange={event => setDraft({ ...draft, [field.key]: event.target.value as Status })}><option value="unknown">自动识别</option><option value="supported">支持</option><option value="unsupported">不支持</option></select></label>)}</div><div className="model-connection-actions"><button type="button" disabled={busy} onClick={async () => { if (await onSave(draft)) { setDraft(null); setMessage("模型输出能力已保存。"); } }}>保存模型能力</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>取消</button></div></> : <p>{profile.output_types?.map(type => ({ chat: "对话", image: "图片生成", video: "视频生成" })[type]).join("、") || "待确认"} · {profile.output_types_source === "configured" ? "已配置" : "自动识别"}</p>}
    <p>声明能力不会接入新的生成接口。视频生成暂未接入，图片生成需匹配已支持的接口。</p>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
