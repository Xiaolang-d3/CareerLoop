(function registerVisibleJobsExtractor(root) {
  const MAX_JOBS = 100;
  const PLATFORM_CONFIG = {
    boss: {
      hosts: ["zhipin.com"],
      cards: ".job-card-wrapper,.job-card-box,.search-job-result li",
      title: ".job-name,.job-title,a[href*='/job_detail/']",
      company: ".company-name,.company-info",
      location: ".job-area,.job-location",
      salary: ".salary",
      link: "a[href*='/job_detail/']"
    }
  };

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function detectPlatform(urlValue) {
    let host = "";
    try { host = new URL(urlValue).hostname.toLowerCase(); } catch { return "generic_browser"; }
    for (const [name, config] of Object.entries(PLATFORM_CONFIG)) {
      if (config.hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) return name;
    }
    return "generic_browser";
  }

  function stoppedPage(documentValue) {
    const url = documentValue.location?.href || "";
    const visible = clean(documentValue.body?.innerText).slice(0, 3000).toLowerCase();
    const combined = `${url}\n${documentValue.title || ""}\n${visible}`.toLowerCase();
    if (["验证码", "安全验证", "人机验证", "captcha"].some((term) => combined.includes(term))) return "captcha";
    if (["登录后查看", "请先登录", "登录/注册"].some((term) => combined.includes(term))) return "login_required";
    return "";
  }

  function visibleNode(node) {
    if (!node || node.hidden || node.getAttribute?.("aria-hidden") === "true") return false;
    if (node.closest?.("[hidden],[aria-hidden='true']")) return false;
    return true;
  }

  function field(card, selector) {
    return clean(card.querySelector?.(selector)?.innerText || card.querySelector?.(selector)?.textContent);
  }

  function capture(documentValue) {
    const pageUrl = documentValue.location?.href || "";
    const platform = detectPlatform(pageUrl);
    const stopReason = stoppedPage(documentValue);
    if (stopReason) {
      return { schema_version: "browser-visible-jobs-v2", platform, page_url: pageUrl, page_title: clean(documentValue.title), captured_at: new Date().toISOString(), stop_reason: stopReason, jobs: [] };
    }
    const config = PLATFORM_CONFIG[platform];
    if (!config) throw new Error("当前页面不是受支持的中国招聘平台");
    const cards = Array.from(documentValue.querySelectorAll(config.cards)).filter(visibleNode).slice(0, MAX_JOBS);
    const jobs = cards.map((card) => {
      const link = card.querySelector?.(config.link);
      let url = "";
      try { url = new URL(link?.href || link?.getAttribute?.("href") || "", pageUrl).href; } catch { url = pageUrl; }
      return {
        external_id: clean(card.getAttribute?.("data-job-id") || card.dataset?.jobid || ""),
        job_title: field(card, config.title),
        company_name: field(card, config.company),
        location: field(card, config.location),
        salary_text: field(card, config.salary),
        description: clean(card.innerText || card.textContent).slice(0, 5000),
        url
      };
    }).filter((job) => job.job_title);
    return {
      schema_version: "browser-visible-jobs-v2",
      platform,
      page_url: pageUrl,
      page_title: clean(documentValue.title),
      captured_at: new Date().toISOString(),
      stop_reason: jobs.length ? "" : "no_visible_job_cards",
      jobs
    };
  }

  root.BossCopilotVisibleJobsExtractor = { detectPlatform, stoppedPage, capture };
})(globalThis);
