import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { FetchJson, HomeCuration, HomeFeedResponse } from "./types";
import { useHomeFeed } from "./useHomeFeed";

function snapshot(status: HomeCuration["status"] = "disabled"): HomeFeedResponse {
  return {
    news: [], repositories: { day: [], week: [] }, updates: [], practices: [], sources: [], item_states: {},
    preferences: { topics: ["Agent"], repositories: [], digest_profile_id: "p1", curation_enabled: status !== "disabled" },
    digest: { status: "unconfigured", profile_id: "", model_name: "", generated_at: null, date: null, error: "", overview: "", sections: [] },
    curation: { status, date: null, generated_at: null, model_name: "text-model", error: "", warnings: [], items: [] },
    refreshing: false, last_synced_at: null
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function mockClient() { return vi.fn<FetchJson>() as Mock<FetchJson> & FetchJson; }
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function settle() { await act(async () => undefined); }

describe("daily curation in useHomeFeed", () => {
  it("does not send queued curation to a switched account or accept a late old-account response", async () => {
    const pending = deferred<HomeFeedResponse>();
    const oldClient = mockClient().mockResolvedValueOnce(snapshot("ready")).mockReturnValueOnce(pending.promise);
    const newClient = mockClient().mockResolvedValue(snapshot());
    const { result, rerender } = renderHook(({ client }) => useHomeFeed(client), { initialProps: { client: oldClient } });
    await settle();
    const reload = result.current.reload();
    await settle();
    const curation = result.current.regenerateCuration();
    const signal = oldClient.mock.calls[1][1]?.signal;
    rerender({ client: newClient });
    await settle();
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(snapshot("generating")); await Promise.all([reload, curation]); });
    expect(oldClient).toHaveBeenCalledTimes(2);
    expect(newClient).toHaveBeenCalledTimes(1);
    expect(result.current.feed?.curation?.status).toBe("disabled");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the previous curated items and stops polling after a manual request fails", async () => {
    const cached = snapshot("ready");
    cached.curation!.items = [{ id: "cached", title: "旧精选", summary: "摘要", why_it_matters: "原因", source: "官方", url: "https://example.test", published_at: "", event_date: "", confidence: "medium", evidence: "依据" }];
    const client = mockClient().mockResolvedValueOnce(cached).mockRejectedValueOnce(new Error("搜索服务中断")).mockResolvedValue(snapshot("generating"));
    const { result } = renderHook(() => useHomeFeed(client));
    await settle();
    await act(async () => { await expect(result.current.regenerateCuration()).rejects.toThrow("搜索服务中断"); });
    expect(result.current.feed).toEqual(cached);
    expect(result.current.error).toBe("搜索服务中断");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(client).toHaveBeenCalledTimes(2);
    await act(() => result.current.regenerateCuration());
    expect(result.current.feed?.curation?.status).toBe("generating");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("rechecks opt-in after an earlier queued preference change disables it", async () => {
    const client = mockClient().mockResolvedValueOnce(snapshot("ready")).mockResolvedValue(snapshot());
    const { result } = renderHook(() => useHomeFeed(client));
    await settle();
    await act(async () => {
      const save = result.current.savePreferences(snapshot().preferences);
      const curation = result.current.regenerateCuration();
      await save;
      await expect(curation).rejects.toThrow("请先启用每日资讯精选并选择日报模型");
    });
    expect(client.mock.calls.map(([path]) => path)).toEqual(["/home/feed", "/home/preferences"]);
  });
  it("refuses regeneration before explicit opt-in or a selected model", async () => {
    const client = mockClient().mockResolvedValue(snapshot());
    const { result } = renderHook(() => useHomeFeed(client));
    await settle();
    await act(async () => { await expect(result.current.regenerateCuration()).rejects.toThrow("请先启用每日资讯精选并选择日报模型"); });
    expect(client).toHaveBeenCalledTimes(1);
    const unconfigured = snapshot("unconfigured");
    unconfigured.preferences.digest_profile_id = "";
    client.mockResolvedValue(unconfigured);
    await act(() => result.current.reload());
    await act(async () => { await expect(result.current.regenerateCuration()).rejects.toThrow("请先启用每日资讯精选并选择日报模型"); });
    expect(client.mock.calls.some(([path]) => path === "/home/feed/curation")).toBe(false);
  });
  it("coalesces manual regeneration into one POST and suppresses clicks while generating", async () => {
    const pending = deferred<HomeFeedResponse>();
    const client = mockClient().mockResolvedValueOnce(snapshot("ready")).mockReturnValueOnce(pending.promise).mockResolvedValue(snapshot("ready"));
    const { result } = renderHook(() => useHomeFeed(client));
    await settle();
    let first!: Promise<void>;
    act(() => {
      first = result.current.regenerateCuration();
      expect(result.current.regenerateCuration()).toBe(first);
    });
    await settle();
    expect(client).toHaveBeenCalledTimes(2);
    expect(client).toHaveBeenNthCalledWith(2, "/home/feed/curation", expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }));
    await act(async () => { pending.resolve(snapshot("generating")); await first; });
    await act(() => result.current.regenerateCuration());
    expect(client).toHaveBeenCalledTimes(2);
    expect(result.current.notice).toBe("已开始筛选今日资讯");
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.feed?.curation?.status).toBe("ready");
    expect(client.mock.calls.filter(([path]) => path === "/home/feed/curation")).toHaveLength(1);
  });
  it("polls curation without RSS until complete, without posting automatic regeneration", async () => {
    const client = mockClient().mockResolvedValueOnce(snapshot("generating")).mockResolvedValueOnce(snapshot("generating")).mockResolvedValueOnce(snapshot("ready"));
    const { result } = renderHook(() => useHomeFeed(client));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(client).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.feed?.curation?.status).toBe("ready");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(client).toHaveBeenCalledTimes(3);
    expect(client.mock.calls.every(([path, options]) => path === "/home/feed" && !options?.method)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
