import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import dayjs from "dayjs";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { formatUnits } from "ethers/lib/utils";
import { writeFileSync } from "fs";
import { stringify as yamlStringify } from "yaml";
import { db } from "./db";
import { marketSchema, tokenSchema } from "./db/schema";
import {
  MAX_RESULTS,
  SUBGRAPH_URL,
  USDC_ID,
  USDCE_DIGITS,
} from "./polymarket/constants";
import { syncMarkets } from "./polymarket/markets";
import { isSportsMarket } from "./utils/blacklist";

const MIN_TOKEN_PERCENTAGE = 2; // 2%
const PORTFOLIO_VALUE = 4000; // $4,000 portfolio value
const MAX_SLIPPAGE_PERCENTAGE = 5; // 5% max slippage threshold

async function getSubgraphConditionalTokenVolume(
  tokenId: string
): Promise<number> {
  let totalVolume = 0;

  const queryTemplate = (isMakerTokenSoldByMaker: boolean) => `
   query GetOrderFilledEvents($assetId: String!, $usdcId: String!, $first: Int!, $skip: Int!) {
     orderFilledEvents(
       where: { ${
         isMakerTokenSoldByMaker
           ? "makerAssetId: $assetId, takerAssetId: $usdcId"
           : "takerAssetId: $assetId, makerAssetId: $usdcId"
       } },
       orderBy: timestamp,
       orderDirection: asc,
       first: $first,
       skip: $skip
     ) {
       makerAssetId
       takerAssetId
       makerAmountFilled
       takerAmountFilled
     }
   }
 `;

  const fetchPages = async (
    isMakerTokenSoldByMaker: boolean
  ): Promise<void> => {
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const response = await fetch(SUBGRAPH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: queryTemplate(isMakerTokenSoldByMaker),
            variables: {
              assetId: tokenId,
              usdcId: USDC_ID,
              first: MAX_RESULTS,
              skip,
            },
          }),
        });

        if (!response.ok) {
          error(`Query failed for token ${tokenId}: ${response.status}`);
          break;
        }

        const result = await response.json();
        if (result.errors) {
          error(
            `Query errors for token ${tokenId}: ${JSON.stringify(
              result.errors
            )}`
          );
          break;
        }

        const events = result.data?.orderFilledEvents || [];
        if (events.length === 0) break;

        events.forEach(
          (event: {
            makerAssetId: string;
            takerAssetId: string;
            makerAmountFilled: string;
            takerAmountFilled: string;
          }) => {
            const amount = isMakerTokenSoldByMaker
              ? event.makerAmountFilled
              : event.takerAmountFilled;
            totalVolume += parseFloat(formatUnits(amount, USDCE_DIGITS));
          }
        );

        skip += events.length;
        hasMore = events.length === MAX_RESULTS;
      } catch (err) {
        error(`Error fetching for token ${tokenId}, skip: ${skip}:`, err);
        break;
      }
    }
  };

  await fetchPages(true); // Maker sells token for USDC
  await fetchPages(false); // Maker buys token with USDC

  log(`Fetched volume for ${tokenId}: ${totalVolume}`);
  return Number(totalVolume.toFixed(3));
}

async function collectMarketContext() {
  try {
    const max = dayjs().add(14, "day").toDate();
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
      );

    markets = markets.filter((market) => !isSportsMarket(market.question));

    log(`Found ${markets.length} active markets`);
    const marketDataList = [];

    for (let i = 0; i < markets.length; i++) {
      const market = markets[i]!;
      log(`Processing market ${i + 1}/${markets.length}: ${market.question}`);

      const tokens = await db
        .select()
        .from(tokenSchema)
        .where(eq(tokenSchema.marketId, market.id));

      let hasValidPricing = false;

      for (const token of tokens) {
        const price = parseFloat(token.price?.toString() || "0");

        // Check if the price is at least MIN_TOKEN_PERCENTAGE/100 and at most (100-MIN_TOKEN_PERCENTAGE)/100
        // For MIN_TOKEN_PERCENTAGE=2, token is valid if 0.02 <= price <= 0.98
        if (
          price >= MIN_TOKEN_PERCENTAGE / 100 &&
          price <= (100 - MIN_TOKEN_PERCENTAGE) / 100
        ) {
          hasValidPricing = true;
          break;
        }
      }

      // Skip this market if no token has valid pricing
      if (!hasValidPricing) continue;

      const outcomeData: Record<string, number> = {};
      let totalVolume = 0;
      let validTokenCount = 0;

      for (const token of tokens) {
        if (!token.tokenId) continue;
        const volume = await getSubgraphConditionalTokenVolume(token.tokenId);
        totalVolume += volume;
        validTokenCount++;

        const price = parseFloat(token.price?.toString() || "0");
        const outcome = token.outcome || "Unknown";

        outcomeData[outcome] = price;
      }

      // Calculate normalized volume per token for reporting
      const normalizedVolume =
        validTokenCount > 0 ? totalVolume / validTokenCount : 0;

      // Calculate slippage percentage inline and check if it's too high
      const slippagePercentage =
        normalizedVolume === 0
          ? Infinity
          : (PORTFOLIO_VALUE / normalizedVolume) * 100;

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

      // Group and save after each market is processed
      const marketGroupsMap: Record<string, typeof marketDataList> = {};
      marketDataList.forEach((m) => {
        const groupId = m.questionId.substring(0, 60);
        (marketGroupsMap[groupId] ??= []).push(m);
      });

      const groupedMarkets = Object.entries(marketGroupsMap)
        .map(([groupId, markets]) => ({
          endDate: markets[0]?.endDate!,
          rules: markets[0]?.description,
          markets: markets.map((market) => ({
            question: market.question,
            outcomes: market.outcomes,
            volume: market.volume,
          })),
        }))
        .sort(
          (a, b) =>
            new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
        );

      writeFileSync(
        "./market-context.yml",
        yamlStringify(groupedMarkets, {
          indent: 2,
          lineWidth: 120,
        })
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
  await syncMarkets();
  await collectMarketContext();
}

main().catch((err) => {
  error(err);
  process.exit(1);
});
