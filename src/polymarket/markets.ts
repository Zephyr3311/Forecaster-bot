import { error, log } from "console";
import { eq, inArray } from "drizzle-orm";
import { formatUnits } from "ethers/lib/utils";
import { writeFileSync } from "fs";
import { db } from "../db";
import {
  marketSchema,
  marketTagSchema,
  rewardRateSchema,
  rewardSchema,
  tokenSchema,
} from "../db/schema";
import type { Market } from "../types/markets";
import { portfolioState } from "../utils/portfolio-state";
import { retryWithBackoff, sleep } from "../utils/retry";
import { getClobClient, getWallet } from "../utils/web3";
import { USDCE_DIGITS } from "./constants";
import { redeem } from "./redeem";

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

// Rate limiting: 60 requests per 10 seconds = 6 requests per second max
// We'll be more conservative: 5 requests per second = 200ms between requests
const RATE_LIMIT_DELAY = 200; // milliseconds between requests

function safeAtob(cursor: string): string {
  try {
    return atob(cursor);
  } catch (err) {
    log(`Warning: Could not decode cursor "${cursor}", using as-is`);
    return cursor;
  }
}

export async function getAllMarkets(): Promise<Market[]> {
  const allMarkets = [];
  let nextCursor = "MA==";
  let requestCount = 0;
  const startTime = Date.now();

  while (nextCursor !== "LTE=") {
    try {
      // Rate limiting: ensure we don't exceed 5 requests per second
      if (requestCount > 0) {
        await sleep(RATE_LIMIT_DELAY);
      }

      const response = await retryWithBackoff(
        async () => {
          const result = await clobClient.getMarkets(nextCursor);
          if (!result.data) {
            throw new Error("No data in response from getMarkets");
          }
          return result;
        },
        5, // 5 retries
        3000 // 3 second base delay (longer for rate limits)
      );

      allMarkets.push(...response.data);
      nextCursor = response.next_cursor;
      requestCount++;

      const decodedCursor = safeAtob(nextCursor);
      log(
        `Fetched ${
          response.data?.length || 0
        } markets, next cursor: ${decodedCursor} (total: ${allMarkets.length})`
      );

      // Log progress every 50 requests
      if (requestCount % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = requestCount / elapsed;
        log(
          `Progress: ${requestCount} requests in ${elapsed.toFixed(
            1
          )}s (${rate.toFixed(2)} req/s)`
        );
      }
    } catch (err) {
      // Check if it's a rate limit error
      if (
        (err as Error)?.message?.includes("429") ||
        (err as Error)?.message?.includes("Too Many Requests")
      ) {
        log("Rate limit hit, waiting 15 seconds before retrying...");
        await sleep(1000);
        continue; // Don't increment nextCursor, retry same cursor
      }

      // Check if it's the cursor decoding error
      if (err instanceof DOMException && err.name === "InvalidCharacterError") {
        log(`Cursor decoding failed for "${nextCursor}", stopping fetch`);
        break;
      }

      error("Error fetching markets after retries:", err);
      break;
    }
  }

  log(
    `Finished fetching ${allMarkets.length} total markets in ${requestCount} requests`
  );
  return allMarkets;
}

