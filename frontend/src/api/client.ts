export function createApiClient(apiBase: string) {
  return async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, options);
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
