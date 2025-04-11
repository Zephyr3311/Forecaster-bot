import initCycleTLS from "cycletls";
import { mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { connect } from "puppeteer-real-browser";
import type { Page } from "rebrowser-puppeteer-core";

mkdirSync(join(resolve(), "stream"), { recursive: true });

try {
  unlinkSync(join(resolve(), "response.html"));
} catch (_) {}

try {
  unlinkSync(join(resolve(), "stream", "page.jpg"));
} catch (error) {}

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
  const { browser } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  const screenshotInterval = setInterval(
    async () =>
      await page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );

  try {
    // Navigate to target URL and wait for Cloudflare challenge to resolve
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const bypassed = await waitForCloudflareBypass(page);
    if (!bypassed) throw new Error("Failed to bypass Cloudflare protection");

    // Disable browser dialogs
    await page.evaluate(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => "";
    });

    // Get cookies and headers for the subsequent request
    const cookies = await page.cookies();
    const headers = await page.evaluate(() => {
      return {
        "user-agent": navigator.userAgent,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "accept-language": navigator.language,
        "sec-ch-ua": navigator.userAgent.includes("Chrome")
          ? `"Google Chrome";v="${
              navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || ""
            }"`
          : "",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": `"${navigator.platform}"`,
        "upgrade-insecure-requests": "1",
      };
    });

    return { cookies, headers };
  } finally {
    clearInterval(screenshotInterval);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  try {
    console.log("Getting Cloudflare session...");
    const session = await getCloudflareSession("https://disboard.org/");

    console.log("Session obtained, cookies:", session.cookies.length);
    const cookieString = session.cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    console.log("Initializing CycleTLS...");
    const cycleTLS = await initCycleTLS();

    console.log("Making request with session...");
    const response = await cycleTLS(
      "https://disboard.org/",
      {
        userAgent: session.headers["user-agent"],
        headers: {
          ...session.headers,
          cookie: cookieString,
        },
      },
      "get"
    );

    console.log("Response status:", response.status);

    if (response.status === 200) {
      writeFileSync("response.html", response.body.toString());
      console.log("Response saved to response.html");
    } else {
      console.log("Failed to get 200 response");
    }

    await cycleTLS.exit();
  } catch (error) {
    console.error("Error:", error);
  }

  process.exit(0);
}

main();
