import { expect, type Locator, type Page } from "@playwright/test";

type PictureOptions = Parameters<ReturnType<typeof expect<Page>>["toHaveScreenshot"]>[1];

// Picture baselines are recorded on Windows only. Set DROPSCOPE_SKIP_PICTURES=1 (as the Linux CI job does) to run
// the rest of each test without comparing pictures.
export async function expectPicture(target: Page | Locator, name: string, options?: PictureOptions): Promise<void> {
  if (process.env.DROPSCOPE_SKIP_PICTURES === "1") return;
  await expect(target as Locator).toHaveScreenshot(name, options);
}
