import { useCallback, useEffect, useRef, useState } from "react";
import type { createApiClient } from "../../api/client";
import type { AgentSettings } from "../../types";

type FetchJson = ReturnType<typeof createApiClient>;
type ConnectionSnapshot = Pick<AgentSettings, "model_base_url" | "model_name" | "model_protocol" | "api_key">;
type DiscoveryOptions = { silent?: boolean; force?: boolean };
type DiscoverySession = {
  active: boolean;
  requestId: number;
  controller: AbortController | null;
  snapshot: ConnectionSnapshot | null;
};

type Options = {
  fetchJson: FetchJson;
  onModelSuggested: (modelName: string) => void;
  onNotice: (message: string) => void;
};

function connectionSnapshot(settings: AgentSettings): ConnectionSnapshot {
  return {
    model_base_url: settings.model_base_url.trim(),
    model_name: settings.model_name.trim(),
    model_protocol: settings.model_protocol,
    api_key: settings.api_key.trim()
  };
}

function matchesConnection(left: ConnectionSnapshot | null, right: ConnectionSnapshot) {
  return left !== null
    && left.model_base_url === right.model_base_url
    && left.model_name === right.model_name
    && left.model_protocol === right.model_protocol
    && left.api_key === right.api_key;
}

function cancelSessionRequest(session: DiscoverySession) {
  session.requestId += 1;
  session.controller?.abort();
  session.controller = null;
  session.snapshot = null;
}

export function useModelDiscovery({ fetchJson, onModelSuggested, onNotice }: Options) {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const sessionRef = useRef<DiscoverySession | null>(null);
  const callbacksRef = useRef({ onModelSuggested, onNotice });
  callbacksRef.current = { onModelSuggested, onNotice };

  useEffect(() => {
    const session: DiscoverySession = { active: true, requestId: 0, controller: null, snapshot: null };
    sessionRef.current = session;
    setAvailableModels([]);
    setDiscoveryBusy(false);
    setDiscoveryError("");
    return () => {
      session.active = false;
      cancelSessionRequest(session);
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [fetchJson]);

  const invalidateDiscovery = useCallback((options: { keepModels?: boolean } = {}) => {
    const session = sessionRef.current;
    if (!session?.active) return;
    cancelSessionRequest(session);
    if (!options.keepModels) setAvailableModels([]);
    setDiscoveryBusy(false);
    setDiscoveryError("");
  }, []);

  const discoverModels = useCallback(async (settings: AgentSettings, options: DiscoveryOptions = {}) => {
    const session = sessionRef.current;
    if (!session?.active) return;
    const snapshot = connectionSnapshot(settings);
    const sameConnection = matchesConnection(session.snapshot, snapshot);
    if (!options.force && sameConnection) return;

    session.controller?.abort();
    const requestId = ++session.requestId;
    const controller = new AbortController();
    session.controller = controller;
    // The key is kept only in this in-memory snapshot, never in a cache key or storage.
    session.snapshot = snapshot;
    if (!sameConnection) setAvailableModels([]);
    setDiscoveryBusy(true);
    setDiscoveryError("");
    const isCurrent = () => session.active
      && sessionRef.current === session
      && session.requestId === requestId
      && !controller.signal.aborted;

    try {
      const result = await fetchJson<{ models: string[]; count: number }>("/agent/models/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
        signal: controller.signal
      });
      if (!isCurrent()) return;
      const models = Array.from(new Set(result.models.map((model) => model.trim()).filter(Boolean)));
      setAvailableModels(models);
      if (!snapshot.model_name && models[0]) callbacksRef.current.onModelSuggested(models[0]);
      if (!options.silent) callbacksRef.current.onNotice(`已识别 ${models.length} 个模型`);
    } catch (error) {
      if (!isCurrent()) return;
      // A failed request must remain retryable without changing the connection.
      session.snapshot = null;
      setAvailableModels([]);
      setDiscoveryError(error instanceof Error ? error.message : "识别可用模型失败");
    } finally {
      if (isCurrent()) {
        session.controller = null;
        setDiscoveryBusy(false);
      }
    }
  }, [fetchJson]);

  return { availableModels, discoveryBusy, discoveryError, discoverModels, invalidateDiscovery };
}
