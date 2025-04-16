import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import { eq } from "drizzle-orm";
import { writeFileSync } from "fs";
import { db } from "./db";
import {
  marketSchema,
  marketTagSchema,
  rewardRateSchema,
  rewardSchema,
  tokenSchema,
} from "./db/schema";
import type { Market } from "./types/markets";
import { getClobClient, getWallet } from "./utils/web3";

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

async function getAllMarkets(): Promise<Market[]> {
  const allMarkets = [];
  let nextCursor = "MA=="; // Initial cursor

  while (nextCursor !== "LTE=") {
    try {
      const response = await clobClient.getMarkets(nextCursor);
      allMarkets.push(...response.data);
      nextCursor = response.next_cursor;
      log(
        `Fetched ${response.data.length} markets, next cursor: ${atob(
          nextCursor
        )}`
      );
    } catch (err) {
      error("Error fetching markets:", err);
      break;
    }
  }

  return allMarkets;
}

async function upsertMarkets(marketsList: Market[]) {
  log(
    `Start inserting ${marketsList.length} markets into database...`,
    new Date().toISOString()
  );

  // Process in batches of 100
  const BATCH_SIZE = 100;
  let processedCount = 0;

  for (let i = 0; i < marketsList.length; i += BATCH_SIZE) {
    const batch = marketsList.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(marketsList.length / BATCH_SIZE);

    log(
      `Processing batch ${batchNumber}/${totalBatches} (${batch.length} markets)`
    );

    // Use Drizzle transaction for each batch
    await db.transaction(async (tx) => {
      const markets = await Promise.all(
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

      // Delete related data within the transaction
      for (const { dbId } of markets) {
        await tx.delete(tokenSchema).where(eq(tokenSchema.marketId, dbId));
        await tx
          .delete(marketTagSchema)
          .where(eq(marketTagSchema.marketId, dbId));
        await tx.delete(rewardSchema).where(eq(rewardSchema.marketId, dbId));
        await tx
          .delete(rewardRateSchema)
          .where(eq(rewardRateSchema.marketId, dbId));
      }

      // Insert related data within the transaction
      for (const { market, dbId } of markets) {
        // Insert tokens
        if (market.tokens?.length) {
          await tx.insert(tokenSchema).values(
            market.tokens.map((token) => ({
              marketId: dbId,
              tokenId: token.token_id,
              outcome: token.outcome,
              price: String(token.price),
              winner: token.winner,
            }))
          );
        }

        // Insert tags
        if (market.tags?.length) {
          await tx.insert(marketTagSchema).values(
            market.tags.map((tag) => ({
              marketId: dbId,
              tag,
            }))
          );
        }

        // Insert rewards
        if (market.rewards) {
          await tx.insert(rewardSchema).values({
            marketId: dbId,
            minSize: market.rewards.min_size,
            maxSpread: String(market.rewards.max_spread),
          });

          // Insert reward rates
          if (market.rewards.rates?.length) {
            await tx.insert(rewardRateSchema).values(
              market.rewards.rates.map((rate) => ({
                marketId: dbId,
                assetAddress: rate.asset_address,
                rewardsDailyRate: String(rate.rewards_daily_rate),
              }))
            );
          }
        }
      }
    });

    processedCount += batch.length;
    log(
      `Completed batch ${batchNumber}/${totalBatches} (${processedCount}/${marketsList.length} markets processed)`
    );
  }

  log(
    `Finished inserting ${marketsList.length} markets into database successfully`,
    new Date().toISOString()
  );
}

try {
  while (true) {
    const allMarkets = await getAllMarkets();
    writeFileSync("./markets.json", JSON.stringify(allMarkets, null, 2));
    await upsertMarkets(allMarkets);
  }
} catch (err) {
  error("Error:", err);
}
