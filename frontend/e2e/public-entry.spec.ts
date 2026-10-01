import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("a centered sign-in card links to a public product page on desktop and mobile", async ({ page }) => {
  await page.route("**/auth/config", (route) => route.fulfill({ json: { enabled: true, setup_required: false, registration_open: true } }));
  const evidenceDir = resolve("..", "..", "output", "playwright");
  await mkdir(evidenceDir, { recursive: true });
  await page.goto("/");

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "登录本地账户" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /从真实资料出发/ })).toHaveCount(0);
    const card = await page.locator(".auth-card").boundingBox();
    expect(card).not.toBeNull();
    expect(card!.x + card!.width / 2).toBeCloseTo(viewport.width / 2, 0);
    expect(Math.abs(card!.y + card!.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(4);
    expect(card!.width).toBeLessThanOrEqual(420);
    await page.screenshot({ path: resolve(evidenceDir, `login-only-${viewport.width}.png`), animations: "disabled" });
    await page.getByRole("link", { name: /了解 CareerLoop/ }).click();
    await expect(page).toHaveURL(/#\/about$/);
    await expect(page.getByRole("heading", { name: /从真实资料出发/ })).toBeVisible();
    await expect(page.getByLabel("邮箱", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await page.locator(".product-intro-page").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: resolve(evidenceDir, `product-intro-${viewport.width}.png`), animations: "disabled" });
    await page.goBack();
    await expect(page.getByRole("heading", { name: "登录本地账户" })).toBeVisible();
  }

  await page.route("**/auth/**", (route) => route.abort());
  await page.goto("/#/about");
  await page.reload();
  await expect(page.getByRole("heading", { name: /从真实资料出发/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回登录" })).toBeVisible();
});
