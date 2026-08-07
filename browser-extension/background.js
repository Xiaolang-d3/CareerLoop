const PROTOCOL_VERSION = "browser-job-capture-v1";
const DEFAULT_API_BASE = "http://127.0.0.1:8000";

async function backendApiBase() {
  const stored = await chrome.storage.local.get("apiBase");
  const value = String(stored.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.origin;
  } catch {
    // Invalid user input falls back to the explicitly local default.
  }
  return DEFAULT_API_BASE;
}

function canonicalJobUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    if (
      (url.hostname === "zhipin.com" || url.hostname.endsWith(".zhipin.com"))
      && url.pathname.toLowerCase().includes("/job_detail/")
    ) {
      url.search = "";
    }
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/$/, "") || "/"}`;
  } catch {
    return "";
  }
}

async function openJobPage(message) {
  const requestedUrl = String(message.requestedUrl || "");
  const canonicalRequested = canonicalJobUrl(requestedUrl);
  if (!canonicalRequested) {
    return {
      ok: false,
      error: { code: "invalid_url", message: "岗位链接不合法" }
    };
  }

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const existing = tabs.find((tab) => canonicalJobUrl(tab.url || "") === canonicalRequested);
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    return { ok: true, tabId: existing.id, opened: false, reused: true };
  }

  const created = await chrome.tabs.create({ url: requestedUrl, active: true });
  if (!created.id) {
    return {
      ok: false,
      error: { code: "open_failed", message: "无法打开岗位页面" }
    };
  }
  return { ok: true, tabId: created.id, opened: true, reused: false };
}

async function captureJobPage(message) {
  const requestedUrl = String(message.requestedUrl || "");
  const target = await targetJobTab(message.tabId);
  const targetUrl = String(target?.url || "");
  const canonicalRequested = canonicalJobUrl(requestedUrl || targetUrl);
  if (!target || !canonicalRequested || (requestedUrl && canonicalJobUrl(targetUrl) !== canonicalRequested)) {
    return {
      ok: false,
      error: {
        code: "active_tab_mismatch",
        message: "请先在打开的岗位标签页中完成登录，再点击继续读取"
      }
    };
  }
  try {
    const result = await chrome.tabs.sendMessage(target.id, {
      type: "BOSSCOPILOT_CAPTURE_PAGE",
      requestedUrl: requestedUrl || targetUrl
    });
    return result && typeof result === "object"
      ? result
      : {
          ok: false,
          error: {
            code: "capture_failed",
            message: "浏览器页面没有返回读取结果"
          }
        };
  } catch {
    return {
      ok: false,
      error: {
        code: "capture_unavailable",
        message: "岗位页面尚未准备好，请刷新页面后重试"
      }
    };
  }
}

async function targetJobTab(tabId) {
  if (Number.isInteger(tabId) && tabId > 0) {
    try {
      const tab = await chrome.tabs.get(tabId);
      return isSupportedJobTab(tab) ? tab : null;
    } catch {
      return null;
    }
  }
  return activeSupportedTab();
}

function isSupportedJobTab(tab) {
  if (!tab?.id) return false;
  try {
    const hostname = new URL(tab.url || "").hostname.toLowerCase();
    return hostname === "zhipin.com" || hostname.endsWith(".zhipin.com");
  } catch {
    return false;
  }
}

async function activeSupportedTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  return isSupportedJobTab(tab) ? tab : null;
}

async function captureVisibleJobs() {
  const tab = await activeSupportedTab();
  if (!tab) {
    return { ok: false, error: { code: "active_tab_unsupported", message: "请先打开并停留在 BOSS 直聘的岗位页面" } };
  }
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "BOSSCOPILOT_CAPTURE_VISIBLE_JOBS" });
    return result && typeof result === "object" ? result : { ok: false, error: { code: "capture_failed", message: "当前页面没有返回可见岗位" } };
  } catch {
    return { ok: false, error: { code: "capture_unavailable", message: "当前活动页面尚未准备好，请刷新后重试" } };
  }
}

async function importCurrentJob(tabId) {
  const tab = await targetJobTab(tabId);
  if (!tab) {
    return { ok: false, error: { code: "active_tab_unsupported", message: "请先打开支持平台的招聘页面" } };
  }
  if (pageKind(tab.url || "") === "list") return importVisibleJobs(tab);
  const captured = await captureJobPage({ tabId });
  if (!captured?.ok || !captured.capture) return captured;
  try {
    const response = await fetch(`${await backendApiBase()}/opportunities/browser-detail-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...captured.capture, user_initiated: true })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: { code: "import_failed", message: result?.detail || "岗位收件箱暂时无法接收数据" }
      };
    }
    return { ok: true, job: result.job, run: result.run };
  } catch {
    return {
      ok: false,
      error: { code: "backend_unavailable", message: "无法连接本机 BossCopilot 服务，请确认后端已启动" }
    };
  }
}

