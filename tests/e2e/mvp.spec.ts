import { test, expect } from "@playwright/test";

test("creates four emotion cards and reaches a four-page PDF", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "喜怒哀楽 本音カード" })).toBeVisible();
  for (const emotion of ["喜", "怒", "哀", "楽"]) {
    await page.getByLabel(`${emotion} 本音`).fill(`${emotion}の本人の本音`);
  }
  await page.getByLabel("AI処理に同意します").check();
  await page.getByRole("button", { name: "入力を保存" }).click();
  await page.getByRole("button", { name: "4文章を生成" }).click();
  await expect(page.getByRole("heading", { name: "文章を確認・編集" })).toBeVisible();
  await page.getByRole("button", { name: "4件すべてを承認して画像生成" }).click();
  await expect(page.getByRole("heading", { name: "PDFの準備ができました" })).toBeVisible();
  const download = await page.request.get("/api/download");
  expect(download.ok()).toBe(true);
  expect((await download.body()).subarray(0, 5).toString()).toBe("%PDF-");
});
