import { error, log } from "console";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { JSDOM } from "jsdom";
import { join, resolve } from "path";
import { connect } from "puppeteer-real-browser";
import { cycleTLS, waitForCloudflareBypass } from "./puppeteer";
import type { GradioConfig, LlmArenaLeaderboard } from "./types/gradio";

const SESSION_FILE = join(resolve(), "session.json");
const LEADERBOARD_FILE = join(resolve(), "leaderboard.json");

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
    await page.evaluate(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => "";
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });

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

    const cookie = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    return { cookie, headers };
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
      return sessionData;
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

function getLeaderboard(html: string) {
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

  return leaderboard as unknown as LlmArenaLeaderboard[];
}

async function main() {
  let failureCount = 0;

  while (true) {
    try {
      if (failureCount >= 3) {
        log("3 failures in a row, forcing new session");
        if (existsSync(SESSION_FILE)) {
          unlinkSync(SESSION_FILE);
          log("Deleted existing session file");
        }
        failureCount = 0;
      }

      const session = await getSession("https://lmarena.ai");

      const response = await cycleTLS(
        "https://lmarena.ai",
        {
          userAgent: session.headers["user-agent"],
          headers: { ...session.headers, cookie: session.cookie },
        },
        "get"
      );

      log(`Response status: ${response.status}`);

      if (response.status === 200) {
        const leaderboard = getLeaderboard(response.body.toString());
        writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
        log(`Leaderboard updated with ${leaderboard.length} entries`);
        failureCount = 0;
      } else {
        error(`Failed with status: ${response.status}`);
        failureCount++;
      }
    } catch (err) {
      error("Error:", err);
      failureCount++;
    }
  }
}

process.on("SIGINT", async () => {
  log("Shutting down...");
  await cycleTLS.exit();
  process.exit(0);
});

main().catch((err) => {
  error("Fatal error:", err);
  cycleTLS.exit().finally(() => process.exit(1));
});
