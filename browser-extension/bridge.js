const PAGE_SOURCE = "bosscopilot-page";
const EXTENSION_SOURCE = "bosscopilot-extension";
const ALLOWED_TYPES = new Set([
  "BOSSCOPILOT_EXTENSION_PING",
  "BOSSCOPILOT_OPEN_JOB_REQUEST",
  "BOSSCOPILOT_CAPTURE_REQUEST",
  "BOSSCOPILOT_CAPTURE_VISIBLE_JOBS_REQUEST"
]);

function postToPage(payload) {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      ...payload
    },
    window.location.origin
  );
}

postToPage({
  type: "BOSSCOPILOT_EXTENSION_HELLO",
  protocolVersion: "browser-job-capture-v1",
  capabilities: ["job_page_open", "job_page_capture", "visible_jobs_capture"]
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (
    !message
    || message.source !== PAGE_SOURCE
    || !ALLOWED_TYPES.has(message.type)
  ) {
    return;
  }

  const requestId = String(message.requestId || "");
  chrome.runtime.sendMessage(message, (result) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      postToPage({
        type: "BOSSCOPILOT_CAPTURE_ERROR",
        requestId,
        error: {
          code: "extension_unavailable",
          message: "浏览器助手连接已中断"
        }
      });
      return;
    }
    const isPing = message.type === "BOSSCOPILOT_EXTENSION_PING";
    const isOpen = message.type === "BOSSCOPILOT_OPEN_JOB_REQUEST";
    postToPage({
      type: isPing
        ? "BOSSCOPILOT_EXTENSION_PONG"
        : isOpen
          ? result?.ok
            ? "BOSSCOPILOT_OPEN_JOB_RESULT"
            : "BOSSCOPILOT_OPEN_JOB_ERROR"
          : result?.ok
            ? "BOSSCOPILOT_CAPTURE_RESULT"
            : "BOSSCOPILOT_CAPTURE_ERROR",
      requestId,
      protocolVersion: result?.protocolVersion,
      capabilities: result?.capabilities,
      capture: result?.capture,
      tabId: result?.tabId,
      opened: result?.opened,
      reused: result?.reused,
      error: result?.error
    });
  });
});
