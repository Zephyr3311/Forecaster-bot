import { log } from "console";
import dayjs from "dayjs";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "./db";
import { marketSchema } from "./db/schema";
import { getClobClient, getWallet } from "./utils/web3";

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

interface TweetRange {
  min: number;
  max: number | null; // null means "or more"
  question: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
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
  market: any
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
  const tweetMarkets = await db
    .select({
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

  log(`Found ${tweetMarkets.length} Elon tweet markets in DB`);

  const parsedMarkets: TweetRange[] = [];

  for (const market of tweetMarkets) {
    // Parse the tweet range from the question
    const range = parseTweetRange(market.question);
    if (!range) {
      log(`Skipping market Could not parse tweet range`, market);
      continue;
    }

    // Use ISO date directly rather than parsing from text
    const dates = getDatesFromMarket(market);
    if (!dates) {
      log(`Skipping market Could not determine dates`, market);
      continue;
    }

    parsedMarkets.push({
      ...range,
      question: market.question,
      startDate: dates.startDate,
      endDate: dates.endDate,
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
