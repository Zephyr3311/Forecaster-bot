import { error, log } from "console";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { formatUnits } from "ethers";
import { db } from "../db";
import { marketSchema, tokenSchema, tradeHistorySchema } from "../db/schema";
import {
  BATCH_SIZE,
  MAX_RESULTS,
  SUBGRAPH_URL,
  USDC_DECIMALS,
  USDC_ID,
} from "./constants";
import { syncMarkets } from "./markets";

dayjs.extend(utc);
// Types
export interface TweetRange {
  marketId: number;
  questionId: string;
  question: string;
  min: number;
  max: number | null;
  startDateIso: Date;
  endDateIso: Date | null;
  tokens: (typeof tokenSchema.$inferSelect)[];
}

export interface Trade {
  ts: number;
  time: string;
  price: number;
  volume: number;
  size: number;
}

// Parse tweet range from question
export function parseTweetRange(
  question: string
): { min: number; max: number | null } | null {
  const q = question.replace(/–/g, "-");
  let m = q.match(/(\d+)\s*-\s*(\d+)\s+times/i);
  if (m?.[1] && m[2])
    return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  m = q.match(/less\s+than\s+(\d+)\s+times/i);
  if (m?.[1]) return { min: 0, max: parseInt(m[1], 10) - 1 };
  m = q.match(/(\d+)\s+or\s+more\s+times/i);
  if (m?.[1]) return { min: parseInt(m[1], 10), max: null };
  m = q.match(/(\d+)\s*-\s*(\d+).*?times/i);
  if (m?.[1] && m[2])
    return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  return null;
}

// Find markets
export async function findElonTweetMarkets(): Promise<TweetRange[]> {
  const markets = await db
    .select({
      id: marketSchema.id,
      question: marketSchema.question,
      questionId: marketSchema.questionId,
      endDateIso: marketSchema.endDateIso,
    })
    .from(marketSchema)
    .where(
      and(
        ilike(marketSchema.question, "Will Elon tweet % times %"),
        eq(marketSchema.active, true)
      )
    );

  if (!markets.length) {
    await syncMarkets();
    return findElonTweetMarkets();
  }

  const marketIds = markets.map((m) => m.id);
  const tokens = await db
    .select()
    .from(tokenSchema)
    .where(inArray(tokenSchema.marketId, marketIds));

  const tokensByMarket = tokens.reduce((acc, token) => {
    (acc[token.marketId] ??= []).push(token);
    return acc;
  }, {} as Record<number, typeof tokens>);

  return markets
    .map((market) => {
      const range = parseTweetRange(market.question);
      const startDateIso = market.endDateIso
        ? dayjs(market.endDateIso).subtract(7, "day").toDate()
        : null;
      if (!range || !startDateIso) return null;

      return {
        ...range,
        marketId: market.id,
        questionId: market.questionId,
        question: market.question,
        startDateIso,
        endDateIso: market.endDateIso,
        tokens: tokensByMarket[market.id] || [],
      };
    })
    .filter(Boolean) as TweetRange[];
}

// Fetch all trades for a token
export async function fetchTrades(
  tokenId: string,
  startTs: number,
  endTs: number
): Promise<Trade[]> {
  let trades: Trade[] = [];
  await Promise.all([
    fetchTradesBatch(trades, tokenId, USDC_ID, startTs, endTs),
    fetchTradesBatch(trades, USDC_ID, tokenId, startTs, endTs),
  ]);

  return trades.sort((a, b) => a.ts - b.ts);
}

