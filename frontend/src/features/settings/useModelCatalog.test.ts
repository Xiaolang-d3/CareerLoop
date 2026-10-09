import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createApiClient } from "../../api/client";
import type { ModelCatalog } from "../../types";
import { useModelCatalog } from "./useModelCatalog";
const catalog: ModelCatalog = { connections: [], profiles: [], default_profile_id: "profile-new" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(finish => { resolve = finish; }); return { promise, resolve }; }
afterEach(cleanup);

describe("useModelCatalog", () => {
  it("drops an older read after a mutation returns a newer catalog", async () => {
    const old = deferred<ModelCatalog>();
    const client = vi.fn<ReturnType<typeof createApiClient>>().mockReturnValueOnce(old.promise).mockResolvedValue(catalog);
    const { result } = renderHook(() => useModelCatalog({ fetchJson: client as unknown as ReturnType<typeof createApiClient>, scope: "session", enabled: true }));
    await waitFor(() => expect(client).toHaveBeenCalledOnce());
    await act(() => result.current.mutate("/agent/model-default", "POST", { profile_id: "profile-new" }));
    await act(async () => { old.resolve({ ...catalog, default_profile_id: "profile-old" }); });
    expect(result.current.catalog.default_profile_id).toBe("profile-new");
    expect(result.current.busy).toBe(false);
  });
  it("clears one authentication scope and ignores its uncancellable result", async () => {
    const old = deferred<ModelCatalog>();
    const client = vi.fn<ReturnType<typeof createApiClient>>().mockReturnValueOnce(old.promise).mockResolvedValue(catalog);
    const { result, rerender } = renderHook(({ scope }) => useModelCatalog({ fetchJson: client as unknown as ReturnType<typeof createApiClient>, scope, enabled: true }), { initialProps: { scope: "old-session" } });
    rerender({ scope: "new-session" });
    await waitFor(() => expect(result.current.catalog.default_profile_id).toBe("profile-new"));
    await act(async () => { old.resolve({ ...catalog, default_profile_id: "old-session-profile" }); });
    expect(result.current.catalog.default_profile_id).toBe("profile-new");
  });
  it("reloads after a revision conflict while preserving an explicit error", async () => {
    const updated = { ...catalog, default_profile_id: "current-profile" };
    const client = vi.fn<ReturnType<typeof createApiClient>>().mockResolvedValueOnce(catalog).mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 })).mockResolvedValueOnce(updated);
    const { result } = renderHook(() => useModelCatalog({ fetchJson: client as unknown as ReturnType<typeof createApiClient>, scope: "session", enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let success = true;
    await act(async () => { success = await result.current.mutate("/agent/model-profiles/p1", "PATCH", { enabled: false, expected_revision: 1 }); });
    expect(success).toBe(false);
    expect(result.current.catalog.default_profile_id).toBe("current-profile");
    expect(result.current.error).toContain("此连接已更新");
  });
});
