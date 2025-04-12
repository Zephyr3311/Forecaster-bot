import initCycleTLS from "cycletls";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import type { Page } from "rebrowser-puppeteer-core";

mkdirSync(join(resolve(), "stream"), { recursive: true });

export const cycleTLS = await initCycleTLS();

export async function waitForCloudflareBypass(page: Page) {
  const startTime = Date.now();
  const isChallenged = () =>
    page
      .title()
      .then(
        (t) =>
          t.includes("Just a moment") || t.includes("Checking your browser")
      )
      .catch(() => false);

  if (!(await isChallenged())) return true;

  while (Date.now() - startTime < 60000) {
    if (
      !(await isChallenged()) ||
      (await page.evaluate(() => document.cookie.includes("cf_clearance=")))
    ) {
      await new Promise((r) => setTimeout(r, 500));
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
