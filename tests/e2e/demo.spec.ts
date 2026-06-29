import { expect, test } from "@playwright/test";

test("starts a complete demo-mode flight", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "FlyBike" })).toBeVisible();
  await expect(page.locator("#game-host canvas")).toHaveAttribute("width", "960");
  await expect(page.locator("#game-host canvas")).toHaveAttribute("height", "540");
  await page.getByRole("button", { name: "Play with keys / touch" }).click();
  await expect(page.getByRole("heading", { name: "Demo controls" })).toBeVisible();
  await page.getByRole("button", { name: "Start flight" }).click();
  await expect(page.getByRole("heading", { name: "Select level" })).toBeVisible();
  await page.getByRole("button", { name: /Ornithopter Run/ }).click();
  await expect(page.locator("#hud")).toBeVisible({ timeout: 5_000 });
  await page.keyboard.down("Space");
  await expect(page.locator("#power-value")).toHaveText("260");
  await page.keyboard.up("Space");
});

test("returns from level selection to controller setup", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play with keys / touch" }).click();
  await page.getByRole("button", { name: "Start flight" }).click();
  await expect(page.getByRole("heading", { name: "Select level" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Demo controls" })).toBeVisible();
});

test("persists the mute preference", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sound on" }).click();
  await expect(page.getByRole("button", { name: "Sound off" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sound off" })).toBeVisible();
});
