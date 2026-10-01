import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:4184" });

test("new account imports, corrects and reviews knowledge through the real backend", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("邮箱", { exact: true }).fill("reader@local.test");
  await page.getByLabel("密码", { exact: true }).fill("synthetic-test-password");
  await page.getByLabel("确认密码", { exact: true }).fill("synthetic-test-password");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: /reader/ })).toBeVisible();
  await page.goto("/#/library");
  await page.getByLabel("导入文件").setInputFiles([
    { name: "reading.md", mimeType: "text/markdown", buffer: Buffer.from("阅读结论：每周整理问题，联系 reader@example.test。") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("辅助笔记：按主题整理资料。") }
  ]);
  const list = page.getByRole("list", { name: "资料来源列表" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "预览 reading" }).click();
  const preview = page.getByLabel("来源预览");
  await expect(preview).toContainText("reader@example.test");
  await page.getByRole("button", { name: "编辑正文", exact: true }).click();
  await page.getByLabel("编辑资料正文").fill("阅读结论：每周整理一次阅读笔记，联系 reader@example.test。");
  await page.getByRole("button", { name: "保存正文", exact: true }).click();
  await expect(preview).toContainText("正文已校正");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载原文件" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("reading.md");
  await page.goto("/#/chat");
  const composer = page.getByRole("textbox", { name: "输入消息" });
  await composer.fill("根据我的知识库回答阅读结论");
  await page.getByRole("button", { name: "发送" }).click();
  const log = page.getByRole("log");
  await expect(log).toContainText("每周整理一次阅读笔记");
  await expect(log).not.toContainText("reader@example.test");
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await composer.fill("记住每周整理一次阅读笔记");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(log).toContainText("等待你确认");
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await page.goto("/#/library");
  await expect(page.getByLabel("待确认内容")).toContainText("每周整理一次阅读笔记");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByLabel("待确认内容")).toHaveCount(0);
  const first = list.getByRole("listitem").filter({ hasText: "reading" });
  await expect(first.getByRole("checkbox", { name: "启用" })).toBeChecked();
  await first.getByRole("checkbox", { name: "启用" }).click();
  await expect(first.getByRole("checkbox", { name: "启用" })).not.toBeChecked();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除 notes" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await page.reload();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(first.getByRole("checkbox", { name: "启用" })).not.toBeChecked();
});
