import * as cheerio from "cheerio";
import { log } from "console";
import dayjs from "dayjs";
import { writeFileSync } from "fs";
import type { Page } from "rebrowser-puppeteer-core";
import {
  gracefulShutdown,
  LEADERBOARD_FILE,
  restartContainer,
  VPN_CONATAINER_NAME,
} from ".";
import { conflictUpdateAllExcept, db } from "../db";
import { llmLeaderboardSchema } from "../db/schema";
import { extractModelName, parseFormattedNumber } from "../utils";

export async function llmArenaNew(page: Page, url: string) {
  setInterval(
    () => page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );

  await page.goto(url, { waitUntil: "networkidle2" });

  let emptyLeaderboardCount = 0;

  while (true) {
    const leaderboardHtml = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url);
        const text = await response.text();

        return text;
      } catch (err) {
        console.error("Error fetching leaderboard:", err);
        return null;
      }
    }, url);

    if (!leaderboardHtml) continue;

    const $ = cheerio.load(leaderboardHtml);
    const llmLeaderboard: (typeof llmLeaderboardSchema.$inferInsert)[] = [];
    $("table tr").each((i, el) => {
      const tds = $(el).find("td");

      if (tds.length > 0) {
        const entry = {
          rankUb: $(tds[0]).text().trim(),
          // rankStyleCtrl: $(tds[1]).text().trim(),
          model: $(tds[1]).text().trim(),
          modelName: extractModelName($(tds[1]).text()),
          arenaScore: $(tds[2]).text().trim(),
          ci: $(tds[3]).text().trim(),
          votes: parseFormattedNumber($(tds[4]).text().trim()),
          organization: $(tds[5]).text().trim(),
          license: $(tds[6]).text().trim(),
        };
        llmLeaderboard.push(
          entry as unknown as typeof llmLeaderboardSchema.$inferInsert
        );
      }
    });

    if (llmLeaderboard.length) {
      emptyLeaderboardCount = 0; // Reset counter when we get data

      const uniqueEntries = Array.from(
        new Map(llmLeaderboard.map((item) => [item.modelName, item])).values()
      );

      writeFileSync(LEADERBOARD_FILE, JSON.stringify(uniqueEntries, null, 2));

      await db
        .insert(llmLeaderboardSchema)
        .values(uniqueEntries)
        .onConflictDoUpdate({
          target: [llmLeaderboardSchema.modelName],
          set: conflictUpdateAllExcept(llmLeaderboardSchema, ["id"]),
        });

      log(
        dayjs().format("DD-MM-YYYY HH:mm:ss"),
        `NEW Leaderboard updated with ${llmLeaderboard.length} entries`
      );
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
