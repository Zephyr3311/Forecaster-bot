/// <reference path="./types/gradio.d.ts" />
import { sleep } from "bun";
import * as cheerio from "cheerio";
import { log } from "console";
import { writeFileSync } from "fs";
import { connect } from "puppeteer-real-browser";
import { conflictUpdateAllExcept, db } from "./db";
import { llmLeaderboardSchema } from "./db/schema";
import {
  checkIfWorkingElseRestart,
  gracefulShutdown,
  LEADERBOARD_FILE,
  LLM_ARENA_NEW_URL,
  restartContainer,
  VPN_CONATAINER_NAME,
} from "./puppeteer";
import { extractModelName } from "./utils";

async function main() {
  const { page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  page.on("error", (err) => console.log("page error", err));
  page.on("pageerror", (err) => console.log("page console error", err));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(
        "browser console",
        msg.text(),
        msg.location(),
        msg.args(),
        msg.stackTrace()
      );
    }
  });

  await checkIfWorkingElseRestart(page);

  setInterval(
    () => page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );

  await page.goto(LLM_ARENA_NEW_URL, { waitUntil: "networkidle2" });

  let emptyLeaderboardCount = 0;

  while (true) {
    const leaderboardHtml = await page.evaluate(async () => {
      try {
        const response = await fetch(LLM_ARENA_NEW_URL);
        console.error(response);
        const text = await response.text();

        return text;
      } catch (err) {
        console.error("Error fetching leaderboard:", err);
        return null;
      }
    });

    console.log(leaderboardHtml);

    await sleep(1000);

    if (!leaderboardHtml) continue;

    const $ = cheerio.load(leaderboardHtml);
    const llmLeaderboard: (typeof llmLeaderboardSchema.$inferInsert)[] = [];
    $("table tr").each((i, el) => {
      const tds = $(el).find("td");

      if (tds.length > 0) {
        const entry = {
          rankUb: $(tds[0]).text().trim(),
          rankStyleCtrl: $(tds[1]).text().trim(),
          model: $(tds[2]).text().trim(),
          modelName: extractModelName($(tds[2]).text()),
          arenaScore: $(tds[3]).text().trim(),
          ci: $(tds[4]).text().trim(),
          votes: $(tds[5]).text().trim(),
          organization: $(tds[6]).text().trim(),
          license: $(tds[7]).text().trim(),
        };
        llmLeaderboard.push(
          entry as unknown as typeof llmLeaderboardSchema.$inferInsert
        );
      }
    });

    if (llmLeaderboard.length) {
      emptyLeaderboardCount = 0; // Reset counter when we get data

      await db
        .insert(llmLeaderboardSchema)
        .values(llmLeaderboard)
        .onConflictDoUpdate({
          target: [llmLeaderboardSchema.model],
          set: conflictUpdateAllExcept(llmLeaderboardSchema, ["id"]),
        });
      writeFileSync(LEADERBOARD_FILE, JSON.stringify(llmLeaderboard, null, 2));
      log(`Leaderboard updated with ${llmLeaderboard.length} entries`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    } else {
      emptyLeaderboardCount++;
      log(`Empty leaderboard returned (${emptyLeaderboardCount}/10)`);

      if (emptyLeaderboardCount >= 10) {
        log(
          "Received 10 consecutive empty leaderboards, restarting VPN container..."
        );
        await restartContainer(VPN_CONATAINER_NAME);
        await gracefulShutdown();
      }

      await new Promise((resolve) => setTimeout(resolve, 3500));
    }
  }
}

main();
