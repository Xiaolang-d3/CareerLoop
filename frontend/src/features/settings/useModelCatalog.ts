import { useEffect, useMemo, useRef, useState } from "react";
import type { createApiClient } from "../../api/client";
import type { ModelCatalog } from "../../types";

type Client = ReturnType<typeof createApiClient>;
function publicCatalog(catalog: ModelCatalog): ModelCatalog {
  return {
    connections: catalog.connections.map(({ id, name, model_base_url, model_protocol, detected_protocol, protocol_label, api_key_configured, enabled, revision }) => ({ id, name, model_base_url, model_protocol, detected_protocol, protocol_label, api_key_configured, enabled, revision })),
    profiles: catalog.profiles.map(({ id, connection_id, model_name, enabled, revision, parameters, capabilities, context_limit, reasoning_effort }) => ({ id, connection_id, model_name, enabled, revision, parameters, capabilities, context_limit, reasoning_effort })),
    default_profile_id: catalog.default_profile_id
  };
}
const emptyCatalog: ModelCatalog = { connections: [], profiles: [], default_profile_id: null };

export function useModelCatalog({ fetchJson, scope, enabled, refreshKey }: { fetchJson: Client; scope: unknown; enabled: boolean; refreshKey?: number }) {
  const owner = useMemo(() => ({ active: true, epoch: 0, requestId: 0, writing: false, controllers: new Set<AbortController>() }), [fetchJson, scope]);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [snapshot, setSnapshot] = useState<{ owner: typeof owner; catalog: ModelCatalog } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function request() {
    const epoch = owner.epoch;
    const id = ++owner.requestId;
    const controller = new AbortController();
    owner.controllers.add(controller);
    return { signal: controller.signal, current: () => owner.active && ownerRef.current === owner && owner.epoch === epoch && owner.requestId === id && !controller.signal.aborted,
      finish: () => owner.controllers.delete(controller) };
  }
  function invalidate() {
    owner.epoch += 1;
    for (const controller of owner.controllers) controller.abort();
    owner.controllers.clear();
  }
  async function reload() {
    if (!enabled || owner.writing) return;
    const task = request();
    setLoading(true);
    setError("");
    try {
      const catalog = await fetchJson<ModelCatalog>("/agent/model-connections", { signal: task.signal });
      if (task.current()) setSnapshot({ owner, catalog: publicCatalog(catalog) });
    } catch (reason) {
      if (task.current()) setError(reason instanceof Error ? reason.message : "读取模型连接失败");
    } finally {
      if (task.current()) setLoading(false);
      task.finish();
    }
  }
  async function mutate(path: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
    if (!owner.active || ownerRef.current !== owner || owner.writing) return false;
    owner.writing = true;
    invalidate();
    const task = request();
    setBusy(true);
    setLoading(false);
    setError("");
    try {
      const catalog = await fetchJson<ModelCatalog>(path, { method, signal: task.signal, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!task.current()) return false;
      setSnapshot({ owner, catalog: publicCatalog(catalog) });
      return true;
    } catch (reason) {
      if (!task.current()) return false;
      const conflict = typeof reason === "object" && reason !== null && "status" in reason && Number(reason.status) === 409;
      setError(conflict ? "此连接已更新，正在读取最新版本；请检查后重新编辑。" : reason instanceof Error ? reason.message : "更新模型连接失败");
      if (conflict) {
        try {
          const catalog = await fetchJson<ModelCatalog>("/agent/model-connections", { signal: task.signal });
          if (task.current()) setSnapshot({ owner, catalog: publicCatalog(catalog) });
        } catch { /* Retain the visible conflict until a later reload succeeds. */ }
      }
      return false;
    } finally {
      if (task.current()) { owner.writing = false; setBusy(false); }
      task.finish();
    }
  }

  useEffect(() => {
    owner.active = true;
    setBusy(false);
    setLoading(false);
    setError("");
    if (enabled) void reload();
    return () => { owner.active = false; owner.writing = false; invalidate(); };
  }, [owner, enabled, refreshKey]);

  return { catalog: snapshot?.owner === owner ? snapshot.catalog : emptyCatalog, loading, busy, error, reload, mutate };
}
