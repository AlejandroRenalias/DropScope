import type { Page } from "@playwright/test";

// The run replay keeps its tools in tabs and its demo runs in the run source menu; these open them.
export async function openTool(
  page: Page,
  name: "Events" | "Budget replay" | "Claim check" | "Compare runs" | "Importer notes",
): Promise<void> {
  await page.getByRole("tablist", { name: "Tools" }).getByRole("tab", { name }).click();
}

export async function chooseRun(page: Page, name: "Built-in demo run" | "Demo run with content stored"): Promise<void> {
  await page.getByRole("button", { name: /Choose a run/ }).click();
  await page.getByRole("button", { name }).click();
}
