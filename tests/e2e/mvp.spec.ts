import { test, expect } from "@playwright/test";

test("starts a mock session and reaches the hearing screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "彼氏に伝えたいことは？" })).toBeVisible();
  await page.getByLabel("伝えたいこと").fill("いつも話を聞いてくれてありがとう");
  await page.getByLabel("この内容をAIで処理することに同意します").check();
  await page.getByRole("button", { name: "ヒアリングを始める" }).click();
  await expect(page.getByText("質問 1/5")).toBeVisible();
  await expect(page.getByRole("button", { name: "次へ" })).toHaveCount(0);
});