// Fetch and process trades in a single step
export async function fetchTradesBatch(
  trades: Trade[],
  makerAssetId: string,
  takerAssetId: string,
  startTs: number,
  endTs: number
): Promise<void> {
  let skip = 0;
  let hasMore = true;

  const query = `
    query GetTrades($makerAssetId: String!, $takerAssetId: String!, $startTs: BigInt!, $endTs: BigInt!, $first: Int!, $skip: Int!) {
      orderFilledEvents(
        where: {
          makerAssetId: $makerAssetId,
          takerAssetId: $takerAssetId,
          timestamp_gte: $startTs,
          timestamp_lte: $endTs
        },
        orderBy: timestamp,
        orderDirection: asc,
        first: $first,
        skip: $skip
      ) {
        timestamp
        makerAmountFilled
        takerAmountFilled
      }
    }
  `;

  while (hasMore) {
    try {
      const res = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          variables: {
            makerAssetId,
            takerAssetId,
            startTs: startTs.toString(),
            endTs: endTs.toString(),
            first: MAX_RESULTS,
            skip,
          },
        }),
      });

      if (!res.ok) throw new Error(`Query failed: ${res.status}`);

      const data = await res.json();
      if (data.errors) throw new Error(JSON.stringify(data.errors));

      const events = data.data?.orderFilledEvents || [];

      for (const event of events) {
        const ts = parseInt(event.timestamp, 10);
        const baseAmount = BigInt(
          makerAssetId === USDC_ID
            ? event.takerAmountFilled
            : event.makerAmountFilled
        );
        const quoteAmount = BigInt(
          makerAssetId === USDC_ID
            ? event.makerAmountFilled
            : event.takerAmountFilled
        );

        if (baseAmount === 0n) continue;

        const price = parseFloat(
          formatUnits(
            (quoteAmount * 10n ** BigInt(USDC_DECIMALS)) / baseAmount,
            USDC_DECIMALS
          )
        );

        trades.push({
          ts,
          time: dayjs.unix(ts).utc().toISOString(),
          price,
          volume: parseFloat(formatUnits(quoteAmount, USDC_DECIMALS)),
          size: parseFloat(formatUnits(baseAmount, USDC_DECIMALS)),
        });
      }

      hasMore = events.length === MAX_RESULTS;
      if (hasMore) skip += MAX_RESULTS;
    } catch (err) {
      error(`Error fetching trades:`, err);
      hasMore = false;
    }
  }
}

export async function saveTradesToDatabase(
  tokenId: string,
  outcome: string,
  trades: Trade[]
): Promise<void> {
  if (!trades.length) return;

  log(`Saving ${trades.length} trades to database for ${outcome}`);

  // Process in batches to avoid overwhelming the database
  for (let i = 0; i < trades.length; i += BATCH_SIZE) {
    const batch = trades.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(tradeHistorySchema)
          .values(
            batch.map((trade): typeof tradeHistorySchema.$inferInsert => ({
              tokenId,
              ts: trade.ts,
              time: new Date(trade.time),
              price: String(trade.price),
              volume: String(trade.volume),
              size: String(trade.size),
              outcome,
            }))
          )
          .onConflictDoNothing({
            target: [tradeHistorySchema.tokenId, tradeHistorySchema.ts],
          });
      });
    } catch (err) {
      error(`Error saving batch ${batchNumber}:`, err);
    }
  }
}

export async function syncTradeHistory() {
  const markets = await findElonTweetMarkets();
  // const now = dayjs().toDate();
  // const activeMarkets = markets
  //   .filter(
  //     (m) => now >= m.startDateIso && (!m.endDateIso || now <= m.endDateIso)
  //   )
  //   .sort((a, b) => a.min - b.min);

  const groupedMarkets = markets.reduce((groups, market) => {
    const key = market.questionId.substring(0, 60);
    (groups[key] ??= []).push(market);
    return groups;
  }, {} as Record<string, TweetRange[]>);

  for (const marketGroup of Object.values(groupedMarkets)) {
    for (const market of marketGroup) {
      log(`Processing market: "${market.question}"`);

      for (const token of market.tokens.filter((t) =>
        t.outcome?.toLowerCase().includes("yes")
      )) {
        if (!token.tokenId) continue;

        log(`--- Processing ${token.outcome} ---`);

        const startTs = dayjs(market.startDateIso).unix();
        const endTs = market.endDateIso
          ? dayjs(market.endDateIso).unix()
          : dayjs().unix();

        const trades = await fetchTrades(token.tokenId, startTs, endTs);

        if (!trades.length) {
          log(`No trades found for ${token.outcome}`);
          continue;
        }

        log(`Processed ${trades.length} trades for ${token.outcome}`);
        console.table(trades.slice(0, 5));
        console.table(trades.slice(-5));

        // Save the trades to the database
        await saveTradesToDatabase(token.tokenId, token.outcome || "", trades);
      }
    }
  }

  log("Trade history processing complete");
}
