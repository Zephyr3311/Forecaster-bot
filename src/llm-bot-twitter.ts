import { sleep } from "bun";
import { error, log } from "console";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { formatUnits } from "ethers";
import { db } from "./db";
import { marketSchema, tokenSchema } from "./db/schema";

dayjs.extend(utc);

// --- Subgraph Endpoint ---
const SUBGRAPH_ENDPOINT =
  "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/prod/gn";

// --- Constants ---
const USDC_TOKEN_ID_STR = "0"; // USDC is represented as assetId 0 in OrderFilled events
const COLLATERAL_DECIMALS = 6; // USDC decimals
const MAX_RESULTS_PER_QUERY = 1000; // The Graph has a limit per query

interface TweetRange {
  marketId: number;
  questionId: string;
  question: string;
  min: number;
  max: number | null; // null means "or more"
  startDateIso: Date;
  endDateIso: Date | null;
  tokens: (typeof tokenSchema.$inferSelect)[];
}

// Interface for the data returned by the subgraph query
interface SubgraphOrderFilledEvent {
  id: string; // tx_hash + log_index
  transactionHash: string;
  timestamp: string; // String representation of BigInt (Unix seconds)
  maker: string;
  taker: string;
  makerAssetId: string; // String representation of BigInt
  takerAssetId: string; // String representation of BigInt
  makerAmountFilled: string; // String representation of BigInt
  takerAmountFilled: string; // String representation of BigInt
  fee: string; // String representation of BigInt
}

interface SubgraphResponse {
  data: {
    orderFilledEvents: SubgraphOrderFilledEvent[];
  };
  errors?: any[]; // Optional error field
}

interface MinutePriceData {
  timestamp: number; // Unix timestamp (seconds) for the start of the minute
  readableTime: string; // Human-readable UTC time
  lastPrice: number;
  volume: number; // Sum of USDC value traded (approximate)
  sizeVolume: number; // Sum of shares traded
  tradeCount: number;
}

function parseTweetRange(
  question: string
): { min: number; max: number | null } | null {
  const normalizedQuestion = question.replace(/–/g, "-");

  // Pattern for standard ranges (e.g., "150-174 times")
  let match = normalizedQuestion.match(/(\d+)\s*-\s*(\d+)\s+times/i);
  if (match?.[1] && match[2]) {
    return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  }

  // Pattern for "less than X times"
  match = normalizedQuestion.match(/less\s+than\s+(\d+)\s+times/i);
  if (match?.[1]) {
    return { min: 0, max: parseInt(match[1], 10) - 1 };
  }

  // Pattern for "X or more times"
  match = normalizedQuestion.match(/(\d+)\s+or\s+more\s+times/i);
  if (match?.[1]) {
    return { min: parseInt(match[1], 10), max: null };
  }

  // Fallback pattern for any numbers followed by times
  match = normalizedQuestion.match(/(\d+)\s*-\s*(\d+).*?times/i);
  if (match?.[1] && match[2]) {
    return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  }

  log(`Could not parse tweet range from question: "${question}"`);
  return null;
}

function getDatesFromMarket(
  market: Pick<typeof marketSchema.$inferSelect, "id" | "endDateIso">
): { startDateIso: Date } | null {
  try {
    if (!market.endDateIso) {
      log(`Missing end date for market: ${market.id}`);
      return null;
    }
    return {
      startDateIso: dayjs(market.endDateIso).subtract(7, "day").toDate(),
    };
  } catch (err) {
    log(`Failed to calculate dates for market: ${market.id}`);
    return null;
  }
}

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

  const marketIds = markets.map((market) => market.id);
  const tokens =
    marketIds.length > 0
      ? await db
          .select()
          .from(tokenSchema)
          .where(inArray(tokenSchema.marketId, marketIds))
      : [];

  const tokensByMarket = tokens.reduce((acc, token) => {
    if (!acc[token.marketId]) acc[token.marketId] = [];
    acc[token.marketId]?.push(token);
    return acc;
  }, {} as Record<number, (typeof tokenSchema.$inferSelect)[]>);

  const parsedMarkets: TweetRange[] = [];

  for (const market of markets) {
    const range = parseTweetRange(market.question);
    if (!range) continue;

    const dates = getDatesFromMarket(market);
    if (!dates) continue;

    parsedMarkets.push({
      ...range,
      marketId: market.id,
      questionId: market.questionId,
      question: market.question,
      startDateIso: dates.startDateIso,
      endDateIso: market.endDateIso,
      tokens: tokensByMarket[market.id] || [],
    });
  }

  return parsedMarkets;
}

