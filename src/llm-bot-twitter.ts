import { sleep } from "bun";
import { error, log } from "console";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { formatUnits } from "ethers";
import { db } from "./db";
import { marketSchema, tokenSchema } from "./db/schema";

dayjs.extend(utc);

// Constants
const SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/prod/gn";
const USDC_ID = "0";
const DECIMALS = 6;
const MAX_RESULTS = 1000;

// Types
interface TweetRange {
  marketId: number;
  questionId: string;
  question: string;
  min: number;
  max: number | null;
  startDateIso: Date;
  endDateIso: Date | null;
  tokens: (typeof tokenSchema.$inferSelect)[];
}

interface TradeEvent {
  id: string;
  timestamp: string;
  makerAssetId: string;
  takerAssetId: string;
  makerAmountFilled: string;
  takerAmountFilled: string;
}

interface Trade {
  ts: number;
  time: string;
  price: number;
  volume: number;
  size: number;
}

// Parse tweet range from question
function parseTweetRange(
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
async function findElonTweetMarkets(): Promise<TweetRange[]> {
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

  if (!markets.length) return [];

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
async function fetchTrades(
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
async function fetchTradesBatch(
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
            (quoteAmount * 10n ** BigInt(DECIMALS)) / baseAmount,
            DECIMALS
          )
        );

        trades.push({
          ts,
          time: dayjs.unix(ts).utc().toISOString(),
          price,
          volume: parseFloat(formatUnits(quoteAmount, DECIMALS)),
          size: parseFloat(formatUnits(baseAmount, DECIMALS)),
        });
      }

      hasMore = events.length === MAX_RESULTS;
      if (hasMore) skip += MAX_RESULTS;

      await sleep(200);
    } catch (err) {
      error(`Error fetching trades:`, err);
      hasMore = false;
    }
  }
}

async function main() {
  const markets = await findElonTweetMarkets();
  const activeMarkets = markets
    .filter((m) => {
      const now = dayjs().toDate();
      return now >= m.startDateIso && (!m.endDateIso || now <= m.endDateIso);
    })
    .sort((a, b) => a.min - b.min);

  const groupedMarkets = activeMarkets.reduce((groups, market) => {
    const key = market.questionId.substring(0, 60);
    (groups[key] ??= []).push(market);
    return groups;
  }, {} as Record<string, TweetRange[]>);

  const market = Object.values(groupedMarkets)[0]?.[0];
  if (!market) return log("No active markets found.");

  log(`Processing market: "${market.question}"`);

  const tradeHistory: Record<string, Trade[]> = {};

  for (const token of market.tokens) {
    if (!token.tokenId) continue;

    log(`--- Processing ${token.outcome} ---`);

    const startTs = dayjs(market.startDateIso).unix();
    const endTs = market.endDateIso
      ? dayjs(market.endDateIso).unix()
      : dayjs().unix();

    const trades = await fetchTrades(token.tokenId, startTs, endTs);
    tradeHistory[token.tokenId] = trades;

    log(`Processed ${trades.length} trades for ${token.outcome}`);
    console.table(trades.slice(0, 10));
    console.table(trades.slice(-10));
  }

  return tradeHistory;
}

main().catch((err) => {
  error("Unhandled error:", err);
  process.exit(1);
});
