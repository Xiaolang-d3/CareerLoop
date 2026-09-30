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

  it("does not send a request that was already cancelled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchWithTimeout("/library", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards cancellation during an active request without calling it a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const controller = new AbortController();
    const request = fetchWithTimeout("/library", { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends multipart files and repeated fields through the desktop bridge", async () => {
    const invoke = vi.fn(async (_command: string, args: { request: { formFields: Array<Record<string, string>> } }) => {
      const fields = args.request.formFields;
      expect(fields.map((field) => field.name)).toEqual(["mode", "files", "files"]);
      expect(fields[0].value).toBe("fast");
      expect(fields[1]).toMatchObject({ filename: "笔记.txt", contentType: "text/plain", dataBase64: "aGVsbG8=" });
      expect(fields[2]).toMatchObject({ filename: "图片.png", contentType: "image/png", dataBase64: "AAEC" });
      return { status: 200, body: '{"results":[]}', contentType: "application/json" };
    });
    Object.assign(window, { __TAURI__: { core: { invoke } } });
    try {
      const form = new FormData();
      form.append("mode", "fast");
      form.append("files", new File(["hello"], "笔记.txt", { type: "text/plain" }));
      form.append("files", new File([new Uint8Array([0, 1, 2])], "图片.png", { type: "image/png" }));
      const response = await fetchWithTimeout("http://127.0.0.1:8000/library/sources/import", { method: "POST", body: form });
      expect(await response.json()).toEqual({ results: [] });
      expect(invoke).toHaveBeenCalledOnce();
    } finally {
      delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
    }
  });

  it("returns binary avatar data from the desktop bridge intact", async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: "", bodyBase64: "AAEC/w==", contentType: "image/jpeg" }));
    Object.assign(window, { __TAURI__: { core: { invoke } } });
    try {
      const response = await fetchWithTimeout("http://127.0.0.1:8000/auth/me/avatar");
      expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 1, 2, 255]);
    } finally {
      delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
    }
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
      "/agent/models/discover 请求失败（500） @ https://app.example.com：Internal Server Error"
    );
  });

  it("does not paste an HTML error page into the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "<html><body>502 Bad Gateway</body></html>",
      { status: 502, headers: { "Content-Type": "text/html" } }
    )));

    const fetchJson = createApiClient("https://app.example.com");
    await expect(fetchJson("/agent/models/discover", { method: "POST" })).rejects.toThrow(
      /^\/agent\/models\/discover 请求失败（502） @ https:\/\/app\.example\.com$/
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
