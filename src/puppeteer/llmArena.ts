import { log } from "console";
import { createHash } from "crypto";
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
import { type Entry } from "../types/llmArena";

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export async function llmArenaNew(page: Page, url: string) {
  const startupTime = Date.now();
  let cycleCount = 0;
  let successfulUpdates = 0;

  setInterval(
    () => page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );

  await page.goto(url, { waitUntil: "networkidle2" });
  let emptyLeaderboardCount = 0;
  let lastHtmlHash = "";
  let sameContentCount = 0;
  const MAX_SAME_CONTENT_COUNT = 3;
  const MAX_RETRIES = 30;

  log("🚀 LLM Arena monitoring started");
  log("");

  while (true) {
    cycleCount++;
    const currentUptime = Date.now() - startupTime;
    const startTime = Date.now();

    // await sleep(100000); // Wait 1 second before each cycle
    const leaderboardData = await page.evaluate(async (url) => {
      try {
        const response = await fetch(
          `${url}?nocache=${Date.now()}&rand=${Math.random().toString(36)}`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
              Pragma: "no-cache",
              Expires: "0",
              "If-None-Match": "*",
              "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT",
            },
          }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const script = Array.from(doc.scripts).find((s) =>
          s.textContent?.includes("hasStyleControl")
        );

        if (!script) throw new Error("hasStyleControl script not found");

        const jsonStr = script.textContent
          ?.slice(
            script.textContent.indexOf('"') + 1,
            script.textContent.lastIndexOf('"')
          )
          .replace(/\\"/g, '"');

        const parsedData = JSON.parse(
          jsonStr!.slice(jsonStr!.indexOf("{"), jsonStr!.lastIndexOf("}") + 1)
        );

        const parseMetadata = () => {
          const metadata: Record<string, string | undefined> = {};

          const lastUpdatedMatch = html.match(
            /Last Updated[\s\S]*?<p[^>]*>([^<]+)<\/p>/i
          );
          if (lastUpdatedMatch)
            metadata.last_updated = lastUpdatedMatch[1]?.trim();

          const totalVotesMatch = html.match(
            /Total Votes[\s\S]*?<p[^>]*>([\d,]+)<\/p>/i
          );
          if (totalVotesMatch)
            metadata.total_votes = totalVotesMatch[1]?.trim();

          const totalModelsMatch = html.match(
            /Total Models[\s\S]*?<p[^>]*>(\d+)<\/p>/i
          );
          if (totalModelsMatch)
            metadata.total_models = totalModelsMatch[1]?.trim();

          return Object.keys(metadata).length > 0 ? metadata : null;
        };

        return {
          data: parsedData,
          metadata: parseMetadata(),
          timestamp: Date.now(),
          htmlContent: html,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        };
      }
    }, url);

    const fetchTime = Date.now() - startTime;

    // Check for errors
    if (leaderboardData && "error" in leaderboardData) {
      emptyLeaderboardCount++; // Add this line
      log(
        `❌ Error: ${
          leaderboardData.error
        } (${emptyLeaderboardCount}/${MAX_RETRIES}) | Uptime: ${formatUptime(
          currentUptime
        )} | Cycle: ${cycleCount}`
      );

      if (emptyLeaderboardCount >= MAX_RETRIES) {
        log("🔄 Restarting VPN...");
        await restartContainer(VPN_CONATAINER_NAME);
        await gracefulShutdown();
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    // Type guard to ensure we have valid data
    if (
      !leaderboardData ||
      !("data" in leaderboardData) ||
      !leaderboardData.data?.leaderboard
    ) {
      emptyLeaderboardCount++;
      log(
        `⚠️ Empty data (${emptyLeaderboardCount}/${MAX_RETRIES}) | Uptime: ${formatUptime(
          currentUptime
        )} | Cycle: ${cycleCount}`
      );
      if (emptyLeaderboardCount >= MAX_RETRIES) {
        log("🔄 Restarting VPN...");
        await restartContainer(VPN_CONATAINER_NAME);
        await gracefulShutdown();
      }
      continue;
    }

    // Create hash of HTML content for comparison
    const currentHtmlHash = createHash("md5")
      .update(leaderboardData.htmlContent || "")
      .digest("hex");

    const hashShort = currentHtmlHash.substring(0, 8);

    // Check if we're getting cached responses
    if (currentHtmlHash === lastHtmlHash && lastHtmlHash !== "") {
      sameContentCount++;
      log(
        `🔄 Cached (${hashShort}) ${sameContentCount}/${MAX_SAME_CONTENT_COUNT} | Uptime: ${formatUptime(
          currentUptime
        )} | Cycle: ${cycleCount}`
      );

      if (sameContentCount >= MAX_SAME_CONTENT_COUNT) {
        log("🚨 Forcing refresh...");
        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
        sameContentCount = 0;
        lastHtmlHash = "";
        log("");
        continue;
      }
      continue;
    } else {
      sameContentCount = 0;
      lastHtmlHash = currentHtmlHash;
    }

    const styleControlLeaderboard = leaderboardData.data.leaderboard;

    if (!styleControlLeaderboard) {
      log(
        `⚠️ No StyleControl data | Uptime: ${formatUptime(
          currentUptime
        )} | Cycle: ${cycleCount}`
      );
      continue;
    }

    const llmLeaderboard: (typeof llmLeaderboardSchema.$inferInsert)[] = [];

    if (styleControlLeaderboard?.entries) {
      styleControlLeaderboard.entries.forEach((entry: Entry) => {
        const leaderboardEntry = {
          rank: entry.rank,
          modelDisplayName: entry.modelDisplayName,
          rating: entry.rating.toString(),
          modelOrganization: entry.modelOrganization,
        };
        llmLeaderboard.push(leaderboardEntry);
      });
    }

    if (llmLeaderboard.length) {
      emptyLeaderboardCount = 0;
      successfulUpdates++;
      const uniqueEntries = Array.from(
        new Map(
          llmLeaderboard.map((item) => [item.modelDisplayName, item])
        ).values()
      );

      try {
        writeFileSync(LEADERBOARD_FILE, JSON.stringify(uniqueEntries, null, 2));

        await db
          .insert(llmLeaderboardSchema)
          .values(uniqueEntries)
          .onConflictDoUpdate({
            target: [llmLeaderboardSchema.modelDisplayName],
            set: conflictUpdateAllExcept(llmLeaderboardSchema, ["id"]),
          });

        // Show top 3 models inline
        const top3 = styleControlLeaderboard.entries.slice(0, 3);
        const topModels = top3
          .map(
            (entry: Entry, i: number) =>
              `#${i + 1} ${entry.modelOrganization}(${entry.rating})`
          )
          .join(" | ");

        let metadataStr = "";
        if (leaderboardData.metadata) {
          const { last_updated, total_votes, total_models } =
            leaderboardData.metadata;
          metadataStr = ` | ${last_updated || "N/A"} | ${
            total_votes || "N/A"
          } | ${total_models || "N/A"}`;
        }

        log(
          `✅ ${dayjs().format("HH:mm:ss")} | ${
            uniqueEntries.length
          } entries | ${hashShort} | ${fetchTime}ms`,
          `🏆 ${topModels}`
        );

        // Show runtime summary every 10 successful updates
        if (successfulUpdates % 10 === 0) {
          const avgCycleTime = currentUptime / cycleCount;
          log(
            `📊 Runtime: ${formatUptime(currentUptime)} | Success rate: ${(
              (successfulUpdates / cycleCount) *
              100
            ).toFixed(1)}% | Avg cycle: ${avgCycleTime.toFixed(
              0
            )}ms${metadataStr}`
          );
        }

        log("");
      } catch (error) {
        log(
          `❌ DB error: ${error} | Uptime: ${formatUptime(
            currentUptime
          )} | Cycle: ${cycleCount}`
        );
      }
    } else {
      log(
        `⚠️ No entries to process | Uptime: ${formatUptime(
          currentUptime
        )} | Cycle: ${cycleCount}`
      );
    }
  }
}
