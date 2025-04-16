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

async function initializeCurrentPosition() {
  try {
    const trades = await clobClient.getTrades();

    // Extract unique asset IDs from trades
    const assetIds = [
      ...new Set(
        trades
          .map((t) =>
            t.trader_side === "TAKER" ? t.asset_id : t.maker_orders[0]?.asset_id
          )
          .filter(Boolean)
      ),
    ] as string[];

    // Check balances for each asset
    let currentAssetId = null;
    let highestBalance = BigInt(0);

    for (const assetId of assetIds) {
      const balance = await clobClient.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: assetId,
      });

      if (BigInt(balance.balance) > 0) {
        log(
          `Found position with token ID ${assetId}, balance: ${formatUnits(
            balance.balance,
            USDC_DECIMALS
          )}`
        );

        if (BigInt(balance.balance) > highestBalance) {
          highestBalance = BigInt(balance.balance);
          currentAssetId = assetId;
        }
      }
    }

    if (!currentAssetId) {
      log(`No active positions found`);
      return;
    }

    // Get token details
    const token = await db
      .select()
      .from(tokenSchema)
      .where(eq(tokenSchema.tokenId, currentAssetId))
      .limit(1)
      .then((results) => results[0]);

    if (!token?.marketId) {
      log(`Could not find market for token ID ${currentAssetId}`);
      return;
    }

    // Get market details
    const market = await db
      .select()
      .from(marketSchema)
      .where(eq(marketSchema.id, token.marketId))
      .limit(1)
      .then((results) => results[0]);

    // Extract company name directly from the slug
    // Slug format: "will-{company}-have-the-top-ai-model-on-{month}-{day}"
    const slugMatch = market?.marketSlug.match(
      /will-([^-]+)-have-the-top-ai-model/
    );
    if (slugMatch && slugMatch[1]) {
      currentModelOrg = slugMatch[1].toLowerCase();
      log(
        `✅ Initialized current position: ${
          slugMatch[1]
        } (Balance: ${formatUnits(highestBalance.toString(), USDC_DECIMALS)})`
      );
    } else {
      log(
        `⚠️ Could not extract company from market slug: ${market?.marketSlug}`
      );
    }
  } catch (err) {
    error("Error initializing position:", err);
    process.exit(1);
  }
}

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
        log(
          `Selling position ${assetId}, amount: ${formatUnits(
            balance.balance,
            USDC_DECIMALS
          )}`
        );
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
      log(
        `Buying ${organization}, amount: ${formatUnits(
          collateral.balance,
          USDC_DECIMALS
        )}`
      );
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

    const topModelOrg = topModel.organization.toLowerCase();

    // Check if top model changed
    log(`Current: ${currentModelOrg}, Top model: ${topModelOrg}`);
    if (currentModelOrg === topModelOrg) {
      log(
        `No change in top model: ${topModel.modelName} (${topModel.organization})`
      );
      return;
    }

    log(
      `🚨 Top model changed to ${topModel.modelName} (${topModel.organization})`
    );

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
        markets.find((m) => m.question.toLowerCase().includes(topModelOrg))
      );

    if (!market) {
      log(`No market found for ${topModel.organization}`);
      return;
    }

    // Get YES token for this market
    const yesToken = await db
      .select()
      .from(tokenSchema)
      .where(eq(tokenSchema.marketId, market.id))
      .then((tokens) => tokens.find((t) => t.outcome?.toLowerCase() === "yes"));

    if (!yesToken?.tokenId) {
      log(`No YES token found for market ${market.marketSlug}`);
      return;
    }

    // Execute the swap: sell all positions first, then buy new one
    await sellAllPositions();
    await buyPosition(yesToken.tokenId, topModelOrg);
  } catch (err) {
    error("Error in bot cycle:", err);
  }
}

await initializeCurrentPosition();
while (true) {
  await runCycle();
  await sleep(10);
}