async function fetchAllTradesForToken(
  tokenId: string,
  startTs: number,
  endTs: number
): Promise<SubgraphOrderFilledEvent[]> {
  let allTrades: SubgraphOrderFilledEvent[] = [];
  let skip = 0;
  let hasMore = true;

  log(`Starting trade fetch for token ${tokenId}...`);

  // First query for trades where the token is the makerAssetId
  let makerQuery = `
    query GetMakerTrades($tokenId: String!, $startTs: BigInt!, $endTs: BigInt!, $first: Int!, $skip: Int!) {
      orderFilledEvents(
        where: {
          makerAssetId: $tokenId,
          takerAssetId: "0",
          timestamp_gte: $startTs,
          timestamp_lte: $endTs
        },
        orderBy: timestamp,
        orderDirection: asc,
        first: $first,
        skip: $skip
      ) {
        id
        transactionHash
        timestamp
        maker
        taker
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
        fee
      }
    }
  `;

  // Try to fetch all maker trades
  while (hasMore) {
    try {
      log(`Fetching MAKER trades (token as maker) with skip=${skip}...`);
      
      const response = await fetch(SUBGRAPH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query: makerQuery, 
          variables: {
            tokenId: tokenId,
            startTs: startTs.toString(),
            endTs: endTs.toString(),
            first: MAX_RESULTS_PER_QUERY,
            skip: skip
          }
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Query failed: ${response.status}`);
      }
      
      const result: SubgraphResponse = await response.json();
      
      if (result.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
      }
      
      const trades = result.data?.orderFilledEvents || [];
      allTrades = allTrades.concat(trades);
      
      log(`Fetched ${trades.length} MAKER trades.`);
      
      if (trades.length < MAX_RESULTS_PER_QUERY) {
        hasMore = false;
      } else {
        skip += MAX_RESULTS_PER_QUERY;
      }
      
      await sleep(500);
      
    } catch (err) {
      error(`Error fetching MAKER trades: ${err}`);
      hasMore = false;
    }
  }
  
  // Reset for the second query
  skip = 0;
  hasMore = true;
  
  // Second query for trades where the token is the takerAssetId
  let takerQuery = `
    query GetTakerTrades($tokenId: String!, $startTs: BigInt!, $endTs: BigInt!, $first: Int!, $skip: Int!) {
      orderFilledEvents(
        where: {
          makerAssetId: "0",
          takerAssetId: $tokenId,
          timestamp_gte: $startTs,
          timestamp_lte: $endTs
        },
        orderBy: timestamp,
        orderDirection: asc,
        first: $first,
        skip: $skip
      ) {
        id
        transactionHash
        timestamp
        maker
        taker
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
        fee
      }
    }
  `;
  
  // Try to fetch all taker trades
  while (hasMore) {
    try {
      log(`Fetching TAKER trades (token as taker) with skip=${skip}...`);
      
      const response = await fetch(SUBGRAPH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query: takerQuery, 
          variables: {
            tokenId: tokenId,
            startTs: startTs.toString(),
            endTs: endTs.toString(),
            first: MAX_RESULTS_PER_QUERY,
            skip: skip
          }
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Query failed: ${response.status}`);
      }
      
      const result: SubgraphResponse = await response.json();
      
      if (result.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
      }
      
      const trades = result.data?.orderFilledEvents || [];
      allTrades = allTrades.concat(trades);
      
      log(`Fetched ${trades.length} TAKER trades.`);
      
      if (trades.length < MAX_RESULTS_PER_QUERY) {
        hasMore = false;
      } else {
        skip += MAX_RESULTS_PER_QUERY;
      }
      
      await sleep(500);
      
    } catch (err) {
      error(`Error fetching TAKER trades: ${err}`);
      hasMore = false;
    }
  }
  
  log(`Finished fetching all trades for ${tokenId}. Total trades: ${allTrades.length}`);
  return allTrades;
}

