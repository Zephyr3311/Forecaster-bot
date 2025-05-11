import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import { and, eq, sql } from "drizzle-orm";
import { writeFileSync } from "fs";
import { db } from "./db";
import { marketSchema, tokenSchema, tradeHistorySchema } from "./db/schema";

async function getMarketVolumeData(marketId: number) {
  const tokens = await db
    .select()
    .from(tokenSchema)
    .where(eq(tokenSchema.marketId, marketId));

  const outcomes = await Promise.all(
    tokens.map(async (token) => {
      if (!token.tokenId) return null;

      // Get total volume for this token
      const volumeData = await db
        .select({
          totalVolume: sql`SUM(${tradeHistorySchema.volume})`.mapWith(String),
        })
        .from(tradeHistorySchema)
        .where(eq(tradeHistorySchema.tokenId, token.tokenId));

      const volume = parseFloat(volumeData[0]?.totalVolume || "0");
      const price = parseFloat(token.price?.toString() || "0");

      return {
        outcome: token.outcome || "Unknown",
        price: price,
        percentage: price * 100, // Price as percentage
        volume: volume,
      };
    })
  );

  return outcomes.filter(Boolean);
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

    const marketDataList = await Promise.all(
      markets.map(async (market) => {
        const outcomes = await getMarketVolumeData(market.id);

        return {
          question: market.question,
          questionId: market.questionId,
          endDate: market.endDateIso ? market.endDateIso.toISOString() : null,
          outcomes: outcomes,
        };
      })
    );

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
