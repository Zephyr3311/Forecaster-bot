import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import { and, eq, lte } from "drizzle-orm";
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
import dayjs from "dayjs";
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

// Modified collectMarketContext function
async function collectMarketContext() {
  try {
    const sevenDaysFromNow = dayjs().add(1, "day").toDate();

    // Filter markets ending within the next 7 days
    const markets = await db
      .select()
      .from(marketSchema)
      .where(
        and(
          eq(marketSchema.active, true),
          eq(marketSchema.closed, false),
          lte(marketSchema.endDateIso, sevenDaysFromNow)
        )
      );

    log(`Found ${markets.length} active markets`);

    const marketDataList = [];

    for (const market of markets) {
      const tokens = await db
        .select()
        .from(tokenSchema)
        .where(eq(tokenSchema.marketId, market.id));

      const outcomes = [];

      for (const token of tokens) {
        if (!token.tokenId) continue;

        const volume = await getSubgraphConditionalTokenVolume(token.tokenId);
        const price = parseFloat(token.price?.toString() || "0");

        outcomes.push({
          outcome: token.outcome || "Unknown",
          price,
          percentage: price * 100,
          volume,
        });
      }

      marketDataList.push({
        question: market.question,
        questionId: market.questionId, // Keep temporarily for grouping
        endDate: market.endDateIso?.toISOString() || null, // Keep temporarily for group level
        outcomes,
      });
    }

    // Group by questionId prefix (first 60 chars)
    const marketGroupsMap: Record<string, typeof marketDataList> = {};
    marketDataList.forEach((market) => {
      const groupId = market.questionId.substring(0, 60);
      (marketGroupsMap[groupId] ??= []).push(market);
    });

    // Create optimized groups with shared endDate at top level
    const groupedMarkets = Object.entries(marketGroupsMap).map(
      ([groupId, markets]) => {
        // Get endDate from first market in group (all should be the same)
        const endDate = markets[0]?.endDate;

        // Create simplified market objects without questionId and endDate
        const simplifiedMarkets = markets.map((market) => ({
          question: market.question,
          outcomes: market.outcomes,
        }));

        return {
          groupId,
          endDate,
          markets: simplifiedMarkets,
        };
      }
    );

    writeFileSync(
      "./market-context.yml",
      yamlStringify(groupedMarkets, {
        indent: 2,
        lineWidth: 120,
      })
    );
    log(`Market context saved with ${groupedMarkets.length} groups`);
  } catch (err) {
    error(`Error collecting market context:`, err);
  }
}

main().catch((err) => {
  error(err);
  process.exit(1);
});

async function main() {
  await collectMarketContext();
}
