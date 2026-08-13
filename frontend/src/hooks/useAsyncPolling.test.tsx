import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAsyncPolling } from "./useAsyncPolling";

describe("useAsyncPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the current request before scheduling another one", async () => {
    vi.useFakeTimers();
    let releaseFirst: (() => void) | undefined;
    const poll = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValue(undefined);

    renderHook(() => useAsyncPolling({ enabled: true, intervalMs: 10, poll, pauseWhenHidden: false }));
    await act(() => vi.advanceTimersByTimeAsync(10));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => { releaseFirst?.(); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("reports consecutive failures and resets the count after success", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const poll = vi.fn()
      .mockRejectedValueOnce(new Error("one"))
      .mockRejectedValueOnce(new Error("two"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("after success"));

    renderHook(() => useAsyncPolling({ enabled: true, intervalMs: 10, poll, onError, pauseWhenHidden: false }));
    await act(() => vi.advanceTimersByTimeAsync(40));

    expect(onError.mock.calls.map(([, failures]) => failures)).toEqual([1, 2, 1]);
  });
});
