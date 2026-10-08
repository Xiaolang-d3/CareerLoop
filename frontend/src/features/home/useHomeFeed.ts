import { useCallback, useEffect, useRef, useState } from "react";
import type { FetchJson, HomeFeedResponse, HomeItemState, HomePreferences } from "./types";

const POLL_INTERVAL_MS = 2_000;

type FeedRequest = {
  path: string;
  options?: RequestInit;
  throwOnError?: boolean;
  notice?: string;
  refresh?: boolean;
};

type FeedSession = {
  active: boolean;
  backgroundRefreshing: boolean;
  queue: Promise<void>;
  timer: number | null;
  controller: AbortController | null;
  reloadTask: Promise<void> | null;
  refreshTask: Promise<void> | null;
  request: (request: FeedRequest) => Promise<void>;
};

function errorMessage(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return "首页资讯请求失败，请重试";
}

export function useHomeFeed(fetchJson: FetchJson) {
  const [feed, setFeed] = useState<HomeFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionRef = useRef<FeedSession | null>(null);

  useEffect(() => {
    const session: FeedSession = {
      active: true,
      backgroundRefreshing: false,
      queue: Promise.resolve(),
      timer: null,
      controller: null,
      reloadTask: null,
      refreshTask: null,
      request: async () => undefined
    };
    sessionRef.current = session;
    setFeed(null);
    setLoading(true);
    setError(null);
    setNotice(null);
    setRefreshing(false);

    const clearPoll = () => {
      if (session.timer !== null) window.clearTimeout(session.timer);
      session.timer = null;
    };

    const schedulePoll = () => {
      if (!session.active || !session.backgroundRefreshing || session.timer !== null) return;
      session.timer = window.setTimeout(() => {
        session.timer = null;
        // Requests share a queue so an old poll cannot overwrite a saved preference
        // or a newer bookmark/hidden state returned by a mutation.
        void session.request({ path: "/home/feed" });
      }, POLL_INTERVAL_MS);
    };

    session.request = ({ path, options, throwOnError = false, notice: successNotice, refresh = false }) => {
      const task = session.queue.then(async () => {
        if (!session.active) return;
        clearPoll();
        const controller = new AbortController();
        session.controller = controller;
        setError(null);
        if (refresh) setRefreshing(true);
        try {
          const snapshot = await fetchJson<HomeFeedResponse>(path, { ...options, signal: controller.signal });
          if (!session.active) return;
          session.backgroundRefreshing = snapshot.refreshing;
          setFeed(snapshot);
          setRefreshing(snapshot.refreshing);
          if (successNotice) setNotice(successNotice);
        } catch (reason) {
          if (!session.active) return;
          // Keep the previous feed visible, and stop polling after a transport or
          // authentication failure. A manual retry starts a new polling cycle.
          session.backgroundRefreshing = false;
          setRefreshing(false);
          const message = errorMessage(reason);
          setError(message);
          if (throwOnError) throw reason instanceof Error ? reason : new Error(message);
        } finally {
          session.controller = null;
          if (session.active) {
            setLoading(false);
            schedulePoll();
          }
        }
      });
      // A rejected mutation must not prevent the next queued action from running.
      session.queue = task.catch(() => undefined);
      return task;
    };

    const initialTask = session.request({ path: "/home/feed" });
    session.reloadTask = initialTask;
    void initialTask.finally(() => {
      if (session.reloadTask === initialTask) session.reloadTask = null;
    });

    return () => {
      session.active = false;
      clearPoll();
      session.controller?.abort();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [fetchJson]);

  const reload = useCallback((): Promise<void> => {
    const session = sessionRef.current;
    if (!session?.active) return Promise.resolve();
    if (session.reloadTask) return session.reloadTask;
    const task = session.request({ path: "/home/feed" });
    session.reloadTask = task;
    void task.finally(() => {
      if (session.reloadTask === task) session.reloadTask = null;
    });
    return task;
  }, []);

  const refresh = useCallback((): Promise<void> => {
    const session = sessionRef.current;
    if (!session?.active) return Promise.resolve();
    if (session.refreshTask) return session.refreshTask;
    if (session.backgroundRefreshing) return Promise.resolve();
    const task = session.request({ path: "/home/feed/refresh", options: { method: "POST" }, refresh: true });
    session.refreshTask = task;
    void task.finally(() => {
      if (session.refreshTask === task) session.refreshTask = null;
    });
    return task;
  }, []);

  const savePreferences = useCallback((preferences: HomePreferences): Promise<void> => {
    const session = sessionRef.current;
    if (!session?.active) return Promise.resolve();
    return session.request({
      path: "/home/preferences",
      options: {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences)
      },
      throwOnError: true,
      notice: "兴趣设置已更新"
    });
  }, []);

  const setItemState = useCallback((id: string, patch: Partial<HomeItemState>): Promise<void> => {
    const session = sessionRef.current;
    if (!session?.active) return Promise.resolve();
    return session.request({
      path: `/home/feed/items/${encodeURIComponent(id)}/state`,
      options: {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      },
      throwOnError: true,
      notice: patch.hidden !== undefined
        ? patch.hidden ? "已隐藏这条信息" : "已恢复这条信息"
        : patch.bookmarked ? "已收藏" : "已取消收藏"
    });
  }, []);

  return { feed, loading, error, refreshing, notice, setNotice, refresh, reload, savePreferences, setItemState };
}
