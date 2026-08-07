import assert from "node:assert/strict";
import test from "node:test";

await import("../visible-jobs-extractor.js");
const extractor = globalThis.BossCopilotVisibleJobsExtractor;

test("detects BOSS as the supported recruiting platform", () => {
  assert.equal(extractor.detectPlatform("https://www.zhipin.com/web/geek/job"), "boss");
  assert.equal(extractor.detectPlatform("https://www.liepin.com/zhaopin/"), "generic_browser");
});

test("stops on login and captcha content", () => {
  const base = { location: { href: "https://www.zhipin.com/web/geek/job" }, title: "招聘", body: { innerText: "" } };
  assert.equal(extractor.stoppedPage({ ...base, body: { innerText: "请先登录" } }), "login_required");
  assert.equal(extractor.stoppedPage({ ...base, body: { innerText: "请完成安全验证" } }), "captcha");
});

test("reads only the supplied currently rendered cards", () => {
  const fields = {
    ".job-name,.job-title,a[href*='/job_detail/']": { innerText: "AI 产品经理" },
    ".company-name,.company-info": { innerText: "示例科技" },
    ".job-area,.job-location": { innerText: "上海" },
    ".salary": { innerText: "30-45K" },
    "a[href*='/job_detail/']": { href: "https://www.zhipin.com/job_detail/abc.html" }
  };
  const card = {
    innerText: "AI 产品经理 示例科技 上海 30-45K",
    hidden: false,
    dataset: { jobid: "abc" },
    getAttribute() { return null; },
    closest() { return null; },
    querySelector(selector) { return fields[selector] || null; }
  };
  const documentValue = {
    location: { href: "https://www.zhipin.com/web/geek/job" },
    title: "岗位搜索",
    body: { innerText: "岗位搜索结果" },
    querySelectorAll() { return [card]; }
  };
  const capture = extractor.capture(documentValue);
  assert.equal(capture.jobs.length, 1);
  assert.equal(capture.jobs[0].job_title, "AI 产品经理");
  assert.equal(capture.jobs[0].external_id, "abc");
});
