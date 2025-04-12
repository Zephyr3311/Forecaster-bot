import { error, log } from "console";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { JSDOM } from "jsdom";
import { join, resolve } from "path";
import { connect } from "puppeteer-real-browser";
import { cycleTLS, waitForCloudflareBypass } from "./puppeteer";
import type { GradioConfig } from "./types/gradio";

const SESSION_FILE = join(resolve(), "cloudflare_session.json");

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

    await new Promise((r) => setTimeout(r, 500));
    if (!(await waitForCloudflareBypass(page)))
      throw new Error("Failed to bypass Cloudflare protection");

    const cookies = await page.cookies();
    const headers = await page.evaluate(() => ({
      "user-agent": navigator.userAgent,
      "sec-ch-ua": navigator.userAgent.includes("Chrome")
        ? `"Google Chrome";v="${
            navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || ""
          }"`
        : "",
    }));

    return { cookies, headers };
  } finally {
    clearInterval(screenshotInterval);
    await browser.close().catch(() => {});
  }
}

async function getSession(url: string) {
  if (existsSync(SESSION_FILE)) {
    try {
      log("Using existing Cloudflare session...");
      const sessionData = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
      return sessionData as ReturnType<typeof getCloudflareSession>;
    } catch (err) {
      log("Error reading session file, getting new session...");
    }
  }

  log("Getting new Cloudflare session...");
  const session = await getCloudflareSession(url);

  writeFileSync(SESSION_FILE, JSON.stringify(session));
  log("Session saved to file");

  return session;
}

try {
  const session = await getSession("https://lmarena.ai/");

  log("Session obtained, cookies:", session.cookies.length);
  const cookie = session.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  const response = await cycleTLS(
    "https://lmarena.ai/",
    {
      userAgent: session.headers["user-agent"],
      headers: { ...session.headers, cookie },
    },
    "get"
  );

  log("Response status:", response.status);
  if (response.status === 200) {
    const html = response.body.toString();
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    const gradioConfig = dom.window.gradio_config as GradioConfig;
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

    writeFileSync("config.json", JSON.stringify(leaderboard, null, 2));
    writeFileSync("response.html", html);
    log("Response saved to response.html");
  }

  await cycleTLS.exit();
} catch (err) {
  error("Error:", err);
}

process.exit(0);
