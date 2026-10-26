import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type createApiClient } from "../../api/client";
import type { ModelConnection } from "../../types";

/** Service catalogs are scoped to saved connection revisions and never contain credentials. */
export function useComposerModelDiscovery({ fetchJson, scope, connection }: {
  fetchJson: ReturnType<typeof createApiClient>; scope: unknown; connection?: ModelConnection;
}) {
  const owner = useMemo(() => ({ active: true, request: 0, controller: null as AbortController | null }), [fetchJson, scope, connection?.id, connection?.revision]);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [snapshot, setSnapshot] = useState<{ owner: typeof owner; models: string[]; busy: boolean; error: string; suggestedProtocol?: "responses" } | null>(null);

  useEffect(() => {
    owner.active = true;
    return () => { owner.active = false; owner.controller?.abort(); };
  }, [owner]);

  const discover = useCallback(async (refresh = false) => {
    if (!connection?.enabled || !owner.active || ownerRef.current !== owner) return;
    if (!refresh && owner.controller) return;
    owner.controller?.abort();
    const controller = new AbortController();
    owner.controller = controller;
    const request = ++owner.request;
    const current = () => owner.active && ownerRef.current === owner && owner.request === request && !controller.signal.aborted;
    setSnapshot(previous => ({ owner, models: previous?.owner === owner ? previous.models : [], busy: true, error: "" }));
    try {
      const result = await fetchJson<{ models: string[] }>(`/agent/model-connections/${encodeURIComponent(connection.id)}/discover`, { method: "POST", signal: controller.signal });
      if (current()) setSnapshot({ owner, models: Array.from(new Set(result.models.filter((name): name is string => typeof name === "string").map(name => name.trim()).filter(name => name && name.length <= 120))), busy: false, error: "" });
    } catch (reason) {
      if (current()) setSnapshot(previous => ({ owner, models: previous?.owner === owner ? previous.models : [], busy: false, error: reason instanceof Error ? reason.message : "读取服务模型失败", suggestedProtocol: reason instanceof ApiError && reason.details?.suggested_protocol === "responses" ? "responses" : undefined }));
    } finally { if (owner.controller === controller) owner.controller = null; }
  }, [connection?.id, connection?.enabled, owner, fetchJson]);

  const state = snapshot?.owner === owner ? snapshot : null;
  return { models: state?.models ?? [], busy: state?.busy ?? false, error: state?.error ?? "", suggestedProtocol: state?.suggestedProtocol, discover };
}
