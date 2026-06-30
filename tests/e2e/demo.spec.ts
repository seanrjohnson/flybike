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
  await expect(page.getByLabel("Ride statistics")).toBeVisible();
  await expect(page.locator("#run-time")).toHaveText(/^00:0\d$/);
  await expect(page.locator("#session-time")).toHaveText("0");
  await expect(page.locator("#run-distance")).toHaveText(/^0\.0\d$/);
  await expect(page.locator("#session-distance")).toHaveText(/^0\.0\d$/);
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

test("starts the Asteroids level with its own score label", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play with keys / touch" }).click();
  await page.getByRole("button", { name: "Start flight" }).click();
  await page.getByRole("button", { name: /Asteroids/ }).click();
  await expect(page.locator("#hud")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#score-label")).toHaveText("asteroids");
});

test("starts the Racer level with lap scoring", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play with keys / touch" }).click();
  await page.getByRole("button", { name: "Start flight" }).click();
  await page.getByRole("button", { name: /Racer/ }).click();
  await expect(page.locator("#hud")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#score-label")).toHaveText("laps");
  await expect(page.getByRole("heading", { name: "Racer over" })).not.toBeVisible();
});

test("configures and starts Hill Climber", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play with keys / touch" }).click();
  await page.getByRole("button", { name: "Start flight" }).click();
  await page.getByRole("button", { name: /Hill Climber/ }).click();
  await expect(page.getByRole("heading", { name: "Terrain setup" })).toBeVisible();
  await expect(page.getByLabel("Physical terrain resistance")).toBeDisabled();
  await page.getByRole("button", { name: "Start climb" }).click();
  await expect(page.locator("#hud")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#score-label")).toHaveText("km");
});

test("persists the mute preference", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sound on" }).click();
  await expect(page.getByRole("button", { name: "Sound off" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sound off" })).toBeVisible();
});
