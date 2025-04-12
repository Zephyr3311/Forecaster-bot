import * as cheerio from "cheerio";
import { error, log } from "console";
import initCycleTLS from "cycletls";
import { mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { connect } from "puppeteer-real-browser";
import type { Page } from "rebrowser-puppeteer-core";
import type { GradioConfig } from "./types/gradio";

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
    () => page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => "";
    });

    await new Promise((r) => setTimeout(r, 5000));
    if (!(await waitForCloudflareBypass(page)))
      throw new Error("Failed to bypass Cloudflare protection");

    const cookies = await page.cookies();
    const headers = await page.evaluate(() => ({
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
    }));

    return { cookies, headers };
  } finally {
    clearInterval(screenshotInterval);
    await browser.close().catch(() => {});
  }
}

try {
  log("Getting Cloudflare session...");
  const session = await getCloudflareSession("https://lmarena.ai/");

  log("Session obtained, cookies:", session.cookies.length);
  const cookieString = session.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  log("Making request with session...");
  const cycleTLS = await initCycleTLS();
  const response = await cycleTLS(
    "https://lmarena.ai/",
    {
      userAgent: session.headers["user-agent"],
      headers: {
        ...session.headers,
        cookie: cookieString,
      },
    },
    "get"
  );

  log("Response status:", response.status);
  if (response.status === 200) {
    const html = response.body.toString();
    const $ = cheerio.load(html);

    const script = $("script")
      .filter((_, el) => $(el).text().includes("window.gradio_config"))
      .first()
      .text()
      .replace("window.gradio_config = ", "")
      .slice(0, -1);

    const gradioConfig = JSON.parse(script) as GradioConfig;

    const leaderboardsData = gradioConfig.components.filter(
      (comp) =>
        comp.props.elem_id === "arena_leaderboard_dataframe" &&
        comp.props.value.data.length > 50
    )[0]!;
    const leaderboard = leaderboardsData.props.value.data.map((row) =>
      Object.fromEntries(
        leaderboardsData.props.value.headers.map((h, i) => [h, row[i]])
      )
    );
    writeFileSync("config.json", JSON.stringify(leaderboard));
    writeFileSync("response.html", html);
    log("Response saved to response.html");
  }

  await cycleTLS.exit();
} catch (err) {
  error("Error:", err);
}

process.exit(0);
