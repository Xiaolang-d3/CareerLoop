import type { BrowserJobCapture } from "../../types";

const PAGE_SOURCE = "bosscopilot-page";
const EXTENSION_SOURCE = "bosscopilot-extension";
const PROTOCOL_VERSION = "browser-job-capture-v1";

type ExtensionMessage = {
  source?: string;
  type?: string;
  requestId?: string;
  protocolVersion?: string;
  capabilities?: string[];
  tabId?: number;
  opened?: boolean;
  reused?: boolean;
  capture?: BrowserJobCapture | BrowserVisibleJobsCapture;
  error?: {
    code?: string;
    message?: string;
  };
};

export type BrowserVisibleJobsCapture = {
  schema_version: "browser-visible-jobs-v2";
  platform: "boss" | "liepin" | "zhaopin" | "51job" | "generic_browser";
  page_url: string;
  page_title: string;
  captured_at: string;
  stop_reason: string;
  jobs: Array<{
    external_id: string; job_title: string; company_name: string; location: string;
    salary_text: string; description: string; url: string;
  }>;
};

export class BrowserBridgeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BrowserBridgeError";
    this.code = code;
  }
}

export async function detectBrowserBridge(
  timeoutMs = 800
): Promise<{ available: boolean; capabilities: string[] }> {
  try {
    const response = await requestExtension(
      "BOSSCOPILOT_EXTENSION_PING",
      {},
      ["BOSSCOPILOT_EXTENSION_PONG"],
      timeoutMs
    );
    return {
      available: response.protocolVersion === PROTOCOL_VERSION,
      capabilities: response.capabilities || []
    };
  } catch {
    return { available: false, capabilities: [] };
  }
}

export type BrowserJobOpenResult = {
  tabId: number;
  opened: boolean;
  reused: boolean;
};

export async function openBrowserJobPage(
  requestedUrl: string,
  timeoutMs = 10_000
): Promise<BrowserJobOpenResult> {
  const response = await requestExtension(
    "BOSSCOPILOT_OPEN_JOB_REQUEST",
    { requestedUrl },
    ["BOSSCOPILOT_OPEN_JOB_RESULT", "BOSSCOPILOT_OPEN_JOB_ERROR"],
    timeoutMs
  );
  const tabId = response.tabId;
  if (
    response.type === "BOSSCOPILOT_OPEN_JOB_ERROR"
    || typeof tabId !== "number"
    || !Number.isInteger(tabId)
  ) {
    throw new BrowserBridgeError(
      response.error?.code || "open_failed",
      response.error?.message || "无法打开岗位页面"
    );
  }
  return {
    tabId,
    opened: response.opened === true,
    reused: response.reused === true
  };
}

export async function captureBrowserJobPage(
  requestedUrl = "",
  tabId?: number,
  timeoutMs = 15_000
): Promise<BrowserJobCapture> {
  const response = await requestExtension(
    "BOSSCOPILOT_CAPTURE_REQUEST",
    { requestedUrl, ...(tabId ? { tabId } : {}) },
    ["BOSSCOPILOT_CAPTURE_RESULT", "BOSSCOPILOT_CAPTURE_ERROR"],
    timeoutMs
  );
  if (response.type === "BOSSCOPILOT_CAPTURE_ERROR" || !response.capture) {
    throw new BrowserBridgeError(
      response.error?.code || "capture_failed",
      response.error?.message || "浏览器岗位读取失败"
    );
  }
  return response.capture as BrowserJobCapture;
}

export async function captureVisibleJobs(
  timeoutMs = 15_000
): Promise<BrowserVisibleJobsCapture> {
  const response = await requestExtension(
    "BOSSCOPILOT_CAPTURE_VISIBLE_JOBS_REQUEST",
    {},
    ["BOSSCOPILOT_CAPTURE_RESULT", "BOSSCOPILOT_CAPTURE_ERROR"],
    timeoutMs
  );
  if (response.type === "BOSSCOPILOT_CAPTURE_ERROR" || !response.capture) {
    throw new BrowserBridgeError(
      response.error?.code || "capture_failed",
      response.error?.message || "当前可见岗位读取失败"
    );
  }
  return response.capture as BrowserVisibleJobsCapture;
}

function requestExtension(
  type: string,
  payload: Record<string, unknown>,
  responseTypes: string[],
  timeoutMs: number
): Promise<ExtensionMessage> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new BrowserBridgeError("capture_timeout", "浏览器助手响应超时"));
    }, timeoutMs);

    const onMessage = (event: MessageEvent<ExtensionMessage>) => {
      if (
        event.source !== window
        || event.origin !== window.location.origin
        || event.data?.source !== EXTENSION_SOURCE
        || event.data.requestId !== requestId
        || !responseTypes.includes(event.data.type || "")
      ) {
        return;
      }
      cleanup();
      resolve(event.data);
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type,
        requestId,
        ...payload
      },
      window.location.origin
    );
  });
}
