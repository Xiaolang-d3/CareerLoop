const DEFAULT_API_TIMEOUT_MS = 30_000;

type DesktopApiResponse = { status: number; body: string; bodyBase64?: string | null; contentType?: string | null; retryAfter?: string | null };

export const SESSION_EXPIRED_EVENT = "careerloop:session-expired";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterSeconds = 0) {
    super(message);
    this.name = "ApiError";
  }
}

type DesktopFormField = {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  dataBase64?: string;
};

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("读取上传文件失败"));
    reader.readAsArrayBuffer(file);
  });
}

async function desktopFormFields(form: FormData): Promise<DesktopFormField[]> {
  const fields: DesktopFormField[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      fields.push({ name, value });
    } else {
      fields.push({
        name,
        filename: value.name,
        contentType: value.type || "application/octet-stream",
        dataBase64: encodeBase64(new Uint8Array(await readFileBytes(value)))
      });
    }
  }
  return fields;
}

async function tauriAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Desktop WebView is https://tauri.localhost; browser fetch to http://127.0.0.1
  // is mixed-content blocked. Prefer the Rust sidecar proxy (known apiBase),
  // and fall back to the Tauri HTTP plugin for non-loopback URLs.
  const invoke = (window as Window & {
    __TAURI__?: { core?: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } };
  }).__TAURI__?.core?.invoke;
  if (invoke) {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, window.location.href);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      const headers = new Headers(init?.headers);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? init.body : undefined;
      const formFields = init?.body instanceof FormData ? await desktopFormFields(init.body) : undefined;
      try {
        const result = await invoke<DesktopApiResponse>("desktop_api_request", {
          request: {
            path: `${url.pathname}${url.search}`,
            method,
            body,
            formFields,
            authorization: headers.get("Authorization"),
          },
        });
        const responseHeaders = new Headers();
        if (result.contentType) responseHeaders.set("Content-Type", result.contentType);
        if (result.retryAfter) responseHeaders.set("Retry-After", result.retryAfter);
        return new Response(result.status === 204 ? null : result.bodyBase64 ? decodeBase64(result.bodyBase64) : result.body, {
          status: result.status,
          headers: responseHeaders,
        });
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : String(reason);
        throw new Error(`无法连接本地服务（${url.origin}${url.pathname}）：${detail}`);
      }
    }
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: RequestInit = {},
  timeoutMs = DEFAULT_API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  let timedOut = false;
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await tauriAwareFetch(input, { ...options, signal: controller.signal });
    const authorization = new Headers(options.headers).get("Authorization");
    if (response.status === 401 && authorization?.startsWith("Bearer ")) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token: authorization.slice(7) } }));
    }
    return response;
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
      let message = `${path} 请求失败（${response.status}） @ ${apiBase}`;
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
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw new ApiError(message, response.status, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 0);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  };
}
