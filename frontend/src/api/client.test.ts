import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./client";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("turns a stalled request into a recoverable timeout error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));

    const result = fetchWithTimeout("/slow-request", {}, 10);
    const assertion = expect(result).rejects.toThrow("请求超时，请检查网络后重试");
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });
});
