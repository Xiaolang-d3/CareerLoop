import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await import("../boss-extractor.js");

const extractor = globalThis.BossCopilotBossExtractor;

test("canonical URL removes transient BOSS query parameters", () => {
  assert.equal(
    extractor.canonicalJobUrl(
      "https://www.zhipin.com/job_detail/abc.html?securityId=temporary"
    ),
    "https://www.zhipin.com/job_detail/abc.html"
  );
});

test("classifies BOSS security page before login path", () => {
  assert.equal(
    extractor.classifyPageFromText(
      "https://www.zhipin.com/web/passport/zp/security.html",
      "BOSS直聘",
      "请完成安全验证"
    ),
    "captcha"
  );
});

test("classifies visible job detail content", () => {
  assert.equal(
    extractor.classifyPageFromText(
      "https://www.zhipin.com/job_detail/abc.html",
      "AI智能体应用开发工程师招聘",
      "职位描述 负责端云智能体架构设计、大模型选择、数据处理和系统集成。"
    ),
    "job_detail"
  );
});

test("normalizes control characters and whitespace", () => {
  assert.equal(
    extractor.normalizeText("职位\u0000描述 \n  负责  Agent   开发"),
    "职位描述\n负责 Agent 开发"
  );
});

test("captures the company from the scoped BOSS company card", () => {
  const nodes = new Map([
    [".job-banner h1", { innerText: "AI智能体应用开发工程师" }],
    [".job-banner .salary", { innerText: "15-30K" }],
    [".sider-company .company-info", { innerText: "华勤技术股份有限公司" }],
    [".job-banner .text-city", { innerText: "上海" }],
    [".job-sec-text", {
      innerText: "负责端云智能体架构设计、大模型选择、数据处理和系统集成。"
    }],
    [".location-address", { innerText: "上海市嘉定区安研路201号" }]
  ]);
  const documentValue = {
    body: {
      innerText: "AI智能体应用开发工程师 15-30K 上海 职位描述 负责端云智能体架构设计、大模型选择、数据处理和系统集成。"
    },
    location: {
      href: "https://www.zhipin.com/job_detail/abc.html?securityId=temporary"
    },
    title: "「AI智能体应用开发工程师招聘」_华勤技术股份有限公司招聘-BOSS直聘",
    querySelector(selector) {
      return nodes.get(selector) || null;
    },
    querySelectorAll() {
      return [];
    }
  };

  const capture = extractor.capture(
    documentValue,
    "https://www.zhipin.com/job_detail/abc.html?securityId=temporary"
  );

  assert.equal(capture.page_type, "job_detail");
  assert.equal(capture.hints.company_name, "华勤技术股份有限公司");
  assert.match(capture.visible_text, /公司名称：华勤技术股份有限公司/);
});

test("manifest keeps sensitive browser permissions disabled", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8")
  );
  const permissions = new Set(manifest.permissions || []);
  for (const forbidden of [
    "cookies",
    "history",
    "webRequest",
    "nativeMessaging"
  ]) {
    assert.equal(permissions.has(forbidden), false);
  }
  assert.deepEqual(manifest.host_permissions, [
    "http://127.0.0.1:5173/*",
    "http://localhost:5173/*",
    "http://127.0.0.1:8000/*",
    "http://localhost:8000/*",
    "https://*.zhipin.com/*"
  ]);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
});

test("background opens a requested supported job page and reuses matching tabs", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(source, /BOSSCOPILOT_OPEN_JOB_REQUEST/);
  assert.match(source, /chrome\.tabs\.query\(\{ active: true, lastFocusedWindow: true \}\)/);
  assert.match(source, /chrome\.tabs\.create\(\{ url: requestedUrl, active: true \}\)/);
  assert.match(source, /chrome\.tabs\.update\(existing\.id, \{ active: true \}\)/);
  assert.match(source, /targetJobTab\(message\.tabId\)/);
  assert.doesNotMatch(source, /chrome\.(cookies|history|webRequest)/);
});
