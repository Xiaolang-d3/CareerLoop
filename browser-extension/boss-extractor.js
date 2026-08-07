(function registerBossExtractor(root) {
  const MAX_VISIBLE_TEXT = 50000;

  function normalizeText(value) {
    return String(value || "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  function compact(value) {
    return normalizeText(value).replace(/\s+/g, " ").trim();
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

  function classifyPageFromText(urlValue, titleValue, textValue) {
    let path = "";
    try {
      path = new URL(urlValue).pathname.toLowerCase();
    } catch {
      path = "";
    }
    const title = compact(titleValue).toLowerCase();
    const text = compact(textValue).slice(0, 3000).toLowerCase();
    const combined = `${title}\n${text}`;
    if (
      path.includes("/web/passport/zp/security")
      || ["安全验证", "人机验证", "访问验证", "captcha"].some((item) => combined.includes(item))
    ) {
      return "captcha";
    }
    if (
      path.includes("/login")
      || ["登录后查看", "登录/注册", "请先登录"].some((item) => combined.includes(item))
    ) {
      return "login_required";
    }
    if (
      ["职位已下架", "岗位已下架", "职位不存在", "停止招聘"].some((item) => combined.includes(item))
    ) {
      return "job_expired";
    }
    if (
      path.includes("/job_detail/")
      && combined.includes("职位描述")
      && text.length >= 25
    ) {
      return "job_detail";
    }
    if (!text || text.length < 40) return "empty_page";
    return "unknown";
  }

  function textOf(node) {
    return node ? normalizeText(node.innerText || node.textContent || "") : "";
  }

  function firstText(documentValue, selectors) {
    for (const selector of selectors) {
      const node = documentValue.querySelector(selector);
      const value = textOf(node);
      if (value) return value;
    }
    return "";
  }

  function findHeading(documentValue, expected) {
    const compactExpected = expected.replace(/\s+/g, "");
    return Array.from(documentValue.querySelectorAll("h1,h2,h3,h4"))
      .find((node) => compact(textOf(node)).replace(/\s+/g, "").includes(compactExpected));
  }

  function sectionText(documentValue, headingText, preferredSelectors) {
    const preferred = firstText(documentValue, preferredSelectors);
    if (preferred) return preferred;
    const heading = findHeading(documentValue, headingText);
    if (!heading) return "";
    const section = heading.closest(
      "section,.job-sec,.job-detail-section,.detail-section"
    ) || heading.parentElement;
    return textOf(section);
  }

  function capture(documentValue, requestedUrl) {
    const finalUrl = documentValue.location?.href || "";
    const pageText = textOf(documentValue.body).slice(0, 6000);
    const pageType = classifyPageFromText(
      finalUrl,
      documentValue.title,
      pageText
    );

    const jobTitle = firstText(documentValue, [
      ".job-banner h1",
      ".job-primary h1",
      ".job-name",
      "h1"
    ]);
    const salaryText = firstText(documentValue, [
      ".job-banner .salary",
      ".job-primary .salary",
      ".salary"
    ]);
    const companyName = firstText(documentValue, [
      ".sider-company .company-info",
      ".job-sider .company-info",
      ".company-info a[href*='/gongsi/']",
      ".sider-company a[href*='/gongsi/']",
      ".job-detail-company a[href*='/gongsi/']",
      "a[href*='/gongsi/']"
    ]);
    const location = firstText(documentValue, [
      ".job-banner .text-city",
      ".job-primary .text-city",
      ".job-location",
      ".location-address"
    ]);
    const description = sectionText(documentValue, "职位描述", [
      ".job-sec-text",
      ".job-detail-section .job-sec-text",
      "[class*='job-sec-text']"
    ]).replace(/^职\s*位描述\s*/u, "");
    const benefits = firstText(documentValue, [
      ".job-tags",
      ".job-banner .tag-list",
      "[class*='job-tags']"
    ]);
    const address = sectionText(documentValue, "工作地址", [
      ".location-address",
      "[class*='location-address']"
    ]).replace(/^工作地址\s*/u, "");
    const summary = firstText(documentValue, [
      ".job-banner .job-info",
      ".job-primary .job-limit",
      ".job-primary"
    ]);
    const scopedText = normalizeText(
      [
        jobTitle,
        salaryText,
        summary,
        `公司名称：${companyName}`,
        `工作地点：${location}`,
        "职位描述",
        description,
        benefits ? `福利：${benefits}` : "",
        address ? `工作地址：${address}` : ""
      ].filter(Boolean).join("\n")
    ).slice(0, MAX_VISIBLE_TEXT);

    return {
      schema_version: "browser-job-capture-v1",
      capture_id: crypto.randomUUID(),
      requested_url: requestedUrl,
      final_url: finalUrl,
      platform: "boss",
      page_type: pageType,
      title: compact(documentValue.title),
      visible_text: scopedText,
      hints: {
        job_title: jobTitle,
        company_name: companyName,
        location,
        salary_text: salaryText,
        description
      },
      captured_at: new Date().toISOString(),
      truncated: scopedText.length >= MAX_VISIBLE_TEXT
    };
  }

  root.BossCopilotBossExtractor = {
    canonicalJobUrl,
    classifyPageFromText,
    normalizeText,
    capture
  };
})(globalThis);