async function importVisibleJobs(tab) {
  try {
    const captured = await chrome.tabs.sendMessage(tab.id, { type: "BOSSCOPILOT_CAPTURE_VISIBLE_JOBS" });
    if (!captured?.ok || !captured.capture) return captured;
    if (captured.capture.stop_reason) {
      return { ok: false, error: { code: captured.capture.stop_reason, message: "当前页面没有可导入的岗位卡片" } };
    }
    const response = await fetch(`${await backendApiBase()}/opportunities/visible-page-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...captured.capture, user_initiated: true })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: { code: "import_failed", message: result?.detail || "岗位收件箱暂时无法接收数据" } };
    }
    return { ok: true, importedCount: result.imported?.length || 0, run: result.run };
  } catch {
    return { ok: false, error: { code: "backend_unavailable", message: "无法连接本机 BossCopilot 服务，请确认后端已启动" } };
  }
}

function pageKind(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    if (url.hostname === "zhipin.com" || url.hostname.endsWith(".zhipin.com")) {
      if (path === "/" || path === "") return "home";
    }
    if (path.includes("/job_detail/")) return "detail";
    if (path.includes("/jobs") || path.includes("/job")) return "list";
  } catch {
    return "unknown";
  }
  return "unknown";
}

async function openJobSearch(tabId) {
  const tab = await targetJobTab(tabId);
  if (!tab?.id) {
    return { ok: false, error: { code: "active_tab_unsupported", message: "请先打开 BOSS 页面" } };
  }
  await chrome.tabs.update(tab.id, { url: "https://www.zhipin.com/web/geek/jobs", active: true });
  return { ok: true };
}

async function popupStatus(tabId) {
  const tab = await targetJobTab(tabId);
  if (!tab) {
    return { ok: true, supported: false, message: "请先打开 BOSS 直聘的岗位详情页" };
  }
  return {
    ok: true,
    supported: true,
    pageKind: pageKind(tab.url || ""),
    url: tab.url || "",
    title: tab.title || "当前招聘页面",
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const popupMessageTypes = new Set([
    "BOSSCOPILOT_POPUP_STATUS",
    "BOSSCOPILOT_POPUP_IMPORT_CURRENT",
    "BOSSCOPILOT_POPUP_OPEN_JOB_SEARCH",
  ]);
  const isPageBridgeMessage = message?.source === "bosscopilot-page";
  if (!message || (!isPageBridgeMessage && !popupMessageTypes.has(message.type))) {
    return false;
  }

  if (message.type === "BOSSCOPILOT_EXTENSION_PING") {
    sendResponse({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: ["job_page_capture", "visible_jobs_capture"]
    });
    return false;
  }

  if (message.type === "BOSSCOPILOT_OPEN_JOB_REQUEST") {
    openJobPage(message)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: { code: "open_failed", message: "打开岗位页面失败" } }));
    return true;
  }

  if (message.type === "BOSSCOPILOT_CAPTURE_REQUEST") {
    captureJobPage(message)
      .then(sendResponse)
      .catch(() => {
        sendResponse({
          ok: false,
          error: {
            code: "capture_failed",
            message: "浏览器读取执行失败"
          }
        });
      });
    return true;
  }

  if (message.type === "BOSSCOPILOT_CAPTURE_VISIBLE_JOBS_REQUEST") {
    captureVisibleJobs().then(sendResponse).catch(() => sendResponse({ ok: false, error: { code: "capture_failed", message: "当前可见岗位读取失败" } }));
    return true;
  }

  if (message.type === "BOSSCOPILOT_POPUP_STATUS") {
    popupStatus(message.tabId).then(sendResponse);
    return true;
  }

  if (message.type === "BOSSCOPILOT_POPUP_IMPORT_CURRENT") {
    importCurrentJob(message.tabId).then(sendResponse);
    return true;
  }

  if (message.type === "BOSSCOPILOT_POPUP_OPEN_JOB_SEARCH") {
    openJobSearch(message.tabId).then(sendResponse);
    return true;
  }

  return false;
});
