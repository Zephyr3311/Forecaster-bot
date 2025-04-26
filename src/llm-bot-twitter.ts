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
  marketId: number;
  marketSlug: string;
  question: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

interface DateRange {
  startMonth: string;
  startDay: number;
  endMonth: string;
  endDay: number;
}

function getMonthNumber(monthStr: string): number | null {
  const months: { [key: string]: number } = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const lowerMonthStr = monthStr?.toLowerCase();
  return lowerMonthStr ? months[lowerMonthStr] ?? null : null;
}

function parseTweetRange(
  question: string
): { min: number; max: number | null } | null {
  // Pattern for ranges like "150-174 times"
  let match = question.match(/(\d+)-(\d+) times/);
  if (match?.[1] && match[2]) {
    return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  }

  // Pattern for "less than X times"
  match = question.match(/less than (\d+) times/i);
  if (match?.[1]) {
    return { min: 0, max: parseInt(match[1], 10) - 1 };
  }

  // Pattern for "X or more times"
  match = question.match(/(\d+) or more times/i);
  if (match?.[1]) {
    return { min: parseInt(match[1], 10), max: null };
  }

  // Log failure to parse
  log(`Could not parse tweet range from question: "${question}"`);
  return null;
}

function parseDateRangeFromSlug(slug: string): DateRange | null {
  // Try multiple regex patterns to handle various slug formats
  const patterns = [
    // Standard format: will-elon-tweet-150-174-times-october-4-11
    /times-(\w+)-(\d+)(?:-(\w+))?-(\d+)$/,

    // Alternative format: will-elon-tweet-less-than-150-times-oct-25-nov-1
    /times-(\w+)-(\d+)(?:-(\w+))?-(\d+)(?:-\d+)?$/,

    // Format with "tweet" instead of "times": elon-musk-of-tweets-january-17-24-will-elon-tweet-300-324-times-jan-17-24
    /tweet-(\w+)-(\d+)(?:-(\w+))?-(\d+)(?:-\d+)?$/,

    // Format with month abbreviations: will-elon-tweet-less-than-150-times-nov-1-8
    /times-(\w+)-(\d+)-(\w+)-(\d+)$/,

    // Format with "to": will-elon-tweet-400-or-more-times-april-11to18
    /times-(\w+)-(\d+)(?:to|-)(\w+)?-?(\d+)$/,

    // Catch-all for date ranges at the end
    /-(\w+)-(\d+)(?:-(\w+))?-(\d+)$/,
  ];

  for (const pattern of patterns) {
    const match = slug.match(pattern);
    if (match && match[1] && match[2] && match[4]) {
      return {
        startMonth: match[1],
        startDay: parseInt(match[2], 10),
        endMonth: match[3] || match[1], // Use startMonth as default if endMonth isn't specified
        endDay: parseInt(match[4], 10),
      };
    }
  }

  // More verbose logging for debugging
  log(`Failed to parse date range from slug: "${slug}"`);
  return null;
}

async function findElonTweetMarkets(): Promise<TweetRange[]> {
  const tweetMarkets = await db
    .select({
      id: marketSchema.id,
      marketSlug: marketSchema.marketSlug,
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
    const endDateActual = dayjs(market.endDateIso);
    const endYear = endDateActual.year();
    const formattedEndDate = endDateActual.format("YYYY-MM-DD");

    // Parse the tweet range from the question
    const range = parseTweetRange(market.question);
    if (!range) {
      log(`Skipping market Could not parse tweet range`, market);
      continue;
    }

    // Parse the date range from the slug
    const dateRange = parseDateRangeFromSlug(market.marketSlug);
    if (!dateRange) {
      log(`Skipping market Could not parse date range from slug`, market);
      continue;
    }

    const { startMonth, startDay, endMonth, endDay } = dateRange;
    const startMonthNum = getMonthNumber(startMonth);
    const endMonthNum = getMonthNumber(endMonth);

    if (!startMonthNum || !endMonthNum || isNaN(startDay) || isNaN(endDay)) {
      log(`Skipping market Invalid date components parsed from slug`, market);
      continue;
    }

    // Calculate the start year (handle year transitions)
    let startYear = endYear;
    // If the start date with current year would be after end date, use previous year
    const potentialStartDate = dayjs(
      `${startYear}-${startMonthNum}-${startDay}`
    );
    if (potentialStartDate.isAfter(endDateActual)) {
      startYear--;
      log(`Adjusting start year to ${startYear} for market `, market);
    }

    const formattedStartDate = dayjs(
      `${startYear}-${startMonthNum}-${startDay}`
    ).format("YYYY-MM-DD");

    parsedMarkets.push({
      ...range,
      marketId: market.id,
      marketSlug: market.marketSlug,
      question: market.question,
      startDate: formattedStartDate,
      endDate: formattedEndDate,
    });

    log(
      `Successfully parsed market: ${market.question} (${formattedStartDate} to ${formattedEndDate})`
    );
  }

  return parsedMarkets;
}

async function getCurrentActiveMarket(
  markets: TweetRange[]
): Promise<TweetRange | null> {
  if (markets.length === 0) {
    log("No active Elon tweet count markets found");
    return null;
  }

  const today = dayjs().format("YYYY-MM-DD");
  log(`Checking for markets active on ${today}`);

  for (const market of markets) {
    if (today >= market.startDate && today <= market.endDate) {
      log(`Found active market for current date range: ${market.question}`);
      return market;
    }
  }

  log("No market found for the current date range");
  return null;
}

async function main() {
  const allMarkets = await findElonTweetMarkets();

  // console.log("Markets:", allMarkets);

  const currentMarket = await getCurrentActiveMarket(allMarkets);
  if (currentMarket) {
    log("\nCurrent active market:");
    log(`- ${currentMarket.question}`);
    log(`  Range: ${currentMarket.min}-${currentMarket.max ?? "∞"}`);
    log(`  Date: ${currentMarket.startDate} to ${currentMarket.endDate}`);
  }
}

main();
