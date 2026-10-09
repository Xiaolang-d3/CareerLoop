import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { createApiClient } from "../../api/client";
import { defaultAgentSettings } from "../../constants";
import type { AgentSettings } from "../../types";
import { useModelDiscovery } from "./useModelDiscovery";

type FetchJson = ReturnType<typeof createApiClient>;
type Catalog = { models: string[]; count: number };
const settings: AgentSettings = {
  ...defaultAgentSettings,
  model_name: "test-model",
  model_base_url: "https://gateway.example.test/v1",
  api_key: "",
  api_key_configured: true
};

function mockClient() {
  return vi.fn<FetchJson>() as Mock<FetchJson> & FetchJson;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(fetchJson = mockClient()) {
  const onModelSuggested = vi.fn();
  const onNotice = vi.fn();
  const hook = renderHook(() => useModelDiscovery({ fetchJson, onModelSuggested, onNotice }));
  return { ...hook, fetchJson, onModelSuggested, onNotice };
}

afterEach(cleanup);

describe("useModelDiscovery", () => {
  it("loads the requested connection without exposing a stored key or replacing a chosen model", async () => {
    const fetchJson = mockClient().mockResolvedValue({ models: [" test-model ", "other-model", "test-model", ""], count: 4 });
    const { result, onModelSuggested, onNotice } = setup(fetchJson);

    await act(() => result.current.discoverModels(settings));

    expect(fetchJson).toHaveBeenCalledWith("/agent/models/discover", expect.objectContaining({
      method: "POST", signal: expect.any(AbortSignal), body: JSON.stringify({
        model_base_url: settings.model_base_url,
        model_name: settings.model_name,
        model_protocol: settings.model_protocol,
        api_key: ""
      })
    }));
    expect(result.current.availableModels).toEqual(["test-model", "other-model"]);
    expect(result.current.discoveryBusy).toBe(false);
    expect(result.current.discoveryError).toBe("");
    expect(onModelSuggested).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith("已识别 2 个模型");
  });

  it("deduplicates identical connections but allows an explicit refresh", async () => {
    const { result, fetchJson } = setup(mockClient().mockResolvedValue({ models: ["test-model"], count: 1 }));
    await act(() => result.current.discoverModels(settings));
    await act(() => result.current.discoverModels({ ...settings, model_base_url: ` ${settings.model_base_url} ` }));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await act(() => result.current.discoverModels(settings, { force: true }));
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("treats two different draft keys as different connections", async () => {
    const { result, fetchJson } = setup(mockClient().mockResolvedValue({ models: ["test-model"], count: 1 }));
    await act(() => result.current.discoverModels({ ...settings, api_key: "test-only-first" }));
    await act(() => result.current.discoverModels({ ...settings, api_key: "test-only-second" }));
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale result even when its client ignores the aborted signal", async () => {
    const first = deferred<Catalog>();
    const second = deferred<Catalog>();
    const fetchJson = mockClient().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, onNotice } = setup(fetchJson);
    let firstTask!: Promise<void>;
    let secondTask!: Promise<void>;
    act(() => { firstTask = result.current.discoverModels(settings); });
    act(() => { secondTask = result.current.discoverModels({ ...settings, model_base_url: "https://new.example.test/v1" }); });
    expect(fetchJson.mock.calls[0][1]?.signal?.aborted).toBe(true);

    await act(async () => { first.resolve({ models: ["stale-model"], count: 1 }); await firstTask; });
    expect(result.current.availableModels).toEqual([]);
    expect(result.current.discoveryBusy).toBe(true);
    expect(onNotice).not.toHaveBeenCalled();

    await act(async () => { second.resolve({ models: ["new-model"], count: 1 }); await secondTask; });
    expect(result.current.availableModels).toEqual(["new-model"]);
    expect(result.current.discoveryBusy).toBe(false);
    expect(onNotice).toHaveBeenCalledOnce();
  });

  it("keeps a new catalog after an older request fails", async () => {
    const first = deferred<Catalog>();
    const fetchJson = mockClient().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ models: ["new-model"], count: 1 });
    const { result } = setup(fetchJson);
    let firstTask!: Promise<void>;
    act(() => { firstTask = result.current.discoverModels(settings); });
    await act(() => result.current.discoverModels({ ...settings, model_base_url: "https://new.example.test/v1" }));
    await act(async () => { first.reject(new Error("旧服务错误")); await firstTask; });
    expect(result.current.availableModels).toEqual(["new-model"]);
    expect(result.current.discoveryError).toBe("");
  });

  it("invalidates a pending request and permits retrying the same connection", async () => {
    const first = deferred<Catalog>();
    const fetchJson = mockClient().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ models: ["retry-model"], count: 1 });
    const { result, onNotice } = setup(fetchJson);
    let firstTask!: Promise<void>;
    act(() => { firstTask = result.current.discoverModels(settings); });
    act(() => result.current.invalidateDiscovery());
    expect(fetchJson.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(result.current.discoveryBusy).toBe(false);
    await act(async () => { first.resolve({ models: ["stale-model"], count: 1 }); await firstTask; });
    expect(result.current.availableModels).toEqual([]);
    expect(onNotice).not.toHaveBeenCalled();
    await act(() => result.current.discoverModels(settings));
    expect(result.current.availableModels).toEqual(["retry-model"]);
    act(() => result.current.invalidateDiscovery());
    expect(result.current.availableModels).toEqual([]);
  });

  it("shows an inline failure, permits retry, and suggests a model only for an empty field", async () => {
    const fetchJson = mockClient().mockRejectedValueOnce(new Error("服务暂不可用"))
      .mockResolvedValueOnce({ models: ["suggested-model"], count: 1 });
    const { result, onModelSuggested, onNotice } = setup(fetchJson);
    const emptyModel = { ...settings, model_name: " " };
    await act(() => result.current.discoverModels(emptyModel, { silent: true }));
    expect(result.current.discoveryError).toBe("服务暂不可用");
    expect(result.current.discoveryBusy).toBe(false);
    await act(() => result.current.discoverModels(emptyModel, { silent: true }));
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(result.current.discoveryError).toBe("");
    expect(onModelSuggested).toHaveBeenCalledWith("suggested-model");
    expect(onNotice).not.toHaveBeenCalled();
  });

  it("can retain the catalog while invalidating requests after a model selection", async () => {
    const pending = deferred<Catalog>();
    const fetchJson = mockClient().mockResolvedValueOnce({ models: ["test-model", "other-model"], count: 2 })
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ models: ["refreshed-model"], count: 1 });
    const { result, onNotice } = setup(fetchJson);
    await act(() => result.current.discoverModels(settings));
    let task!: Promise<void>;
    act(() => { task = result.current.discoverModels(settings, { force: true }); });
    act(() => result.current.invalidateDiscovery({ keepModels: true }));
    expect(fetchJson.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(result.current.availableModels).toEqual(["test-model", "other-model"]);
    expect(result.current.discoveryBusy).toBe(false);
    expect(result.current.discoveryError).toBe("");
    await act(async () => { pending.resolve({ models: ["stale-model"], count: 1 }); await task; });
    expect(result.current.availableModels).toEqual(["test-model", "other-model"]);
    expect(onNotice).toHaveBeenCalledOnce();
    await act(() => result.current.discoverModels(settings));
    expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(result.current.availableModels).toEqual(["refreshed-model"]);
  });

  it("clears the old client session and ignores its result when authentication changes", async () => {
    const first = deferred<Catalog>();
    const oldClient = mockClient().mockReturnValue(first.promise);
    const newClient = mockClient().mockResolvedValue({ models: ["new-account-model"], count: 1 });
    const onModelSuggested = vi.fn();
    const onNotice = vi.fn();
    const { result, rerender } = renderHook(({ client }) => useModelDiscovery({ fetchJson: client, onModelSuggested, onNotice }), {
      initialProps: { client: oldClient }
    });
    let oldTask!: Promise<void>;
    act(() => { oldTask = result.current.discoverModels({ ...settings, model_name: "" }); });
    rerender({ client: newClient });
    expect(oldClient.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(result.current.discoveryBusy).toBe(false);
    await act(async () => { first.resolve({ models: ["old-account-model"], count: 1 }); await oldTask; });
    expect(result.current.availableModels).toEqual([]);
    expect(onModelSuggested).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    await act(() => result.current.discoverModels(settings));
    expect(result.current.availableModels).toEqual(["new-account-model"]);
  });

  it("aborts on unmount without calling callbacks after completion", async () => {
    const pending = deferred<Catalog>();
    const fetchJson = mockClient().mockReturnValue(pending.promise);
    const { result, unmount, onModelSuggested, onNotice } = setup(fetchJson);
    let task!: Promise<void>;
    act(() => { task = result.current.discoverModels({ ...settings, model_name: "" }); });
    unmount();
    expect(fetchJson.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { pending.resolve({ models: ["late-model"], count: 1 }); await task; });
    expect(onModelSuggested).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });
});
