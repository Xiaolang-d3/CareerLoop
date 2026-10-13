import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createApiClient } from "../../api/client";
import type { ModelConnection } from "../../types";
import { useComposerModelDiscovery } from "./useComposerModelDiscovery";

const connection: ModelConnection = { id: "service-a", name: "服务 A", revision: 1, model_base_url: "https://a.example.test/v1", model_protocol: "auto", api_key_configured: true, enabled: true };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(finish => { resolve = finish; }); return { promise, resolve }; }
afterEach(cleanup);

describe("useComposerModelDiscovery", () => {
  it("lazily reads the saved service catalog, deduplicates names, and caches until refreshed", async () => {
    const client = vi.fn().mockResolvedValue({ models: ["grok-model", "claude-model", "grok-model"] });
    const { result } = renderHook(() => useComposerModelDiscovery({ fetchJson: client as ReturnType<typeof createApiClient>, scope: "user-a", connection }));
    expect(client).not.toHaveBeenCalled();
    await act(() => result.current.discover());
    expect(result.current.models).toEqual(["grok-model", "claude-model"]);
    expect(client.mock.calls[0][0]).toBe("/agent/model-connections/service-a/discover");
    expect(client.mock.calls[0][1].body).toBeUndefined();
    await act(() => result.current.discover());
    expect(client).toHaveBeenCalledOnce();
    await act(() => result.current.discover(true));
    expect(client).toHaveBeenCalledTimes(2);
  });

  it("drops late results after a connection revision or account changes", async () => {
    const old = deferred<{ models: string[] }>();
    const client = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ models: ["new-model"] });
    const { result, rerender } = renderHook(({ revision, scope }) => useComposerModelDiscovery({ fetchJson: client as ReturnType<typeof createApiClient>, scope, connection: { ...connection, revision } }), { initialProps: { revision: 1, scope: "user-a" } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.discover(); });
    rerender({ revision: 2, scope: "user-b" });
    expect(result.current.models).toEqual([]);
    expect(client.mock.calls[0][1].signal.aborted).toBe(true);
    await act(() => result.current.discover());
    await act(async () => { old.resolve({ models: ["old-model"] }); await pending; });
    expect(result.current.models).toEqual(["new-model"]);
  });

  it("retains a known catalog on refresh failure and permits retry", async () => {
    const client = vi.fn().mockResolvedValueOnce({ models: ["known-model"] }).mockRejectedValueOnce(new Error("service offline")).mockResolvedValueOnce({ models: ["recovered-model"] });
    const { result } = renderHook(() => useComposerModelDiscovery({ fetchJson: client as ReturnType<typeof createApiClient>, scope: "user-a", connection }));
    await act(() => result.current.discover());
    await act(() => result.current.discover(true));
    expect(result.current.models).toEqual(["known-model"]);
    expect(result.current.error).toBe("service offline");
    await act(() => result.current.discover(true));
    await waitFor(() => expect(result.current.error).toBe(""));
    expect(result.current.models).toEqual(["recovered-model"]);
  });
});
