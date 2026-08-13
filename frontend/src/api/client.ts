export const DEFAULT_API_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: RequestInit = {},
  timeoutMs = DEFAULT_API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } catch (reason) {
    if (timedOut) throw new Error("请求超时，请检查网络后重试");
    throw reason;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export function createApiClient(apiBase: string, accessToken?: string) {
  return async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    const response = await fetchWithTimeout(`${apiBase}${path}`, { ...options, headers });
    if (!response.ok) {
      let message = `${path} 请求失败（${response.status}）`;
      try {
        const payload = await response.json() as { detail?: string | { message?: string } };
        if (typeof payload.detail === "string") message = payload.detail;
        if (payload.detail && typeof payload.detail === "object" && payload.detail.message) {
          message = payload.detail.message;
        }
      } catch {
        // 服务端未返回 JSON 时保留包含状态码的错误信息。
      }
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  };
}