export async function upsertMarkets(marketsList: Market[]) {
  const startTime = new Date();
  log(
    `Start inserting ${marketsList.length} markets into database...`,
    startTime.toISOString()
  );

  // Process in batches of 50 (smaller batches for better error handling)
  const BATCH_SIZE = 50;
  let processedCount = 0;

  for (let i = 0; i < marketsList.length; i += BATCH_SIZE) {
    const batch = marketsList.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(marketsList.length / BATCH_SIZE);

    log(
      `Processing batch ${batchNumber}/${totalBatches} (${batch.length} markets)`
    );

    // Use retry logic for database operations
    await retryWithBackoff(
      async () => {
        await db.transaction(async (tx) => {
          // First, insert all markets in batch and collect their IDs
          const marketsWithIds = await Promise.all(
            batch.map(async (market) => {
              const marketData: typeof marketSchema.$inferInsert = {
                conditionId: market.condition_id,
                questionId: market.question_id,
                question: market.question,
                description: market.description,
                marketSlug: market.market_slug,
                active: market.active,
                closed: market.closed,
                archived: market.archived,
                acceptingOrders: market.accepting_orders,
                enableOrderBook: market.enable_order_book,
                minimumOrderSize: market.minimum_order_size,
                minimumTickSize: String(market.minimum_tick_size),
                acceptingOrderTimestamp: market.accepting_order_timestamp
                  ? new Date(market.accepting_order_timestamp)
                  : null,
                endDateIso: market.end_date_iso
                  ? new Date(market.end_date_iso)
                  : null,
                gameStartTime: market.game_start_time
                  ? new Date(market.game_start_time)
                  : null,
                secondsDelay: market.seconds_delay,
                fpmm: market.fpmm,
                makerBaseFee: String(market.maker_base_fee),
                takerBaseFee: String(market.taker_base_fee),
                notificationsEnabled: market.notifications_enabled,
                negRisk: market.neg_risk,
                negRiskMarketId: market.neg_risk_market_id,
                negRiskRequestId: market.neg_risk_request_id,
                is5050Outcome: market.is_50_50_outcome,
                icon: market.icon,
                image: market.image,
              };

              const [dbMarket] = await tx
                .insert(marketSchema)
                .values(marketData)
                .onConflictDoUpdate({
                  target: marketSchema.marketSlug,
                  set: marketData,
                })
                .returning();

              return {
                market,
                dbId: dbMarket!.id!,
              };
            })
          );

          // Collect all dbIds for the batch
          const batchIds = marketsWithIds.map((m) => m.dbId);

          // Bulk delete related data for all markets in batch
          if (batchIds.length > 0) {
            await tx
              .delete(tokenSchema)
              .where(inArray(tokenSchema.marketId, batchIds));
            await tx
              .delete(marketTagSchema)
              .where(inArray(marketTagSchema.marketId, batchIds));
            await tx
              .delete(rewardSchema)
              .where(inArray(rewardSchema.marketId, batchIds));
            await tx
              .delete(rewardRateSchema)
              .where(inArray(rewardRateSchema.marketId, batchIds));
          }

          // Prepare bulk insert data for all related entities
          const tokens = marketsWithIds.flatMap(
            ({ market, dbId }) =>
              market.tokens?.map((token) => ({
                marketId: dbId,
                tokenId: token.token_id,
                outcome: token.outcome,
                price: String(token.price),
                winner: token.winner,
              })) || []
          );

          const tags = marketsWithIds.flatMap(
            ({ market, dbId }) =>
              market.tags?.map((tag) => ({
                marketId: dbId,
                tag,
              })) || []
          );

          const rewards = marketsWithIds
            .filter(({ market }) => market.rewards)
            .map(({ market, dbId }) => ({
              marketId: dbId,
              minSize: market.rewards!.min_size,
              maxSpread: String(market.rewards!.max_spread),
            }));

          const rewardRates = marketsWithIds.flatMap(
            ({ market, dbId }) =>
              market.rewards?.rates?.map((rate) => ({
                marketId: dbId,
                assetAddress: rate.asset_address,
                rewardsDailyRate: String(rate.rewards_daily_rate),
              })) || []
          );

          // Bulk insert all related data
          if (tokens.length) await tx.insert(tokenSchema).values(tokens);
          if (tags.length) await tx.insert(marketTagSchema).values(tags);
          if (rewards.length) await tx.insert(rewardSchema).values(rewards);
          if (rewardRates.length)
            await tx.insert(rewardRateSchema).values(rewardRates);
        });
      },
      3, // 3 retries for database operations
      1000 // 1 second base delay
    );

    processedCount += batch.length;
    log(
      `Completed batch ${batchNumber}/${totalBatches} (${processedCount}/${marketsList.length} markets processed)`
    );

    // Small delay between batches to prevent overwhelming the database
    if (batchNumber < totalBatches) {
      await sleep(100);
    }
  }

  const endTime = new Date();
  const durationSecs = (endTime.getTime() - startTime.getTime()) / 1000;
  log(
    `Finished inserting ${
      marketsList.length
    } markets into database successfully in ${durationSecs}s (${Math.round(
      marketsList.length / durationSecs
    )} markets/sec)`,
    endTime.toISOString()
  );
}

export async function syncMarkets() {
  await retryWithBackoff(
    async () => {
      const allMarkets = await getAllMarkets();
      writeFileSync("./markets.json", JSON.stringify(allMarkets, null, 2));
      await upsertMarkets(allMarkets);
    },
    2, // Only 2 retries for the entire sync (since it takes so long)
    10000 // 10 second base delay for the entire sync operation
  );
}

export async function checkAndClaimResolvedMarkets(
  assetIds: string[]
): Promise<void> {
  try {
    log("Checking for positions to redeem...");

    for (const assetId of assetIds) {
      // Check balance using portfolio state with retry
      const balance = await retryWithBackoff(
        async () => {
          return await portfolioState.fetchAssetBalanceIfNeeded(assetId);
        },
        3,
        1000
      );

      const balanceAmount = BigInt(balance);

      if (balanceAmount <= BigInt(1000)) continue;

      // Find market info with retry
      const [token, market] = await retryWithBackoff(
        async () => {
          const tokenResult = await db
            .select()
            .from(tokenSchema)
            .where(eq(tokenSchema.tokenId, assetId))
            .limit(1)
            .then((results) => results[0]);

          if (!tokenResult?.marketId) return [null, null];

          const marketResult = await db
            .select()
            .from(marketSchema)
            .where(eq(marketSchema.id, tokenResult.marketId))
            .limit(1)
            .then((results) => results[0]);

          return [tokenResult, marketResult];
        },
        3,
        1000
      );

      if (!token || !market) continue;

      // Check if market is resolved
      if (market.closed) {
        log(
          `Found resolved market with balance: ${market.question}`,
          `Position: ${token.outcome}, Balance: ${formatUnits(
            balance,
            USDCE_DIGITS
          )}`
        );

        if (!market.conditionId) {
          log(`No condition ID for market ${market.question}, can't redeem`);
          continue;
        }

        try {
          // Create redemption transaction with retry
          await retryWithBackoff(
            async () => {
              await redeem(market.conditionId, market.negRisk, [
                token.outcome?.toLowerCase() === "yes" ? balance : "0",
                token.outcome?.toLowerCase() === "no" ? balance : "0",
              ]);
            },
            3,
            2000
          );

          // Update the cached balance after redeeming
          portfolioState.updateAssetBalance(assetId, "0");

          // Force refresh of collateral balance since we received funds
          portfolioState.updateCollateralBalance("0");

          log(`✅ Successfully redeemed position for ${market.question}`);
          portfolioState.currentModelOrg = null; // Reset current position after redemption
        } catch (err) {
          error(`Failed to redeem for market ${market.question}:`, err);
        }
      }
    }
  } catch (err) {
    error("Error checking for positions to redeem:", err);
  }
}
