import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import { and, eq } from "drizzle-orm";
import { writeFileSync } from "fs";
import { db } from "./db";
import { marketSchema, tokenSchema } from "./db/schema";
import { getTokenVolumeData } from "./polymarket/markets";

async function getMarketVolumeData(marketId: number) {
  const tokens = await db
    .select()
    .from(tokenSchema)
    .where(eq(tokenSchema.marketId, marketId));

  const outcomes = [];

  // Process tokens synchronously
  for (const token of tokens) {
    if (!token.tokenId) continue;

    // Get volume directly from API
    const volume = await getTokenVolumeData(token.tokenId);
    const price = parseFloat(token.price?.toString() || "0");

    // Calculate percentage (price is already between 0-1)
    const percentage = price * 100;

    outcomes.push({
      outcome: token.outcome || "Unknown",
      price: price,
      percentage: percentage,
      volume: volume,
    });
  }

  return outcomes;
}

async function collectMarketContext() {
  try {
    // Get all active markets
    const markets = await db
      .select()
      .from(marketSchema)
      .where(
        and(eq(marketSchema.active, true), eq(marketSchema.closed, false))
      );

    log(`Found ${markets.length} active markets`);

    const marketDataList = [];

    // Process markets synchronously
    for (const market of markets) {
      const outcomes = await getMarketVolumeData(market.id);

      marketDataList.push({
        question: market.question,
        questionId: market.questionId,
        endDate: market.endDateIso ? market.endDateIso.toISOString() : null,
        outcomes: outcomes,
      });
    }

    // Group the markets by questionId prefix (first 60 characters)
    const marketGroupsMap: Record<string, typeof marketDataList> = {};

    for (const market of marketDataList) {
      const groupId = market.questionId.substring(0, 60);

      if (!marketGroupsMap[groupId]) marketGroupsMap[groupId] = [];

      marketGroupsMap[groupId].push(market);
    }

    // Convert the grouped map to an array
    const groupedMarkets = Object.entries(marketGroupsMap).map(
      ([groupId, markets]) => ({
        groupId,
        markets,
      })
    );

    // Write to file
    writeFileSync(
      "./market-context.json",
      JSON.stringify(groupedMarkets, null, 2)
    );

    log(
      `Market context data saved to market-context.json with ${groupedMarkets.length} groups`
    );
  } catch (err) {
    error(`Error collecting market context:`, err);
  }
}

async function main() {
  await collectMarketContext();
}

main().catch((err) => {
  error(err);
  process.exit(1);
});
