import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import { writeFileSync } from "fs";
import { getClobClient, getWallet } from "./constants";
import { db } from "./db";
import { markets, marketTags, rewardRates, rewards, tokens } from "./db/schema";

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
        `Fetched ${response.data.length} markets, next cursor: ${nextCursor}`
      );
    } catch (err) {
      console.error("Error fetching markets:", err);
      break;
    }
  }

  return allMarkets;
}

async function insertMarketsIntoDb(marketsList: Market[]) {
  console.log(`Inserting ${marketsList.length} markets into database...`);

  for (const market of marketsList) {
    try {
      // Insert market
      const insertResult = await db
        .insert(markets)
        .values({
          conditionId: market.condition_id,
          questionId: market.question_id,
          question: market.question,
          description: market.description || null,
          marketSlug: market.market_slug || null,
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
          negRiskMarketId: market.neg_risk_market_id || null,
          negRiskRequestId: market.neg_risk_request_id || null,
          is5050Outcome: market.is_50_50_outcome,
          icon: market.icon || null,
          image: market.image || null,
        })
        .returning();

      if (!insertResult || insertResult.length === 0) {
        console.error(
          `Failed to insert market: ${market.question} - no ID returned`
        );
        continue;
      }

      const marketId = insertResult[0]?.id!;

      // Insert tokens
      if (market.tokens && market.tokens.length > 0) {
        for (const token of market.tokens) {
          await db.insert(tokens).values({
            marketId: marketId,
            tokenId: token.token_id,
            outcome: token.outcome,
            price: String(token.price),
            winner: token.winner,
          });
        }
      }

      // Insert tags
      if (market.tags && market.tags.length > 0) {
        for (const tag of market.tags) {
          await db.insert(marketTags).values({
            marketId: marketId,
            tag,
          });
        }
      }

      // Insert rewards
      if (market.rewards) {
        await db.insert(rewards).values({
          marketId: marketId,
          minSize: market.rewards.min_size,
          maxSpread: String(market.rewards.max_spread),
        });

        // Insert reward rates
        if (market.rewards.rates && market.rewards.rates.length > 0) {
          for (const rate of market.rewards.rates) {
            await db.insert(rewardRates).values({
              marketId: marketId,
              assetAddress: rate.asset_address,
              rewardsDailyRate: String(rate.rewards_daily_rate),
            });
          }
        }
      }

      console.log(`Inserted market: ${market.question} (ID: ${marketId})`);
    } catch (error) {
      console.error(`Failed to insert market: ${market.question}`, error);
    }
  }

  console.log("Database insertion complete");
}

async function main() {
  try {
    const allMarkets = await getAllMarkets();
    await insertMarketsIntoDb(allMarkets);
    writeFileSync("./markets.json", JSON.stringify(allMarkets, null, 2));
    log(`Total markets fetched: ${allMarkets.length}`);

    await insertMarketsIntoDb(allMarkets);
  } catch (err) {
    error("Error:", err);
  }
}

main();
