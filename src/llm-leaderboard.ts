/// <reference path="./types/gradio.d.ts" />
import { log } from "console";
import { writeFileSync } from "fs";
import { connect } from "puppeteer-real-browser";
import { conflictUpdateAllExcept, db } from "./db";
import { llmLeaderboardSchema } from "./db/schema";
import {
  checkIfWorkingElseRestart,
  gracefulShutdown,
  LEADERBOARD_FILE,
  LLM_ARENA_URL,
  restartContainer,
  VPN_CONATAINER_NAME,
} from "./puppeteer";
import type { GradioResult, LlmArenaLeaderboard } from "./types/gradio";

async function main() {
  const { page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  await checkIfWorkingElseRestart(page);

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
          target: [llmLeaderboardSchema.model],
          set: conflictUpdateAllExcept(llmLeaderboardSchema, ["id"]),
        });
      writeFileSync(LEADERBOARD_FILE, JSON.stringify(llmLeadeboard, null, 2));
      log(`Leaderboard updated with ${llmLeadeboard.length} entries`);
      await new Promise((resolve) => setTimeout(resolve, 250));
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

      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }
}

main();
