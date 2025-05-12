import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import dayjs from "dayjs";
import { and, eq, isNull, lte } from "drizzle-orm";
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
    const daysFromNow = dayjs().add(1, "day").toDate();
    const markets = await db
      .select()
      .from(marketSchema)
      .where(
        and(
          isNull(marketSchema.gameStartTime),
          eq(marketSchema.active, true),
          eq(marketSchema.closed, false),
          eq(marketSchema.enableOrderBook, true),
          lte(marketSchema.endDateIso, daysFromNow)
        )
      );

    log(`Found ${markets.length} active markets`);
    const marketDataList = [];

    // Save progress after processing each market
    for (let i = 0; i < markets.length; i++) {
      const market = markets[i]!;
      console.log(
        `Processing market ${i + 1}/${markets.length}: ${market.question}`
      );

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
          volume,
        });
      }

      marketDataList.push({
        question: market.question,
        questionId: market.questionId,
        endDate: market.endDateIso?.toISOString() || null,
        outcomes,
      });

      // Group and save after each market is processed
      const marketGroupsMap: Record<string, typeof marketDataList> = {};
      marketDataList.forEach((m) => {
        const groupId = m.questionId.substring(0, 60);
        (marketGroupsMap[groupId] ??= []).push(m);
      });

      const groupedMarkets = Object.entries(marketGroupsMap)
        .map(([groupId, markets]) => ({
          groupId,
          endDate: markets[0]?.endDate!,
          markets: markets.map((market) => ({
            question: market.question,
            outcomes: market.outcomes,
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

main().catch((err) => {
  error(err);
  process.exit(1);
});

async function main() {
  await collectMarketContext();
}
