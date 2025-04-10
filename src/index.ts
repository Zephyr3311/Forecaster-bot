import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import { eq } from "drizzle-orm";
import { writeFileSync } from "fs";
import { getClobClient, getWallet } from "./constants";
import { db } from "./db";
import {
  marketSchema,
  marketTagSchema,
  rewardRateSchema,
  rewardSchema,
  tokenSchema,
} from "./db/schema";

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

log(`Bot Wallet Address: ${await wallet.getAddress()}`);

async function getAllMarkets(): Promise<Market[]> {
  const allMarkets = [];
  let nextCursor = "MA=="; // Initial cursor

  while (nextCursor !== "LTE=") {
    try {
      const response = await clobClient.getMarkets(nextCursor);
      allMarkets.push(...response.data);
      nextCursor = response.next_cursor;
      console.log(
        `Fetched ${response.data.length} markets, next cursor: ${atob(
          nextCursor
        )}`
      );
    } catch (err) {
      console.error("Error fetching markets:", err);
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

  const markets = await Promise.all(
    marketsList.map(async (market) => {
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
        endDateIso: market.end_date_iso ? new Date(market.end_date_iso) : null,
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

      const [dbMarket] = await db
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

  log(
    `Inserted ${markets.length} markets into database successfully`,
    new Date().toISOString()
  );

  // Batch delete all related data
  await Promise.all([
    ...markets.map(({ dbId }) =>
      db.delete(tokenSchema).where(eq(tokenSchema.marketId, dbId))
    ),
    ...markets.map(({ dbId }) =>
      db.delete(marketTagSchema).where(eq(marketTagSchema.marketId, dbId))
    ),
    ...markets.map(({ dbId }) =>
      db.delete(rewardSchema).where(eq(rewardSchema.marketId, dbId))
    ),
    ...markets.map(({ dbId }) =>
      db.delete(rewardRateSchema).where(eq(rewardRateSchema.marketId, dbId))
    ),
  ]);

  log(
    `Deleted all related data for ${markets.length} markets from database successfully`,
    new Date().toISOString()
  );

  // Batch insert all related data
  const insertOperations = [];

  for (const { market, dbId } of markets) {
    // Insert tokens
    if (market.tokens?.length) {
      insertOperations.push(
        db.insert(tokenSchema).values(
          market.tokens.map((token) => ({
            marketId: dbId,
            tokenId: token.token_id,
            outcome: token.outcome,
            price: String(token.price),
            winner: token.winner,
          }))
        )
      );
    }

    // Insert tags
    if (market.tags?.length) {
      insertOperations.push(
        db.insert(marketTagSchema).values(
          market.tags.map((tag) => ({
            marketId: dbId,
            tag,
          }))
        )
      );
    }

    // Insert rewards
    if (market.rewards) {
      insertOperations.push(
        db.insert(rewardSchema).values({
          marketId: dbId,
          minSize: market.rewards.min_size,
          maxSpread: String(market.rewards.max_spread),
        })
      );

      // Insert reward rates
      if (market.rewards.rates?.length) {
        insertOperations.push(
          db.insert(rewardRateSchema).values(
            market.rewards.rates.map((rate) => ({
              marketId: dbId,
              assetAddress: rate.asset_address,
              rewardsDailyRate: String(rate.rewards_daily_rate),
            }))
          )
        );
      }
    }
  }

  await Promise.all(insertOperations);

  log(
    `Finished ${markets.length} markets into database successfully`,
    new Date().toISOString()
  );
}

try {
  const allMarkets = await getAllMarkets();
  await upsertMarkets(allMarkets);
  writeFileSync("./markets.json", JSON.stringify(allMarkets, null, 2));
} catch (err) {
  error("Error:", err);
}
