import { error, log } from "console";
import initCycleTLS from "cycletls";
import { mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { connect } from "puppeteer-real-browser";
import type { Page } from "rebrowser-puppeteer-core";

mkdirSync(join(resolve(), "stream"), { recursive: true });

try {
  unlinkSync(join(resolve(), "response.html"));
} catch (_) {}

async function waitForCloudflareBypass(page: Page) {
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

async function getCloudflareSession(url: string) {
  const { browser, page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  const screenshotInterval = setInterval(
    async () =>
      await page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const bypassed = await waitForCloudflareBypass(page);
    if (!bypassed) throw new Error("Failed to bypass Cloudflare protection");

    await page.evaluate(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => "";
    });

    const cookies = await page.cookies();
    const headers = await page.evaluate(() => ({
      "user-agent": navigator.userAgent,
    }));

    return { cookies, headers };
  } finally {
    clearInterval(screenshotInterval);

    await browser.close().catch(() => {});
  }
}

async function main() {
  try {
    log("Getting Cloudflare session...");
    const session = await getCloudflareSession("https://disboard.org/");

    log("Session obtained, cookies:", session.cookies.length);
    const cookieString = session.cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    log("Initializing CycleTLS...");
    const cycleTLS = await initCycleTLS();

    log("Making request with session...");
    const response = await cycleTLS(
      "https://disboard.org/",
      {
        userAgent: session.headers["user-agent"],
        headers: { cookie: cookieString },
      },
      "get"
    );

    log("Response status:", response.status);

    if (response.status === 200) {
      writeFileSync("response.html", response.body.toString());
      log("Response saved to response.html");
    }

    await cycleTLS.exit();
  } catch (err) {
    error("Error:", err);
  }

  process.exit(0);
}

main();
