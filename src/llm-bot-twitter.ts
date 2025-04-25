import { log } from "console";
import dayjs from "dayjs";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "./db";
import { marketSchema, tokenSchema } from "./db/schema";
import { getClobClient, getWallet } from "./utils/web3";

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

interface TweetRange {
  min: number;
  max: number | null; // null means "or more"
  marketId: number;
  marketSlug: string;
  question: string;
  startDate: string;
  endDate: string;
}

async function findElonTweetMarkets(): Promise<TweetRange[]> {
  // Find markets that are active, not closed, and about Elon's tweet count
  const tweetMarkets = await db
    .select()
    .from(marketSchema)
    .where(and(ilike(marketSchema.question, "Will Elon tweet % times %")));

  log(`Found ${tweetMarkets.length} Elon tweet markets`);

  // Extract range and date information from markets
  return tweetMarkets
    .map((market) => {
      // Try to parse ranges like "100-124", "125-149", or "less than 100", "400 or more"
      let rangeMatch: RegExpMatchArray | null;
      let min = 0;
      let max: number | null = null;

      // Check for "X-Y times" pattern
      rangeMatch = market.question.match(/(\d+)-(\d+) times/);
      if (rangeMatch) {
        min = parseInt(rangeMatch[1]!, 10);
        max = parseInt(rangeMatch[2]!, 10);
      } else {
        // Check for "less than X times" pattern
        rangeMatch = market.question.match(/less than (\d+) times/i);
        if (rangeMatch) {
          min = 0;
          max = parseInt(rangeMatch[1]!, 10) - 1;
        } else {
          // Check for "X or more times" pattern
          rangeMatch = market.question.match(/(\d+) or more times/i);
          if (rangeMatch) {
            min = parseInt(rangeMatch[1]!, 10);
            max = null; // null indicates "or more"
          } else {
            return null; // Couldn't parse range
          }
        }
      }

      // Extract date range from the market slug
      // Pattern like: will-elon-tweet-250-274-times-jan-24-31
      const dateRangeMatch = market.marketSlug.match(
        /times-(\w+)-(\d+)(?:-(\w+)-)?(\d+)/
      );
      if (!dateRangeMatch) return null;

      const startMonth = dateRangeMatch[1];
      const startDay = parseInt(dateRangeMatch[2]!, 10);
      const endMonth = dateRangeMatch[3] || startMonth;
      const endDay = parseInt(dateRangeMatch[4]!, 10);

      const year = dayjs().year();
      const startMonthNum = getMonthNumber(startMonth!);
      const endMonthNum = getMonthNumber(endMonth!);

      const startDate = `${year}-${startMonthNum
        .toString()
        .padStart(2, "0")}-${startDay.toString().padStart(2, "0")}`;
      const endDate = `${year}-${endMonthNum
        .toString()
        .padStart(2, "0")}-${endDay.toString().padStart(2, "0")}`;

      return {
        min,
        max,
        marketId: market.id,
        marketSlug: market.marketSlug,
        question: market.question,
        startDate,
        endDate,
      };
    })
    .filter(Boolean) as TweetRange[];
}

function getMonthNumber(monthStr: string): number {
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
  return months[monthStr.toLowerCase()] || 1;
}

async function getCurrentActiveMarket(): Promise<TweetRange | null> {
  const markets = await findElonTweetMarkets();

  if (markets.length === 0) {
    log("No active Elon tweet count markets found");
    return null;
  }

  // Find the current date range from the market slugs
  const today = dayjs().format("YYYY-MM-DD");

  for (const market of markets) {
    // Check if today is within this range
    if (today >= market.startDate && today <= market.endDate) {
      log(`Found active market for current date range: ${market.question}`);
      return market;
    }
  }

  log("No market found for the current date range");
  return null;
}

async function getCurrentPosition() {
  try {
    const trades = await clobClient.getTrades();
    const assetIds = [
      ...new Set(
        trades
          .map((t) =>
            t.trader_side === "TAKER" ? t.asset_id : t.maker_orders[0]?.asset_id
          )
          .filter(Boolean)
      ),
    ] as string[];

    log(`Found ${assetIds.length} potential positions`);

    for (const assetId of assetIds) {
      const token = await db
        .select()
        .from(tokenSchema)
        .where(eq(tokenSchema.tokenId, assetId))
        .limit(1)
        .then((results) => results[0]);

      if (!token?.marketId) continue;

      const market = await db
        .select()
        .from(marketSchema)
        .where(eq(marketSchema.id, token.marketId))
        .limit(1)
        .then((results) => results[0]);

      const isTweetMarket = market?.question.includes("Will Elon tweet");
      if (isTweetMarket) {
        log(`Current position: ${market?.question} (${market?.marketSlug})`);
        return {
          market,
          token,
          assetId,
        };
      }
    }

    log("No current position in Elon tweet markets");
    return null;
  } catch (err) {
    log("Error getting current position:", err);
    return null;
  }
}

async function main() {
  try {
    // Get all active Elon tweet markets
    const allMarkets = await findElonTweetMarkets();
    console.log("All active Elon tweet markets:");
    allMarkets.forEach((market) => {
      console.log(`- ${market.question}`);
      console.log(`  Range: ${market.min}-${market.max || "∞"}`);
      console.log(`  Date: ${market.startDate} to ${market.endDate}`);
      console.log(`  Market ID: ${market.marketId}`);
      console.log(`  Slug: ${market.marketSlug}`);
      console.log();
    });

    // Get the currently active market based on date
    const currentMarket = await getCurrentActiveMarket();
    if (currentMarket) {
      console.log("\nCurrent active market:");
      console.log(`- ${currentMarket.question}`);
      console.log(`  Range: ${currentMarket.min}-${currentMarket.max || "∞"}`);
      console.log(
        `  Date: ${currentMarket.startDate} to ${currentMarket.endDate}`
      );
    }

    // Get current position
    const currentPosition = await getCurrentPosition();
    if (currentPosition) {
      console.log("\nCurrent position:");
      console.log(`- Market: ${currentPosition.market?.question}`);
      console.log(`  Token: ${currentPosition.token.outcome}`);
      console.log(`  Asset ID: ${currentPosition.assetId}`);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
