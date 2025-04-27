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
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/prod/gn";
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

interface TradePoint {
  ts: number;
  time: string;
  price: number;
  volume: number;
  size: number;
  count: number;
}

// Parse tweet range from market question
function parseTweetRange(question: string): { min: number; max: number | null } | null {
  const q = question.replace(/–/g, "-");
  
  let m = q.match(/(\d+)\s*-\s*(\d+)\s+times/i);
  if (m?.[1] && m[2]) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  
  m = q.match(/less\s+than\s+(\d+)\s+times/i);
  if (m?.[1]) return { min: 0, max: parseInt(m[1], 10) - 1 };
  
  m = q.match(/(\d+)\s+or\s+more\s+times/i);
  if (m?.[1]) return { min: parseInt(m[1], 10), max: null };
  
  m = q.match(/(\d+)\s*-\s*(\d+).*?times/i);
  if (m?.[1] && m[2]) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  
  log(`Could not parse range from: "${question}"`);
  return null;
}

// Get market dates
function getMarketDates(market: Pick<typeof marketSchema.$inferSelect, "id" | "endDateIso">): { startDateIso: Date } | null {
  if (!market.endDateIso) return null;
  return { startDateIso: dayjs(market.endDateIso).subtract(7, "day").toDate() };
}

// Find Elon tweet markets
async function findElonTweetMarkets(): Promise<TweetRange[]> {
  const markets = await db
    .select({ id: marketSchema.id, question: marketSchema.question, questionId: marketSchema.questionId, endDateIso: marketSchema.endDateIso })
    .from(marketSchema)
    .where(and(ilike(marketSchema.question, "Will Elon tweet % times %"), eq(marketSchema.active, true)));

  if (markets.length === 0) return [];
  
  const marketIds = markets.map(m => m.id);
  const tokens = await db.select().from(tokenSchema).where(inArray(tokenSchema.marketId, marketIds));
  
  const tokensByMarket = tokens.reduce((acc, token) => {
    (acc[token.marketId] ??= []).push(token);
    return acc;
  }, {} as Record<number, typeof tokens>);
  
  return markets
    .map(market => {
      const range = parseTweetRange(market.question);
      const dates = getMarketDates(market);
      if (!range || !dates) return null;
      
      return {
        ...range,
        marketId: market.id,
        questionId: market.questionId,
        question: market.question,
        startDateIso: dates.startDateIso,
        endDateIso: market.endDateIso,
        tokens: tokensByMarket[market.id] || []
      };
    })
    .filter(Boolean) as TweetRange[];
}

// Fetch trades for a token
async function fetchTrades(tokenId: string, startTs: number, endTs: number): Promise<TradeEvent[]> {
  const allTrades: TradeEvent[] = [];
  
  // Fetch maker trades (token sold for USDC)
  await fetchTradesBatch(allTrades, tokenId, startTs, endTs, true);
  
  // Fetch taker trades (token bought with USDC)
  await fetchTradesBatch(allTrades, tokenId, startTs, endTs, false);
  
  log(`Total trades for ${tokenId}: ${allTrades.length}`);
  return allTrades;
}

// Helper to fetch one side of trades
async function fetchTradesBatch(trades: TradeEvent[], tokenId: string, startTs: number, endTs: number, isMaker: boolean): Promise<void> {
  let skip = 0;
  let hasMore = true;
  const tradeType = isMaker ? "MAKER" : "TAKER";
  
  const query = `
    query GetTrades($tokenId: String!, $usdcId: String!, $startTs: BigInt!, $endTs: BigInt!, $first: Int!, $skip: Int!) {
      orderFilledEvents(
        where: {
          ${isMaker ? `makerAssetId: $tokenId, takerAssetId: $usdcId` : `makerAssetId: $usdcId, takerAssetId: $tokenId`},
          timestamp_gte: $startTs,
          timestamp_lte: $endTs
        },
        orderBy: timestamp,
        orderDirection: asc,
        first: $first,
        skip: $skip
      ) {
        id
        timestamp
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
      }
    }
  `;

  while (hasMore) {
    try {
      log(`Fetching ${tradeType} trades with skip=${skip}...`);
      
      const res = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query, 
          variables: {
            tokenId,
            usdcId: USDC_ID,
            startTs: startTs.toString(),
            endTs: endTs.toString(),
            first: MAX_RESULTS,
            skip
          }
        })
      });
      
      if (!res.ok) throw new Error(`Query failed: ${res.status}`);
      
      const data = await res.json();
      if (data.errors) throw new Error(JSON.stringify(data.errors));
      
      const batch = data.data?.orderFilledEvents || [];
      trades.push(...batch);
      
      log(`Fetched ${batch.length} ${tradeType} trades.`);
      
      hasMore = batch.length === MAX_RESULTS;
      if (hasMore) skip += MAX_RESULTS;
      
      await sleep(250);
    } catch (err) {
      error(`Error fetching ${tradeType} trades:`, err);
      hasMore = false;
    }
  }
}

