import "@dotenvx/dotenvx/config";
import { AssetType, OrderType, Side } from "@polymarket/clob-client";
import { sleep } from "bun";
import { error, log } from "console";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { and, desc, eq, ilike } from "drizzle-orm";
import { formatUnits } from "ethers";
import { db } from "./db";
import { llmLeaderboardSchema, marketSchema, tokenSchema } from "./db/schema";
import { getClobClient, getWallet } from "./utils/web3";

dayjs.extend(utc);
dayjs.extend(timezone);

const USDC_DECIMALS = 6;

let currentModelOrg: string | null = null;
let currentTokenId: string | null = null;

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

async function runCycle() {
  try {
    // 1. Get current top model
    const topModel = await db
      .select()
      .from(llmLeaderboardSchema)
      .orderBy(desc(llmLeaderboardSchema.arenaScore))
      .limit(1)
      .then((results) => results[0]);

    if (!topModel) return;

    // 2. Find relevant market
    const currentMonth = dayjs()
      .tz("America/New_York")
      .format("MMM")
      .toLowerCase();

    const markets = await db
      .select()
      .from(marketSchema)
      .where(
        and(
          ilike(
            marketSchema.marketSlug,
            `%-have-the-top-ai-model-on-${currentMonth}%`
          ),
          eq(marketSchema.closed, false),
          eq(marketSchema.active, true)
        )
      );

    // Find the market that matches the organization
    const market = markets.find((m) =>
      m.question.toLowerCase().includes(topModel.organization.toLowerCase())
    );

    if (!market) {
      log(`No market found for ${topModel.organization}`);
      return;
    }

    const tokens = await db
      .select()
      .from(tokenSchema)
      .where(eq(tokenSchema.marketId, market.id));
    const yesTokenId = tokens.find(
      (t) => t.outcome?.toLowerCase() === "yes"
    )?.tokenId;
    if (!yesTokenId) {
      log(`No YES token found for market: ${market.marketSlug}`);
      return;
    }

    // 3. Check if we need to switch positions
    if (currentModelOrg === topModel.organization) {
      log(
        `No change in top model: ${topModel.model} (${topModel.organization})`
      );
      return; // Current position is correct, do nothing
    }

    log(
      `🚨 Top model changed! New: ${topModel.model} (${topModel.organization})`
    );

    // 4. Sell current position if any
    if (currentTokenId && currentTokenId !== yesTokenId) {
      const balance = await clobClient.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: currentTokenId,
      });

      if (BigInt(balance.balance) > 0) {
        log(
          `Selling ${formatUnits(
            balance.balance,
            USDC_DECIMALS
          )} shares of previous position`
        );
        const sellOrder = await clobClient.createMarketOrder({
          tokenID: currentTokenId,
          amount: parseFloat(formatUnits(balance.balance, USDC_DECIMALS)),
          side: Side.SELL,
        });
        await clobClient.postOrder(sellOrder, OrderType.FOK);
      }
    }

    // 5. Buy new position with all available funds
    const collateral = await clobClient.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });

    if (BigInt(collateral.balance) > 0) {
      log(
        `Buying ${topModel.organization} with ${formatUnits(
          collateral.balance,
          USDC_DECIMALS
        )} USDC`
      );
      const buyOrder = await clobClient.createMarketOrder({
        tokenID: yesTokenId,
        amount: parseFloat(formatUnits(collateral.balance, USDC_DECIMALS)),
        side: Side.BUY,
      });
      await clobClient.postOrder(buyOrder, OrderType.FOK);
    }

    // Update tracking variables
    currentModelOrg = topModel.organization;
    currentTokenId = yesTokenId;
  } catch (err) {
    error("Error in bot cycle:", err);
  }
}

while (true) {
  await runCycle();
  await sleep(30000);
}
