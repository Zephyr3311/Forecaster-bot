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
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
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
  let match = question.match(/(\d+)-(\d+) times/);
  if (match?.[1] && match[2]) {
    return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  }
  match = question.match(/less than (\d+) times/i);
  if (match?.[1]) {
    return { min: 0, max: parseInt(match[1], 10) - 1 };
  }
  match = question.match(/(\d+) or more times/i);
  if (match?.[1]) {
    return { min: parseInt(match[1], 10), max: null };
  }
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

    const range = parseTweetRange(market.question);
    if (!range) {
      log(`Skipping market ${market.marketSlug}: Could not parse tweet range`);
      continue;
    }

    const dateRangeMatch = market.marketSlug.match(
      /times-(\w+)-(\d+)(?:-(\w+))?-(\d+)$/
    );
    if (!dateRangeMatch) {
      log(
        `Skipping market ${market.marketSlug}: Could not parse date range from slug`
      );
      continue;
    }

    const [, startMonthStr, startDayStr, endMonthStr, endDayStr] =
      dateRangeMatch;
    const startDay = parseInt(startDayStr!, 10);
    const endDay = parseInt(endDayStr!, 10);
    const startMonthNum = getMonthNumber(startMonthStr!);
    const endMonthNum = getMonthNumber(endMonthStr || startMonthStr!); // Use start month if end month is absent

    console.log(
      `Parsed date range from slug: ${startMonthStr} ${startDay} to ${endMonthStr} ${endDay}`
    );

    if (!startMonthNum || !endMonthNum || isNaN(startDay) || isNaN(endDay)) {
      log(
        `Skipping market ${market.marketSlug}: Invalid date components parsed from slug`
      );
      continue;
    }

    let startYear = endYear;
    const potentialStartDate = dayjs(
      `${startYear}-${startMonthNum}-${startDay}`
    );
    if (potentialStartDate.isAfter(endDateActual)) {
      startYear--;
    }
    const formattedStartDate = dayjs(
      `${startYear}-${startMonthNum}-${startDay}`
    ).format("YYYY-MM-DD");

    parsedMarkets.push({
      ...range, // Spread the parsed min/max
      marketId: market.id,
      marketSlug: market.marketSlug,
      question: market.question,
      startDate: formattedStartDate,
      endDate: formattedEndDate,
    });
  }

  return parsedMarkets;
}

// --- getCurrentActiveMarket and getCurrentPosition remain unchanged ---
async function getCurrentActiveMarket(): Promise<TweetRange | null> {
  const markets = await findElonTweetMarkets();

  if (markets.length === 0) {
    log("No active Elon tweet count markets found");
    return null;
  }

  const today = dayjs().format("YYYY-MM-DD");

  for (const market of markets) {
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
    const allMarkets = await findElonTweetMarkets();
    console.log("All Elon tweet markets found:", allMarkets.length);
    // Optionally log the full list if needed for debugging:
    // console.log(JSON.stringify(allMarkets, null, 2));

    const currentMarket = await getCurrentActiveMarket();
    if (currentMarket) {
      console.log("\nCurrent active market:");
      console.log(`- ${currentMarket.question}`);
      console.log(`  Range: ${currentMarket.min}-${currentMarket.max ?? "∞"}`);
      console.log(
        `  Date: ${currentMarket.startDate} to ${currentMarket.endDate}`
      );
    }

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
