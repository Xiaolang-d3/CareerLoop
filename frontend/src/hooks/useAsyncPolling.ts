import { useEffect, useRef } from "react";

type AsyncPollingOptions = {
  enabled: boolean;
  intervalMs: number;
  poll: () => Promise<unknown>;
  onError?: (reason: unknown, consecutiveFailures: number) => void;
  pauseWhenHidden?: boolean;
  runImmediately?: boolean;
};

/**
 * Poll without overlapping requests. The next attempt is scheduled only after
 * the current request settles, and background tabs wait until they are visible.
 */
export function useAsyncPolling({
  enabled,
  intervalMs,
  poll,
  onError,
  pauseWhenHidden = true,
  runImmediately = false
}: AsyncPollingOptions) {
  const pollRef = useRef(poll);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    pollRef.current = poll;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | null = null;
    let running = false;
    let consecutiveFailures = 0;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = window.setTimeout(() => void execute(), delay);
    };

    const execute = async () => {
      if (cancelled || running) return;
      if (pauseWhenHidden && document.visibilityState === "hidden") {
        schedule(intervalMs);
        return;
      }
      running = true;
      try {
        await pollRef.current();
        consecutiveFailures = 0;
      } catch (reason) {
        consecutiveFailures += 1;
        onErrorRef.current?.(reason, consecutiveFailures);
      } finally {
        running = false;
        schedule(intervalMs);
      }
    };

    const resumeWhenVisible = () => {
      if (!pauseWhenHidden || document.visibilityState !== "visible" || running) return;
      if (timer !== null) window.clearTimeout(timer);
      void execute();
    };

    document.addEventListener("visibilitychange", resumeWhenVisible);
    schedule(runImmediately ? 0 : intervalMs);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [enabled, intervalMs, pauseWhenHidden, runImmediately]);
}
