/// <reference path="../types/gradio.d.ts" />
import * as cheerio from "cheerio";
import { log } from "console";
import { writeFileSync } from "fs";
import type { Page } from "rebrowser-puppeteer-core";
import {
  gracefulShutdown,
  LEADERBOARD_FILE,
  LLM_ARENA_URL,
  restartContainer,
  VPN_CONATAINER_NAME,
} from ".";
import { conflictUpdateAllExcept, db } from "../db";
import { llmLeaderboardSchema } from "../db/schema";
import type { GradioResult, LlmArenaLeaderboard } from "../types/gradio";
import { extractModelName, parseFormattedNumber } from "../utils";

export async function llmArena(page: Page) {
  setInterval(
    () => page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );

  await page.goto(LLM_ARENA_URL, { waitUntil: "networkidle2" });

  page.on("dialog", async (dialog) => await dialog.accept().catch(() => {}));

  let emptyLeaderboardCount = 0;

  while (true) {
    const leaderboard = (await page.evaluate(async () => {
      try {
        const id = window.gradio_config.dependencies.find(
          (dep) => dep.api_name === "update_leaderboard_and_plots_1"
        )?.id;

        const gradio_client = document
          .querySelector("gradio-app")
          ?.app.$$.ctx.find(
            (item) =>
              item &&
              typeof item === "object" &&
              item.predict instanceof Function &&
              item.submit instanceof Function
          );
        const result: GradioResult = await gradio_client.predict(id, [
          "Overall",
          [],
        ]);
        return result.data[0]!.value.data.map((row) =>
          Object.fromEntries(result.data[0]!.headers.map((h, i) => [h, row[i]]))
        );
      } catch (err) {
        console.error("Error fetching leaderboard:", err);
        return [];
      }
    })) as LlmArenaLeaderboard[];

    log("Fetched leaderboard entries:", leaderboard.length);

    if (leaderboard.length) {
      emptyLeaderboardCount = 0; // Reset counter when we get data
      const llmLeadeboard: (typeof llmLeaderboardSchema.$inferInsert)[] =
        leaderboard.map((entry) => ({
          rankUb: entry["Rank* (UB)"],
          rankStyleCtrl: entry["Rank (StyleCtrl)"],
          model: entry["Model"],
          modelName: extractModelName(entry["Model"]),
          arenaScore: entry["Arena Score"],
          ci: entry["95% CI"],
          votes: entry["Votes"],
          organization: entry["Organization"],
          license: entry["License"],
        }));
      await db
        .insert(llmLeaderboardSchema)
        .values(llmLeadeboard)
        .onConflictDoUpdate({
          target: [llmLeaderboardSchema.modelName],
          set: conflictUpdateAllExcept(llmLeaderboardSchema, ["id"]),
        });
      writeFileSync(LEADERBOARD_FILE, JSON.stringify(llmLeadeboard, null, 2));
      log(`OLD Leaderboard updated with ${llmLeadeboard.length} entries`);
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
          rankStyleCtrl: $(tds[1]).text().trim(),
          model: $(tds[2]).text().trim(),
          modelName: extractModelName($(tds[2]).text()),
          arenaScore: $(tds[3]).text().trim(),
          ci: $(tds[4]).text().trim(),
          votes: parseFormattedNumber($(tds[5]).text().trim()),
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
          target: [llmLeaderboardSchema.modelName],
          set: conflictUpdateAllExcept(llmLeaderboardSchema, ["id"]),
        });
      writeFileSync(LEADERBOARD_FILE, JSON.stringify(llmLeaderboard, null, 2));
      log(`NEW Leaderboard updated with ${llmLeaderboard.length} entries`);
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
