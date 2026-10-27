import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type createApiClient } from "../../api/client";
import type { ModelConnection } from "../../types";
import type { ServiceModelCatalog } from "./types";

type DiscoveryState = { models: string[]; busy: boolean; error: string; suggestedProtocol?: "responses" };

/** Service catalogs are scoped to saved connection revisions and never contain credentials. */
export function useComposerModelDiscovery({ fetchJson, scope, connection, connections }: {
  fetchJson: ReturnType<typeof createApiClient>; scope: unknown; connection?: ModelConnection; connections?: ModelConnection[];
}) {
  const targets = connections ?? (connection ? [connection] : []);
  const signature = JSON.stringify(targets.map(item => [item.id, item.revision, item.enabled, item.name]));
  const owner = useMemo(() => ({ active: true, request: 0, controller: null as AbortController | null, connections: targets.filter(item => item.enabled) }), [fetchJson, scope, signature]);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [snapshot, setSnapshot] = useState<{ owner: typeof owner; catalogs: Record<string, DiscoveryState> } | null>(null);

  useEffect(() => {
    owner.active = true;
    return () => { owner.active = false; owner.controller?.abort(); };
  }, [owner]);

  const discover = useCallback(async (refresh = false) => {
    if (!owner.connections.length || !owner.active || ownerRef.current !== owner) return;
    if (!refresh && owner.controller) return;
    owner.controller?.abort();
    const controller = new AbortController();
    owner.controller = controller;
    const request = ++owner.request;
    const current = () => owner.active && ownerRef.current === owner && owner.request === request && !controller.signal.aborted;
    setSnapshot(previous => ({ owner, catalogs: Object.fromEntries(owner.connections.map(item => [item.id, {
      models: previous?.owner === owner ? previous.catalogs[item.id]?.models ?? [] : [], busy: true, error: ""
    }])) }));
    try {
      await Promise.all(owner.connections.map(async item => {
        try {
          const result = await fetchJson<{ models: string[] }>(`/agent/model-connections/${encodeURIComponent(item.id)}/discover`, { method: "POST", signal: controller.signal });
          const models = Array.from(new Set(result.models.filter((name): name is string => typeof name === "string").map(name => name.trim()).filter(name => name && name.length <= 120)));
          if (current()) setSnapshot(previous => ({ owner, catalogs: { ...previous?.catalogs, [item.id]: { models, busy: false, error: "" } } }));
        } catch (reason) {
          if (current()) setSnapshot(previous => ({ owner, catalogs: { ...previous?.catalogs, [item.id]: {
            models: previous?.owner === owner ? previous.catalogs[item.id]?.models ?? [] : [], busy: false,
            error: reason instanceof Error ? reason.message : "读取服务模型失败",
            suggestedProtocol: reason instanceof ApiError && reason.details?.suggested_protocol === "responses" ? "responses" : undefined
          } } }));
        }
      }));
    } finally { if (owner.controller === controller) owner.controller = null; }
  }, [owner, fetchJson]);

  const state = snapshot?.owner === owner ? snapshot : null;
  const primary = state?.catalogs[connection?.id ?? owner.connections[0]?.id];
  const catalogs: ServiceModelCatalog[] = owner.connections.map(item => ({
    connection_id: item.id, connection_name: item.name || "模型连接", revision: item.revision, model_protocol: item.model_protocol,
    models: state?.catalogs[item.id]?.models ?? [], busy: state?.catalogs[item.id]?.busy ?? false, error: state?.catalogs[item.id]?.error ?? ""
  }));
  return { models: primary?.models ?? [], busy: primary?.busy ?? false, error: primary?.error ?? "", suggestedProtocol: primary?.suggestedProtocol, catalogs, discover };
}
