chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BOSSCOPILOT_CAPTURE_VISIBLE_JOBS") {
    try {
      const capture = globalThis.BossCopilotVisibleJobsExtractor.capture(document);
      if (capture.stop_reason === "captcha" || capture.stop_reason === "login_required") {
        sendResponse({ ok: false, error: { code: capture.stop_reason, message: "页面出现登录或验证，已停止读取" } });
      } else {
        sendResponse({ ok: true, capture });
      }
    } catch (error) {
      sendResponse({ ok: false, error: { code: "capture_failed", message: error instanceof Error ? error.message : "可见岗位读取失败" } });
    }
    return false;
  }
  if (!message || message.type !== "BOSSCOPILOT_CAPTURE_PAGE") return false;

  try {
    const capture = globalThis.BossCopilotBossExtractor.capture(
      document,
      String(message.requestedUrl || "")
    );
    sendResponse({ ok: true, capture });
  } catch (error) {
    sendResponse({
      ok: false,
      error: {
        code: "capture_failed",
        message: error instanceof Error ? error.message : "岗位页面读取失败"
      }
    });
  }
  return false;
});
