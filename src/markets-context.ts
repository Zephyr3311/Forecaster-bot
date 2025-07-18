import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import dayjs from "dayjs";
import { and, eq, gte, isNull, lte, max, sql } from "drizzle-orm";
import { formatUnits } from "ethers/lib/utils";
import { writeFileSync } from "fs";
import { stringify as yamlStringify } from "yaml";
import { db } from "./db";
import { marketSchema, tokenSchema, tradeHistorySchema } from "./db/schema";
import {
  MAX_RESULTS,
  SUBGRAPH_URL,
  USDC_ID,
  USDCE_DIGITS,
} from "./polymarket/constants";
import { syncMarkets } from "./polymarket/markets";
import { isSportsMarket } from "./utils/blacklist";

const MIN_TOKEN_PERCENTAGE = 5; // 2%
const PORTFOLIO_VALUE = 1526; // $4,000 portfolio value
const MAX_SLIPPAGE_PERCENTAGE = 3; // 5% max slippage threshold
const MAX_DAYS = 20; // Max days to look ahead for markets

// Add retry logic with exponential backoff
async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fetchFn();
    } catch (error: any) {
      const is429 = error?.response?.status === 429 || error?.status === 429;

      if (is429 && i < maxRetries) {
        const delay = baseDelay * Math.pow(2, i);
        log(`Rate limited, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

async function fetchTradeHistory(tokenId: string, outcomeLabel: string) {
  const lastTs = await db
    .select({ maxTs: max(tradeHistorySchema.ts) })
    .from(tradeHistorySchema)
    .where(eq(tradeHistorySchema.tokenId, tokenId))
    .then((rows) => Number(rows[0]?.maxTs || 0) + 1);

  const fetchSide = async (isMakerSeller: boolean) => {
    let skip = 0,
      hasMore = true;

    while (hasMore) {
      try {
        const query = `
         query GetTrades($assetId: String!, $usdcId: String!, $first: Int!, $skip: Int!, $fromTs: BigInt!) {
           orderFilledEvents(
             where: { ${
               isMakerSeller
                 ? "makerAssetId: $assetId, takerAssetId: $usdcId"
                 : "takerAssetId: $assetId, makerAssetId: $usdcId"
             }, timestamp_gte: $fromTs },
             orderBy: timestamp,
             orderDirection: asc,
             first: $first,
             skip: $skip
           ) {
             makerAmountFilled
             takerAmountFilled
             timestamp
           }
         }`;

        const response = await fetchWithRetry(() =>
          fetch(SUBGRAPH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query,
              variables: {
                assetId: tokenId,
                usdcId: USDC_ID,
                first: MAX_RESULTS,
                skip,
                fromTs: lastTs.toString(),
              },
            }),
          })
        );

        if (!response.ok) throw new Error(`Query failed: ${response.status}`);

        const result = await response.json();
        if (result.errors) throw result.errors;

        const events: any[] = result.data?.orderFilledEvents || [];
        if (!events.length) break;

        const trades = events.map((event) => {
          const baseAmount = BigInt(
            isMakerSeller ? event.makerAmountFilled : event.takerAmountFilled
          );
          const quoteAmount = BigInt(
            isMakerSeller ? event.takerAmountFilled : event.makerAmountFilled
          );
          const ts = parseInt(event.timestamp, 10);
          const price = parseFloat(
            formatUnits(
              (quoteAmount * 10n ** BigInt(USDCE_DIGITS)) / baseAmount,
              USDCE_DIGITS
            )
          );

          return {
            tokenId,
            ts,
            time: dayjs.unix(ts).toDate(),
            price: String(price),
            volume: String(parseFloat(formatUnits(quoteAmount, USDCE_DIGITS))),
            size: String(parseFloat(formatUnits(baseAmount, USDCE_DIGITS))),
            outcome: outcomeLabel,
          };
        });

        if (trades.length) {
          await db
            .insert(tradeHistorySchema)
            .values(trades)
            .onConflictDoNothing({
              target: [tradeHistorySchema.tokenId, tradeHistorySchema.ts],
            });
        }

        skip += events.length;
        hasMore = events.length === MAX_RESULTS;
      } catch (err) {
        error("Error fetching trade history:", err);
        break;
      }
    }
  };

  await fetchSide(true); // Maker sells token for USDC
  await fetchSide(false); // Maker buys token with USDC
}

async function calculateTokenVolume(tokenId: string) {
  const result = await db
    .select({ totalVolume: sql`SUM(volume::numeric)` })
    .from(tradeHistorySchema)
    .where(eq(tradeHistorySchema.tokenId, tokenId));

  return Number(result[0]?.totalVolume || 0);
}

async function collectMarketContext() {
  try {
    const max = dayjs().add(MAX_DAYS, "day").toDate();
    const min = dayjs().subtract(1, "day").toDate();

    let markets = await db
      .select()
      .from(marketSchema)
      .where(
        and(
          isNull(marketSchema.gameStartTime),
          eq(marketSchema.active, true),
          eq(marketSchema.closed, false),
          eq(marketSchema.enableOrderBook, true),
          gte(marketSchema.endDateIso, min),
          lte(marketSchema.endDateIso, max)
        )
      )
      .then((results) => results.filter((m) => !isSportsMarket(m.question)));

    log(`Found ${markets.length} active markets`);
    const marketDataList = [];

    for (let i = 0; i < markets.length; i++) {
      const market = markets[i]!;
      log(`Processing market ${i + 1}/${markets.length}: ${market.question}`);

      const tokens = await db
        .select()
        .from(tokenSchema)
        .where(eq(tokenSchema.marketId, market.id));

      if (
        !tokens.some((t) => {
          const price = parseFloat(t.price?.toString() || "0");
          return (
            price >= MIN_TOKEN_PERCENTAGE / 100 &&
            price <= (100 - MIN_TOKEN_PERCENTAGE) / 100
          );
        })
      )
        continue;

      const outcomeData = {} as Record<string, number>;
      let totalVolume = 0,
        validTokenCount = 0;

      for (const token of tokens) {
        if (!token.tokenId || !token.outcome) continue;

        await fetchTradeHistory(token.tokenId, token.outcome);
        const volume = await calculateTokenVolume(token.tokenId);

        totalVolume += volume;
        validTokenCount++;
        outcomeData[token.outcome] = parseFloat(token.price?.toString() || "0");
      }

      // Calculate and check normalized volume
      const normalizedVolume = validTokenCount
        ? totalVolume / validTokenCount
        : 0;
      const slippagePercentage = normalizedVolume
        ? (PORTFOLIO_VALUE / normalizedVolume) * 100
        : Infinity;

      if (slippagePercentage > MAX_SLIPPAGE_PERCENTAGE) {
        log(
          `Skipping market due to high slippage (${slippagePercentage.toFixed(
            2
          )}%): ${market.question}`
        );
        continue;
      }
      marketDataList.push({
        question: market.question,
        description: market.description,
        questionId: market.questionId,
        endDate: market.endDateIso?.toISOString() || null,
        outcomes: outcomeData,
        volume: Number(normalizedVolume.toFixed(2)),
      });

      // Group and save progress
      const marketGroupsMap = {} as Record<string, typeof marketDataList>;
      marketDataList.forEach((m) => {
        const groupId = m.questionId.substring(0, 60);
        (marketGroupsMap[groupId] ??= []).push(m);
      });

      const groupedMarkets = Object.entries(marketGroupsMap)
        .map(([_, marketGroup]) => ({
          endDate: marketGroup[0]?.endDate!,
          rules: marketGroup[0]?.description,
          markets: marketGroup.map((m) => ({
            question: m.question,
            outcomes: m.outcomes,
            volume: m.volume,
          })),
        }))
        .sort(
          (a, b) =>
            new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
        );

      writeFileSync(
        "./market-context.yml",
        yamlStringify(groupedMarkets, { indent: 2, lineWidth: 120 })
      );

      log(
        `Progress saved: ${i + 1}/${markets.length} markets processed (${
          groupedMarkets.length
        } groups)`
      );
    }

    log(`Market context collection completed`);
  } catch (err) {
    error(`Error collecting market context:`, err);
  }
}

async function main() {
  try {
    await syncMarkets();
    await collectMarketContext();
  } catch (err) {
    error("Main execution failed:", err);
  }
}

main().catch((err) => error(err));
