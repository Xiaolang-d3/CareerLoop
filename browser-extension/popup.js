const statusDot = document.querySelector("#status-dot");
const platform = document.querySelector("#platform");
const pageTitle = document.querySelector("#page-title");
const pageUrl = document.querySelector("#page-url");
const message = document.querySelector("#message");
const readButton = document.querySelector("#read-button");
const apiBaseInput = document.querySelector("#api-base");
const saveApiButton = document.querySelector("#save-api");
const apiStatus = document.querySelector("#api-status");
const defaultApiBase = "http://127.0.0.1:8000";

function setMessage(value, tone = "") {
  message.textContent = value;
  message.className = `message ${tone}`;
}

async function send(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return chrome.runtime.sendMessage({ type, tabId: tab?.id });
}

async function loadApiBase() {
  const stored = await chrome.storage.local.get("apiBase");
  apiBaseInput.value = stored.apiBase || defaultApiBase;
}

saveApiButton.addEventListener("click", async () => {
  let origin = "";
  try {
    const parsed = new URL(apiBaseInput.value.trim());
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("协议");
    origin = parsed.origin;
  } catch {
    apiStatus.textContent = "请输入完整的 HTTP 或 HTTPS API 地址。";
    return;
  }
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    apiStatus.textContent = "未获得该服务地址的访问授权。";
    return;
  }
  await chrome.storage.local.set({ apiBase: origin });
  apiBaseInput.value = origin;
  apiStatus.textContent = "已保存。下次读取将连接此 API 地址。";
});

async function refreshStatus() {
  const result = await send("BOSSCOPILOT_POPUP_STATUS");
  if (!result?.supported) {
    statusDot.className = "status-dot error";
    platform.textContent = "未检测到可读取页面";
    pageTitle.textContent = "打开岗位详情页后再试";
    pageUrl.textContent = "当前版本支持 BOSS 直聘";
    setMessage(result?.message || "当前页面不受支持", "error");
    return;
  }
  statusDot.className = "status-dot ready";
  const kind = result.pageKind || "unknown";
  platform.textContent = kind === "detail"
    ? "BOSS 岗位详情页"
    : kind === "list"
      ? "BOSS 岗位列表页"
      : kind === "home"
        ? "BOSS 首页"
      : "招聘页面，读取时将进一步判断";
  pageTitle.textContent = result.title;
  pageUrl.textContent = result.url;
  readButton.textContent = kind === "home"
    ? "打开岗位搜索"
    : kind === "list"
      ? "导入当前可见岗位"
      : "读取当前岗位";
  setMessage(kind === "home"
    ? "首页没有岗位内容。打开岗位搜索后，即可导入当前可见岗位。"
    : kind === "list"
    ? "将导入当前可见的岗位卡片，详情页可稍后补全完整 JD。"
    : "点击读取后，将仅采集当前页面可见的岗位内容。");
  readButton.disabled = false;
}

readButton.addEventListener("click", async () => {
  readButton.disabled = true;
  const isHome = platform.textContent === "BOSS 首页";
  if (isHome) {
    const result = await send("BOSSCOPILOT_POPUP_OPEN_JOB_SEARCH");
    if (result?.ok) {
      setMessage("已打开岗位搜索页。页面加载完成后重新打开扩展即可导入岗位。", "success");
      readButton.textContent = "已打开岗位搜索";
      return;
    }
    setMessage(result?.error?.message || "无法打开岗位搜索页。", "error");
    readButton.textContent = "打开岗位搜索";
    readButton.disabled = false;
    return;
  }
  readButton.textContent = "正在读取并保存…";
  setMessage("正在读取当前页面，并提交到岗位收件箱。");
  const result = await send("BOSSCOPILOT_POPUP_IMPORT_CURRENT");
  if (result?.ok) {
    statusDot.className = "status-dot ready";
    const successText = result.importedCount
      ? `已导入 ${result.importedCount} 个可见岗位，本地初筛已开始。`
      : `已保存：${result.job.company_name || ""} ${result.job.job_title || "岗位"}，本地初筛已开始。`;
    setMessage(successText, "success");
    readButton.textContent = "已读取，可再次刷新";
    readButton.disabled = false;
    return;
  }
  statusDot.className = "status-dot error";
  setMessage(result?.error?.message || "读取失败，请检查当前页面后重试。", "error");
  readButton.textContent = "重新读取当前岗位";
  readButton.disabled = false;
});

Promise.all([loadApiBase(), refreshStatus()]).catch(() => {
  statusDot.className = "status-dot error";
  platform.textContent = "扩展连接异常";
  pageTitle.textContent = "请重新加载扩展";
  setMessage("无法读取当前页面状态。", "error");
});
