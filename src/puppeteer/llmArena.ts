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
import { LeaderboardType } from "../types/llmArena";
import { extractModelName } from "../utils";

export async function llmArenaNew(page: Page, url: string) {
  setInterval(
    () => page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );

  await page.goto(url, { waitUntil: "networkidle2" });
  let emptyLeaderboardCount = 0;
  let lastHtmlHash = "";
  let sameContentCount = 0;
  const MAX_SAME_CONTENT_COUNT = 3;

  log("🚀 Starting LLM Arena leaderboard monitoring...");

  while (true) {
    const startTime = Date.now();
    log(`📡 Fetching leaderboard data from ${url}...`);

    const leaderboardData = await page.evaluate(async (url) => {
      try {
        // Force browser to bypass cache completely
        const cacheBustUrl = `${url}?nocache=${Date.now()}&rand=${Math.random().toString(
          36
        )}`;

        const response = await fetch(cacheBustUrl, {
          method: "GET",
          cache: "no-store", // Most aggressive cache prevention
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
            "If-None-Match": "*", // Prevent ETag caching
            "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT", // Force fresh request
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();

        // Parse the script tag from the fetched HTML
        const doc = new DOMParser().parseFromString(html, "text/html");
        const scripts = Array.from(doc.scripts);

        const s = scripts.find((s) =>
          s.textContent?.includes("StyleControl")
        )?.textContent;

        if (!s) throw new Error("StyleControl script not found");

        const j = s
          ?.slice(s.indexOf('"') + 1, s.lastIndexOf('"'))
          .replace(/\\"/g, '"');

        const parsedData = JSON.parse(
          j!.slice(j!.indexOf("{"), j!.lastIndexOf("}") + 1)
        );

        return {
          data: parsedData,
          htmlSize: html.length,
          timestamp: Date.now(),
          htmlContent: html, // Include full HTML for hashing
        };
      } catch (err) {
        // Don't log to browser console, return error info instead
        return {
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        };
      }
    }, url);

    const fetchTime = Date.now() - startTime;
    log(`⏱️  Fetch completed in ${fetchTime}ms`);

    // Check for errors
    if (leaderboardData && "error" in leaderboardData) {
      log(`❌ Error fetching leaderboard: ${leaderboardData.error}`);
      continue;
    }

    // Type guard to ensure we have valid data
    if (
      !leaderboardData ||
      !("data" in leaderboardData) ||
      !leaderboardData.data?.leaderboards
    ) {
      emptyLeaderboardCount++;
      log(`⚠️  Empty leaderboard returned (${emptyLeaderboardCount}/10)`);
      if (emptyLeaderboardCount >= 10) {
        log(
          "🔄 Received 10 consecutive empty leaderboards, restarting VPN container..."
        );
        await restartContainer(VPN_CONATAINER_NAME);
        await gracefulShutdown();
      }
    }

    // Create hash of HTML content for comparison
    const currentHtmlHash = createHash("md5")
      .update(leaderboardData.htmlContent || "")
      .digest("hex");

    const currentHtmlSize = leaderboardData.htmlSize;

    log(`📊 Content hash: ${currentHtmlHash.substring(0, 8)}...`);
    log(`📏 HTML size: ${currentHtmlSize.toLocaleString()} bytes`);

    // Check if we're getting cached responses (same content)
    if (currentHtmlHash === lastHtmlHash && lastHtmlHash !== "") {
      sameContentCount++;
      log(
        `🔄 Same content detected (hash: ${currentHtmlHash.substring(
          0,
          8
        )}...) - attempt ${sameContentCount}/${MAX_SAME_CONTENT_COUNT}`
      );

      if (sameContentCount >= MAX_SAME_CONTENT_COUNT) {
        log("🚨 Detected cached responses, forcing page refresh...");
        // Force a hard refresh of the page itself
        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
        sameContentCount = 0;
        lastHtmlHash = "";
        continue;
      }
    } else {
      sameContentCount = 0;
      lastHtmlHash = currentHtmlHash;
      log(
        `✅ Fresh content received (${currentHtmlSize.toLocaleString()} bytes, hash: ${currentHtmlHash.substring(
          0,
          8
        )}...)`
      );
    }

    const llmLeaderboard: (typeof llmLeaderboardSchema.$inferInsert)[] = [];
    const styleControlLeaderboard = leaderboardData.data.leaderboards.find(
      (lb: any) => lb.leaderboardType === LeaderboardType.RemoveStyleControl
    );

    if (!styleControlLeaderboard) {
      log("⚠️  StyleControl leaderboard not found in data");
      continue;
    }

    log(
      `📋 Found StyleControl leaderboard with ${
        styleControlLeaderboard.entries?.length || 0
      } entries`
    );

    if (styleControlLeaderboard?.entries) {
      styleControlLeaderboard.entries.forEach((entry: any, index: number) => {
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

        // Log top 3 entries for monitoring
        if (index < 3) {
          log(
            `🏆 #${entry.rank}: ${entry.modelName} (${entry.modelOrganization}) - Score: ${entry.score}`
          );
        }
      });
    }

    if (llmLeaderboard.length) {
      emptyLeaderboardCount = 0;
      const uniqueEntries = Array.from(
        new Map(llmLeaderboard.map((item) => [item.modelName, item])).values()
      );

      log(`💾 Saving ${uniqueEntries.length} unique entries to database...`);

      try {
        writeFileSync(LEADERBOARD_FILE, JSON.stringify(uniqueEntries, null, 2));

        await db
          .insert(llmLeaderboardSchema)
          .values(uniqueEntries)
          .onConflictDoUpdate({
            target: [llmLeaderboardSchema.modelName],
            set: conflictUpdateAllExcept(llmLeaderboardSchema, ["id"]),
          });

        log(
          `✅ ${dayjs().format(
            "DD-MM-YYYY HH:mm:ss"
          )} - Leaderboard updated successfully with ${
            llmLeaderboard.length
          } entries`
        );
      } catch (error) {
        log(`❌ Error saving to database: ${error}`);
      }
    } else {
      log("⚠️  No leaderboard entries to process");
    }
  }
}
