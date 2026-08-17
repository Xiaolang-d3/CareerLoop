const DEFAULT_API_TIMEOUT_MS = 30_000;

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

type ValidationErrorItem = { loc?: unknown[]; msg?: string };

function formatValidationErrors(items: ValidationErrorItem[]): string {
  const lines = items
    .map((item) => {
      const field = (item.loc ?? []).filter((part) => part !== "body").join(".");
      if (!item.msg) return "";
      return field ? `${field}：${item.msg}` : item.msg;
    })
    .filter(Boolean);
  return lines.join("；");
}

export function createApiClient(apiBase: string, accessToken?: string) {
  return async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    const response = await fetchWithTimeout(`${apiBase}${path}`, { ...options, headers });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let message = `${path} 请求失败（${response.status}）`;
      try {
        const payload = JSON.parse(body) as {
          detail?: string | { message?: string } | ValidationErrorItem[];
        };
        if (typeof payload.detail === "string") message = payload.detail;
        else if (Array.isArray(payload.detail)) {
          // FastAPI 参数校验错误返回 detail 数组，拼出字段级提示。
          message = formatValidationErrors(payload.detail) || message;
        } else if (payload.detail && typeof payload.detail === "object" && payload.detail.message) {
          message = payload.detail.message;
        }
      } catch {
        // 未捕获异常会返回纯文本响应，附上正文片段比只给状态码更可诊断。
        const plain = body.trim();
        if (plain && !plain.startsWith("<") && plain.length <= 200) {
          message = `${message}：${plain}`;
        }
      }
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  };
}
