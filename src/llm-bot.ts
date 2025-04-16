import { AssetType, OrderType, Side } from "@polymarket/clob-client";
import { sleep } from "bun";
import { error, log } from "console";
import dayjs from "dayjs";
import { and, desc, eq, ilike } from "drizzle-orm";
import { formatUnits } from "ethers";
import { db } from "./db";
import { llmLeaderboardSchema, marketSchema, tokenSchema } from "./db/schema";
import { getClobClient, getWallet } from "./utils/web3";

const USDC_DECIMALS = 6;
let currentModelOrg: string | null = null;

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

async function sellAllPositions() {
  // Cancel any open orders first
  await clobClient.cancelAll();

  // Find all tokens we have a balance for
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

  // Sell all positions
  for (const assetId of assetIds) {
    const balance = await clobClient.getBalanceAllowance({
      asset_type: AssetType.CONDITIONAL,
      token_id: assetId,
    });

    if (BigInt(balance.balance) > 0) {
      try {
        const sellOrder = await clobClient.createMarketOrder({
          tokenID: assetId,
          amount: parseFloat(formatUnits(balance.balance, USDC_DECIMALS)),
          side: Side.SELL,
        });
        await clobClient.postOrder(sellOrder, OrderType.FOK);
      } catch (err) {
        error(`Error selling ${assetId}:`, err);
      }
    }
  }
}

async function buyPosition(tokenId: string, organization: string) {
  const collateral = await clobClient.getBalanceAllowance({
    asset_type: AssetType.COLLATERAL,
  });

  if (BigInt(collateral.balance) > 0) {
    try {
      const buyOrder = await clobClient.createMarketOrder({
        tokenID: tokenId,
        amount: parseFloat(formatUnits(collateral.balance, USDC_DECIMALS)),
        side: Side.BUY,
      });
      await clobClient.postOrder(buyOrder, OrderType.FOK);
      currentModelOrg = organization;
    } catch (err) {
      error(`Error buying ${organization}:`, err);
    }
  }
}

async function runCycle() {
  try {
    // Get current top model
    const topModel = await db
      .select()
      .from(llmLeaderboardSchema)
      .orderBy(desc(llmLeaderboardSchema.arenaScore))
      .limit(1)
      .then((results) => results[0]);

    if (!topModel) return;

    // Check if top model changed
    if (currentModelOrg === topModel.organization) return;

    log(`🚨 Top model changed to ${topModel.model} (${topModel.organization})`);

    // Find corresponding market
    const currentMonth = dayjs().format("MMM").toLowerCase();
    const market = await db
      .select()
      .from(marketSchema)
      .where(
        and(
          ilike(
            marketSchema.marketSlug,
            `%-have-the-top-ai-model-on-${currentMonth}%`
          ),
          eq(marketSchema.active, true),
          eq(marketSchema.closed, false)
        )
      )
      .then((markets) =>
        markets.find((m) =>
          m.question.toLowerCase().includes(topModel.organization.toLowerCase())
        )
      );

    if (!market) return;

    // Get YES token for this market
    const yesToken = await db
      .select()
      .from(tokenSchema)
      .where(eq(tokenSchema.marketId, market.id))
      .then((tokens) => tokens.find((t) => t.outcome?.toLowerCase() === "yes"));

    if (!yesToken?.tokenId) return;

    // Execute the swap: sell all positions first, then buy new one
    await sellAllPositions();
    await buyPosition(yesToken.tokenId, topModel.organization);
  } catch (err) {
    error("Error in bot cycle:", err);
  }
}

while (true) {
  await runCycle();
  await sleep(60000);
}
