import { log } from "console";
import dayjs from "dayjs";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { db } from "./db";
import { marketSchema, tokenSchema } from "./db/schema";
import { getClobClient, getWallet } from "./utils/web3";

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

interface TweetRange {
  min: number;
  max: number | null; // null means "or more"
  question: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  tokens: (typeof tokenSchema.$inferSelect)[];
}

function parseTweetRange(
  question: string
): { min: number; max: number | null } | null {
  // Handle en-dash (–) vs regular hyphen (-)
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

  // Pattern for specific narrow ranges (e.g., "100-109 times")
  match = normalizedQuestion.match(/(\d+)\s*-\s*(\d+)\s+times/i);
  if (match?.[1] && match[2]) {
    return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  }

  // Fallback pattern for any numbers followed by times
  match = normalizedQuestion.match(/(\d+)\s*-\s*(\d+).*?times/i);
  if (match?.[1] && match[2]) {
    return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  }

  // Log failure to parse
  log(`Could not parse tweet range from question: "${question}"`);
  return null;
}

function getDatesFromMarket(
  market: Pick<typeof marketSchema.$inferSelect, "id" | "endDateIso">
): { startDate: string; endDate: string } | null {
  try {
    // Parse the end date from the ISO string
    const endDate = dayjs(market.endDateIso);

    // Assume markets are always 7 days - this is clear from all examples
    const startDate = endDate.subtract(7, "day");

    return {
      startDate: startDate.format("YYYY-MM-DD"),
      endDate: endDate.format("YYYY-MM-DD"),
    };
  } catch (error) {
    log(`Failed to calculate dates for market: ${market.id}`);
    return null;
  }
}

async function findElonTweetMarkets(): Promise<TweetRange[]> {
  const markets = await db
    .select({
      id: marketSchema.id,
      question: marketSchema.question,
      endDateIso: marketSchema.endDateIso,
    })
    .from(marketSchema)
    .where(
      and(
        ilike(marketSchema.question, "Will Elon tweet % times %"),
        eq(marketSchema.active, true)
      )
    );

  log(`Found ${markets.length} Elon tweet markets in DB`);

  // Second query: Get tokens for these markets
  const marketIds = markets.map((market) => market.id);
  const tokens =
    marketIds.length > 0
      ? await db
          .select()
          .from(tokenSchema)
          .where(inArray(tokenSchema.marketId, marketIds))
      : [];

  // Group tokens by marketId
  const tokensByMarket = tokens.reduce((acc, token) => {
    if (!acc[token.marketId]) {
      acc[token.marketId] = [];
    }
    acc[token.marketId]?.push(token);
    return acc;
  }, {} as Record<number, typeof tokens>);

  const parsedMarkets: TweetRange[] = [];

  for (const market of markets) {
    const range = parseTweetRange(market.question)!;
    const dates = getDatesFromMarket(market)!;

    parsedMarkets.push({
      ...range,
      question: market.question,
      startDate: dates.startDate,
      endDate: dates.endDate,
      tokens: tokensByMarket[market.id] || [],
    });

    log(
      `Successfully parsed market: ${market.question} (${dates.startDate} to ${dates.endDate})`
    );
  }

  return parsedMarkets;
}

async function main() {
  const allMarkets = await findElonTweetMarkets();

  const today = dayjs().format("YYYY-MM-DD");
  log(`Checking for markets active on ${today}`);

  const activeMarkets = allMarkets
    .filter((market) => today >= market.startDate && today <= market.endDate)
    .sort((a, b) => a.min - b.min);

  log(`Found ${activeMarkets.length} active markets`);
  for (const market of activeMarkets) {
    console.log(`- ${market.question} min: ${market.min}, max: ${market.max}`);
  }
}

main();
