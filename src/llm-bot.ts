import { AssetType } from "@polymarket/clob-client";
import { log } from "console";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { and, desc, eq, ilike } from "drizzle-orm";
import { db } from "./db";
import { llmLeaderboardSchema, marketSchema } from "./db/schema";
import { getClobClient, getWallet } from "./utils/web3";

dayjs.extend(utc);
dayjs.extend(timezone);

const currentTime = dayjs().tz("America/New_York"); // April 30, 2025, 12:00 PM ET.
const month = currentTime.format("MMM").toLowerCase();

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

log(`Bot Wallet Address: ${await wallet.getAddress()}`);

const collateralBalance = await clobClient.getBalanceAllowance({
  asset_type: AssetType.COLLATERAL,
});

log(`Collateral Balance:`, collateralBalance);

const llmMarkets = await db
  .select()
  .from(marketSchema)
  .where(
    and(
      ilike(
        marketSchema.marketSlug,
        `%-have-the-top-ai-model-on-${month}%` // will-google-have-the-top-ai-model-on-april-30
      ),
      eq(marketSchema.closed, false),
      eq(marketSchema.active, true)
    )
  );

const topModel = await db
  .select()
  .from(llmLeaderboardSchema)
  .orderBy(desc(llmLeaderboardSchema.arenaScore))
  .limit(1)
  .then((results) => results[0] || null);

const openOrders = await clobClient.getOpenOrders();

log(`Open Orders:`, openOrders);
log(`Top Model:`, topModel);
log(llmMarkets.map((market) => market.marketSlug));
