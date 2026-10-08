import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError } from "../../api/client";
import type { FetchJson, HomeFeedResponse } from "./types";
import { useHomeFeed } from "./useHomeFeed";

function snapshot(patch: Partial<HomeFeedResponse> = {}): HomeFeedResponse {
  return {
    news: [{
      id: "news:agent-sdk",
      title: "SDK 发布说明",
      summary: "官方更新内容",
      url: "https://example.test/releases",
      source: "官方发布",
      published_at: "2026-10-08T08:00:00Z",
      category: "Agent",
      tags: ["Agent"],
      image_url: null
    }],
    repositories: { day: [], week: [] },
    updates: [],
    practices: [],
    sources: [],
    preferences: { topics: ["Agent"], repositories: [] },
    item_states: {},
    refreshing: false,
    last_synced_at: "2026-10-08T08:00:00Z",
    ...patch
  };
}

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

async function settle() {
  await act(async () => undefined);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useHomeFeed", () => {
  it("loads the authenticated feed without replacing an empty response with demo data", async () => {
    const actual = snapshot({ news: [] });
    const fetchJson = mockClient().mockResolvedValue(actual);
    const { result } = renderHook(() => useHomeFeed(fetchJson));
    expect(result.current.loading).toBe(true);
    expect(result.current.feed).toBeNull();

    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith("/home/feed", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result.current.feed).toEqual(actual);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a concrete error on a failed initial load and supports a manual retry", async () => {
    const fetchJson = mockClient()
      .mockRejectedValueOnce(new Error("搜索服务暂时不可用"))
      .mockResolvedValueOnce(snapshot());
    const { result } = renderHook(() => useHomeFeed(fetchJson));
    await settle();
    expect(result.current.feed).toBeNull();
    expect(result.current.error).toBe("搜索服务暂时不可用");
    expect(result.current.loading).toBe(false);

    await act(() => result.current.reload());
    expect(result.current.feed?.news).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("deduplicates refresh clicks and polls until the background refresh completes", async () => {
    const finished = snapshot({ last_synced_at: "2026-10-08T09:00:00Z" });
    const fetchJson = mockClient()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ refreshing: true }))
      .mockResolvedValueOnce(snapshot({ refreshing: true }))
      .mockResolvedValueOnce(finished);
    const { result } = renderHook(() => useHomeFeed(fetchJson));
    await settle();

    await act(async () => {
      const first = result.current.refresh();
      const second = result.current.refresh();
      expect(second).toBe(first);
      await first;
    });
    expect(fetchJson).toHaveBeenNthCalledWith(2, "/home/feed/refresh", expect.objectContaining({ method: "POST" }));
    expect(result.current.refreshing).toBe(true);
    await act(() => result.current.refresh());
    expect(fetchJson).toHaveBeenCalledTimes(2);

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchJson).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.feed).toEqual(finished);
    expect(result.current.refreshing).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchJson).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap slow polls and aborts a running poll on unmount", async () => {
    const pending = deferred<HomeFeedResponse>();
    const fetchJson = mockClient()
      .mockResolvedValueOnce(snapshot({ refreshing: true }))
      .mockReturnValueOnce(pending.promise);
    const { unmount } = renderHook(() => useHomeFeed(fetchJson));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const signal = fetchJson.mock.calls[1][1]?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(snapshot({ refreshing: true })));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a pending polling timer on unmount", async () => {
    const fetchJson = mockClient().mockResolvedValue(snapshot({ refreshing: true }));
    const { unmount } = renderHook(() => useHomeFeed(fetchJson));
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("retains cached content and stops polling when the client reports an expired session", async () => {
    const cached = snapshot({ refreshing: true });
    const fetchJson = mockClient()
      .mockResolvedValueOnce(cached)
      .mockRejectedValueOnce(new ApiError("登录已过期", 401));
    const { result } = renderHook(() => useHomeFeed(fetchJson));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.feed).toEqual(cached);
    expect(result.current.error).toBe("登录已过期");
    expect(result.current.refreshing).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("persists interest preferences and polls the resulting refresh", async () => {
    const preferences = { topics: ["Agent", "MCP"], repositories: ["example/agent-sdk"] };
    const fetchJson = mockClient()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ preferences, refreshing: true }))
      .mockResolvedValueOnce(snapshot({ preferences }));
    const { result } = renderHook(() => useHomeFeed(fetchJson));
    await settle();
    await act(() => result.current.savePreferences(preferences));
    expect(fetchJson).toHaveBeenNthCalledWith(2, "/home/preferences", expect.objectContaining({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences)
    }));
    expect(result.current.feed?.preferences).toEqual(preferences);
    expect(result.current.notice).toBe("兴趣设置已更新");
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.refreshing).toBe(false);
  });

  it("serializes bookmark and hide patches so neither snapshot loses a saved state", async () => {
    const bookmark = deferred<HomeFeedResponse>();
    const id = "github:example/repo#版本";
    const final = snapshot({ item_states: { [id]: { bookmarked: true, hidden: true } } });
    const fetchJson = mockClient()
      .mockResolvedValueOnce(snapshot())
      .mockReturnValueOnce(bookmark.promise)
      .mockResolvedValueOnce(final);
    const { result } = renderHook(() => useHomeFeed(fetchJson));
    await settle();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.setItemState(id, { bookmarked: true });
      second = result.current.setItemState(id, { hidden: true });
    });
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchJson).toHaveBeenNthCalledWith(2, `/home/feed/items/${encodeURIComponent(id)}/state`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ bookmarked: true })
    }));

    await act(async () => {
      bookmark.resolve(snapshot({ item_states: { [id]: { bookmarked: true, hidden: false } } }));
      await Promise.all([first, second]);
    });
    expect(fetchJson).toHaveBeenNthCalledWith(3, `/home/feed/items/${encodeURIComponent(id)}/state`, expect.objectContaining({
      body: JSON.stringify({ hidden: true })
    }));
    expect(result.current.feed).toEqual(final);
    expect(result.current.notice).toBe("已隐藏这条信息");
  });

  it("does not let an earlier reload replace a subsequent item-state mutation", async () => {
    const oldReload = deferred<HomeFeedResponse>();
    const updated = snapshot({ item_states: { "news:agent-sdk": { bookmarked: true, hidden: false } } });
    const fetchJson = mockClient()
      .mockResolvedValueOnce(snapshot())
      .mockReturnValueOnce(oldReload.promise)
      .mockResolvedValueOnce(updated);
    const { result } = renderHook(() => useHomeFeed(fetchJson));
    await settle();

    let reloading!: Promise<void>;
    let bookmarking!: Promise<void>;
    act(() => {
      reloading = result.current.reload();
      bookmarking = result.current.setItemState("news:agent-sdk", { bookmarked: true });
    });
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await act(async () => {
      oldReload.resolve(snapshot());
      await Promise.all([reloading, bookmarking]);
    });
    expect(result.current.feed).toEqual(updated);
  });

  it("throws failed mutations for form callers while keeping the old feed and allowing later actions", async () => {
    const cached = snapshot();
    const fetchJson = mockClient()
      .mockResolvedValueOnce(cached)
      .mockRejectedValueOnce(new Error("仓库格式必须为 owner/repo"))
      .mockRejectedValueOnce(new Error("收藏未保存"))
      .mockResolvedValueOnce(snapshot({ item_states: { item: { bookmarked: true, hidden: false } } }));
    const { result } = renderHook(() => useHomeFeed(fetchJson));
    await settle();

    await act(async () => {
      await expect(result.current.savePreferences({ topics: [], repositories: ["invalid"] }))
        .rejects.toThrow("仓库格式必须为 owner/repo");
    });
    expect(result.current.feed).toEqual(cached);
    expect(result.current.error).toBe("仓库格式必须为 owner/repo");
    expect(result.current.notice).toBeNull();

    await act(async () => {
      await expect(result.current.setItemState("item", { bookmarked: true })).rejects.toThrow("收藏未保存");
    });
    expect(result.current.error).toBe("收藏未保存");
    await act(() => result.current.setItemState("item", { bookmarked: true }));
    expect(result.current.error).toBeNull();
    expect(result.current.feed?.item_states.item.bookmarked).toBe(true);
  });

  it("ignores late responses from a replaced account client and aborts its requests", async () => {
    const previous = deferred<HomeFeedResponse>();
    const oldClient = mockClient().mockReturnValue(previous.promise);
    const currentFeed = snapshot({ preferences: { topics: ["RAG"], repositories: [] } });
    const currentClient = mockClient().mockResolvedValue(currentFeed);
    const { result, rerender } = renderHook(({ client }) => useHomeFeed(client), { initialProps: { client: oldClient } });
    await settle();
    const oldSignal = oldClient.mock.calls[0][1]?.signal;

    rerender({ client: currentClient });
    await settle();
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current.feed).toEqual(currentFeed);
    await act(async () => previous.resolve(snapshot({ refreshing: true })));
    expect(result.current.feed).toEqual(currentFeed);
    expect(result.current.refreshing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores late account errors and does not send its queued mutations", async () => {
    const oldResponse = deferred<HomeFeedResponse>();
    const oldClient = mockClient().mockReturnValue(oldResponse.promise);
    const newClient = mockClient().mockResolvedValue(snapshot());
    const { result, rerender } = renderHook(({ client }) => useHomeFeed(client), { initialProps: { client: oldClient } });
    await settle();
    const oldMutation = result.current.setItemState("old-account-item", { hidden: true });

    rerender({ client: newClient });
    await settle();
    await act(async () => {
      oldResponse.reject(new Error("旧账号请求失败"));
      await oldMutation;
    });
    expect(oldClient).toHaveBeenCalledTimes(1);
    expect(newClient).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.notice).toBeNull();
  });

  it("passes through durable bookmarks even when an item has left the latest source feed", async () => {
    const savedArticle = snapshot().news[0];
    const persisted = snapshot({ news: [], bookmarks: [{ kind: "news", item: savedArticle }] });
    const fetchJson = mockClient().mockResolvedValue(persisted);
    const { result } = renderHook(() => useHomeFeed(fetchJson));
    await settle();
    expect(result.current.feed?.news).toEqual([]);
    expect(result.current.feed?.bookmarks).toEqual([{ kind: "news", item: savedArticle }]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});
