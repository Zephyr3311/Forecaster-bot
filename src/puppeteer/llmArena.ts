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
import { LeaderboardType, type LlmAreena } from "../types/llmArena";
import { extractModelName } from "../utils";

export async function llmArenaNew(page: Page, url: string) {
  setInterval(
    () => page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );
  await page.goto(url, { waitUntil: "networkidle2" });
  let emptyLeaderboardCount = 0;

  while (true) {
    const leaderboardData: LlmAreena = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url);
        const html = await response.text();

        // Parse the script tag from the fetched HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const scripts = Array.from(doc.scripts);

        const s = scripts.find((s) =>
          s.textContent?.includes("StyleControl")
        )?.textContent;

        const j = s
          ?.slice(s.indexOf('"') + 1, s.lastIndexOf('"'))
          .replace(/\\"/g, '"');
        return JSON.parse(j!.slice(j!.indexOf("{"), j!.lastIndexOf("}") + 1));
      } catch (err) {
        console.error("Error fetching leaderboard:", err);
        return null;
      }
    }, url);

    if (!leaderboardData?.leaderboards) continue;

    const llmLeaderboard: (typeof llmLeaderboardSchema.$inferInsert)[] = [];

    const styleControlLeaderboard = leaderboardData.leaderboards.find(
      (lb) => lb.leaderboardType === LeaderboardType.RemoveStyleControl
    );

    if (styleControlLeaderboard?.entries) {
      styleControlLeaderboard.entries.forEach((entry) => {
        const leaderboardEntry = {
          rankUb: entry.rank.toString(),
          model: entry.modelName,
          modelName: extractModelName(entry.modelName),
          arenaScore: entry.score.toString(),
          ci: `${entry.confidenceIntervalLower.toFixed(
            1
          )}, ${entry.confidenceIntervalUpper.toFixed(1)}`,
          votes: entry.votes,
          organization: entry.modelOrganization,
          license: entry.license,
        };
        llmLeaderboard.push(
          leaderboardEntry as unknown as typeof llmLeaderboardSchema.$inferInsert
        );
      });
    }

    if (llmLeaderboard.length) {
      emptyLeaderboardCount = 0;
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
