import { type Trade } from "@polymarket/clob-client";
import { error, log } from "console";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { db } from "./db";
import { marketSchema, tokenSchema } from "./db/schema";
import { getClobClient, getWallet } from "./utils/web3";

dayjs.extend(utc);
const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

export const INITIAL_CURSOR = "MA==";
export const END_CURSOR = "LTE=";

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

async function main() {
  const allMarkets = await findElonTweetMarkets();

  const today = dayjs().subtract(0, "day").toDate();
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

  const yesToken = market.tokens.find((token) =>
    token.outcome?.toLowerCase().includes("yes")
  );

  if (!yesToken?.tokenId) return log("No YES token found for the market.");

  let allTrades: Trade[] = [];
  let next_cursor: string | undefined = INITIAL_CURSOR;
  let page = 1;
  const startTs = dayjs(market.startDateIso).unix();

  log(
    `Fetching trades for market "${market.question}" since ${dayjs(
      market.startDateIso
    ).format("YYYY-MM-DD")}`
  );

  while (next_cursor && next_cursor !== END_CURSOR) {
    try {
      const tradeResponse = await clobClient.getTradesPaginated(
        { asset_id: yesToken.tokenId },
        next_cursor
      );

      console.log(tradeResponse);

      if (tradeResponse.trades && tradeResponse.trades.length > 0) {
        allTrades = allTrades.concat(tradeResponse.trades);
        log(
          `Fetched ${tradeResponse.trades.length} trades (Total: ${allTrades.length})`
        );

        const oldestTradeTs = dayjs
          .utc(
            tradeResponse.trades[tradeResponse.trades.length - 1]?.match_time
          )
          .unix();

        if (oldestTradeTs < startTs) {
          log(
            "Oldest trade in batch is before start date, stopping pagination"
          );
          break;
        }
      } else {
        log("No more trades found in this page");
      }

      next_cursor = tradeResponse.next_cursor;
      page++;

      if (next_cursor && next_cursor !== END_CURSOR) {
        log(`Fetching trades page ${page} (Cursor: ${atob(next_cursor)})...`);
      }
    } catch (err) {
      error(
        `Error fetching trades for token ${yesToken.tokenId} (Page ${page}):`,
        err
      );
      next_cursor = undefined;
    }
  }

  log(`Finished fetching all trades for market "${market.question}"`);
  // Process the trades here
}

main().catch((err) => {
  error("Unhandled error:", err);
  process.exit(1);
});