// Process trades into different time granularities
function processTrades(trades: TradeEvent[]) {
  // Process second-level data (raw timestamps)
  const secondData = processTradesAtGranularity(trades, 1);
  
  // Also process minute-level data for smoother visualization
  const minuteData = processTradesAtGranularity(trades, 60);
  
  return { secondData, minuteData };
}

// Process trades at a specific time granularity
function processTradesAtGranularity(trades: TradeEvent[], intervalSeconds: number): TradePoint[] {
  const dataPoints = new Map<number, TradePoint>();
  
  for (const trade of trades) {
    const rawTs = parseInt(trade.timestamp, 10);
    // Round down to the nearest interval
    const ts = Math.floor(rawTs / intervalSeconds) * intervalSeconds;
    
    // Calculate price and volume
    const isBuy = trade.makerAssetId === USDC_ID;
    const baseAmount = BigInt(isBuy ? trade.takerAmountFilled : trade.makerAmountFilled);
    const quoteAmount = BigInt(isBuy ? trade.makerAmountFilled : trade.takerAmountFilled);
    
    if (baseAmount === 0n) continue;
    
    const price = parseFloat(formatUnits(
      (quoteAmount * 10n**BigInt(DECIMALS)) / baseAmount,
      DECIMALS
    ));
    
    const size = parseFloat(formatUnits(baseAmount, DECIMALS));
    const volume = parseFloat(formatUnits(quoteAmount, DECIMALS));
    
    // Store at proper time interval
    const existing = dataPoints.get(ts);
    
    if (!existing) {
      dataPoints.set(ts, {
        ts,
        time: dayjs.unix(ts).utc().toISOString(),
        price,
        volume,
        size,
        count: 1
      });
    } else {
      existing.price = price; // Last price in interval
      existing.volume += volume;
      existing.size += size;
      existing.count++;
    }
  }
  
  return Array.from(dataPoints.values()).sort((a, b) => a.ts - b.ts);
}

// Main function
async function main() {
  const markets = await findElonTweetMarkets();
  
  const referenceDate = dayjs().subtract(0, "day").toDate();
  log(`Finding markets active on ${dayjs(referenceDate).format("YYYY-MM-DD")}`);
  
  const activeMarkets = markets
    .filter(m => 
      referenceDate >= m.startDateIso && 
      (m.endDateIso ? referenceDate <= m.endDateIso : true)
    )
    .sort((a, b) => a.min - b.min);
  
  const groupedMarkets = activeMarkets.reduce((groups, market) => {
    const key = market.questionId.substring(0, 60);
    (groups[key] ??= []).push(market);
    return groups;
  }, {} as Record<string, TweetRange[]>);
  
  const marketGroup = Object.values(groupedMarkets)[0];
  const market = marketGroup?.[0];
  
  if (!market) return log("No active markets found.");
  
  log(`Processing market: "${market.question}"`);
  
  const tradeHistoryByToken: Record<string, {
    second: TradePoint[],
    minute: TradePoint[]
  }> = {};
  
  // Process each token (YES/NO)
  for (const token of market.tokens) {
    if (!token.tokenId) {
      log(`Token ID missing for outcome: ${token.outcome}`);
      continue;
    }
    
    log(`--- Processing ${token.outcome} (ID: ${token.tokenId.slice(0, 8)}...) ---`);
    
    const startTs = dayjs(market.startDateIso).unix();
    const endTs = market.endDateIso ? dayjs(market.endDateIso).unix() : dayjs().unix();
    
    const trades = await fetchTrades(token.tokenId, startTs, endTs);
    
    if (trades.length === 0) {
      log(`No trades found for ${token.outcome}`);
      continue;
    }
    
    // Process into multiple time granularities
    const { secondData, minuteData } = processTrades(trades);
    tradeHistoryByToken[token.tokenId] = {
      second: secondData,
      minute: minuteData
    };
    
    log(`Processed ${secondData.length} seconds and ${minuteData.length} minutes of data for ${token.outcome}`);
    
    // Show samples of second-level data
    if (secondData.length > 0) {
      log(`First 3 seconds of data for ${token.outcome}:`);
      console.table(secondData.slice(0, 10));
      
      if (secondData.length > 3) {
        log(`Last 3 seconds of data for ${token.outcome}:`);
        console.table(secondData.slice(-10));
      }
    }
    
    // Show samples of minute-level data
    if (minuteData.length > 0) {
      log(`First 3 minutes of data for ${token.outcome}:`);
      console.table(minuteData.slice(0, 10));
      
      if (minuteData.length > 3) {
        log(`Last 3 minutes of data for ${token.outcome}:`);
        console.table(minuteData.slice(-10));
      }
    }
  }
  
  log("--- Processing complete ---");
  
  // Return data for further processing (e.g., visualization, analysis)
  return tradeHistoryByToken;
}

main().catch(err => {
  error("Unhandled error:", err);
  process.exit(1);
});