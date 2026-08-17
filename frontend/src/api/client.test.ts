import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, fetchWithTimeout } from "./client";

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

describe("fetchJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces field-level messages from FastAPI validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({
        detail: [
          { loc: ["body", "job_description"], msg: "String should have at least 20 characters", type: "string_too_short" }
        ]
      }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    )));

    const fetchJson = createApiClient("https://app.example.com");
    await expect(fetchJson("/quick-match", { method: "POST" })).rejects.toThrow(
      "job_description：String should have at least 20 characters"
    );
  });

  it("adds the plain-text body when the server did not return JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "Internal Server Error",
      { status: 500, headers: { "Content-Type": "text/plain" } }
    )));

    const fetchJson = createApiClient("https://app.example.com");
    await expect(fetchJson("/agent/models/discover", { method: "POST" })).rejects.toThrow(
      "/agent/models/discover 请求失败（500）：Internal Server Error"
    );
  });

  it("does not paste an HTML error page into the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "<html><body>502 Bad Gateway</body></html>",
      { status: 502, headers: { "Content-Type": "text/html" } }
    )));

    const fetchJson = createApiClient("https://app.example.com");
    await expect(fetchJson("/agent/models/discover", { method: "POST" })).rejects.toThrow(
      /^\/agent\/models\/discover 请求失败（502）$/
    );
  });

  it("keeps the status-code fallback when the detail array is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: [] }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    )));

    const fetchJson = createApiClient("https://app.example.com");
    await expect(fetchJson("/quick-match", { method: "POST" })).rejects.toThrow(
      "/quick-match 请求失败（422）"
    );
  });
});