async function main() {
  const allMarkets = await findElonTweetMarkets();

  // Find active markets based on current date (adjusted for test purposes)
  const today = dayjs().subtract(21, "day").toDate();
  log(`Checking for markets active on ${dayjs(today).format("YYYY-MM-DD")}`);

  const activeMarkets = allMarkets
    .filter(
      (market) =>
        today >= market.startDateIso &&
        (market.endDateIso ? today <= market.endDateIso : true)
    )
    .sort((a, b) => a.min - b.min);

  const groupedMarkets = activeMarkets.reduce((groups, market) => {
    const basePattern = market.questionId.substring(0, 60);
    (groups[basePattern] ||= []).push(market);
    return groups;
  }, {} as Record<string, TweetRange[]>);

  const markets = Object.values(groupedMarkets)[0];
  const market = markets?.[0];

  if (!market) return log("No active markets found.");

  log(`Processing market: "${market.question}"`);

  // Create a map to store minute-by-minute price data for each token
  const allMinuteHistories: Record<string, MinutePriceData[]> = {};

  // We'll process both YES and NO outcomes for a complete market view
  for (const token of market.tokens) {
    if (!token.tokenId) {
      log(`Token ID missing for outcome: ${token.outcome}`);
      continue;
    }

    log(
      `--- Processing outcome: ${token.outcome} (Token ID: ${token.tokenId}) ---`
    );

    // Convert dates to Unix timestamps for the subgraph query
    const startTs = dayjs(market.startDateIso).unix();
    const endTs = market.endDateIso
      ? dayjs(market.endDateIso).unix()
      : dayjs().unix();

    // Fetch historical trade data using the subgraph
    const trades = await fetchAllTradesForToken(token.tokenId, startTs, endTs);

    if (!trades.length) {
      log(`No trades found for ${token.outcome} in the specified date range.`);
      continue;
    }

    // Aggregate trades into minute-by-minute data
    const minuteData = new Map<number, MinutePriceData>();

    for (const trade of trades) {
      const timestamp = parseInt(trade.timestamp, 10);
      const minuteTimestamp = dayjs
        .unix(timestamp)
        .utc()
        .startOf("minute")
        .unix();

      let price: number;
      let sizeShares: number;
      let collateralAmount: number;

      // Determine price and size based on which asset is USDC (ID "0")
      if (trade.makerAssetId === USDC_TOKEN_ID_STR) {
        // Buy order
        const makerAmount = BigInt(trade.makerAmountFilled);
        const takerAmount = BigInt(trade.takerAmountFilled);
        if (takerAmount === 0n) continue; // Avoid division by zero
        price = parseFloat(
          formatUnits(
            (makerAmount * 10n ** BigInt(COLLATERAL_DECIMALS)) / takerAmount,
            COLLATERAL_DECIMALS
          )
        );
        sizeShares = parseFloat(formatUnits(takerAmount, COLLATERAL_DECIMALS));
        collateralAmount = parseFloat(
          formatUnits(makerAmount, COLLATERAL_DECIMALS)
        );
      } else if (trade.takerAssetId === USDC_TOKEN_ID_STR) {
        // Sell order
        const makerAmount = BigInt(trade.makerAmountFilled);
        const takerAmount = BigInt(trade.takerAmountFilled);
        if (makerAmount === 0n) continue; // Avoid division by zero
        price = parseFloat(
          formatUnits(
            (takerAmount * 10n ** BigInt(COLLATERAL_DECIMALS)) / makerAmount,
            COLLATERAL_DECIMALS
          )
        );
        sizeShares = parseFloat(formatUnits(makerAmount, COLLATERAL_DECIMALS));
        collateralAmount = parseFloat(
          formatUnits(takerAmount, COLLATERAL_DECIMALS)
        );
      } else {
        log(
          `Warning: Trade ${trade.id} does not involve USDC directly, skipping.`
        );
        continue; // Skip trades not directly against USDC
      }

      const existingData = minuteData.get(minuteTimestamp);

      if (!existingData) {
        minuteData.set(minuteTimestamp, {
          timestamp: minuteTimestamp,
          readableTime: dayjs.unix(minuteTimestamp).utc().toISOString(),
          lastPrice: price,
          volume: collateralAmount,
          sizeVolume: sizeShares,
          tradeCount: 1,
        });
      } else {
        existingData.lastPrice = price; // Last price in the minute
        existingData.volume += collateralAmount;
        existingData.sizeVolume += sizeShares;
        existingData.tradeCount++;
      }
    }

    // Sort the minute data by timestamp
    const minuteHistory = Array.from(minuteData.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );

    allMinuteHistories[token.tokenId] = minuteHistory;
    log(
      `Processed ${minuteHistory.length} minutes of price data for ${token.outcome}.`
    );

    // Show sample of the data for verification
    if (minuteHistory.length > 0) {
      log(`First 3 minutes of data for ${token.outcome}:`);
      console.table(minuteHistory.slice(0, 3));

      if (minuteHistory.length > 3) {
        log(`Last 3 minutes of data for ${token.outcome}:`);
        console.table(minuteHistory.slice(-3));
      }
    }
  }

  log("--- Processing complete ---");

  // From this data, you can now:
  // 1. Calculate the probability for each outcome
  // 2. Track price movements over time
  // 3. Identify significant trading events
  // 4. Calculate total volume per day
}

main().catch((err) => {
  error("Unhandled error:", err);
  process.exit(1);
});
