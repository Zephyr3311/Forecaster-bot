import { AssetType, OrderType, Side } from "@polymarket/clob-client";
import { sleep } from "bun";
import { error, log } from "console";
import dayjs from "dayjs";
import { and, desc, eq, ilike } from "drizzle-orm";
import { ethers, formatUnits } from "ethers";
import { db } from "./db";
import { llmLeaderboardSchema, marketSchema, tokenSchema } from "./db/schema";
import { getClobClient, getWallet } from "./utils/web3";

const USDC_DECIMALS = 6;
const MINIMUM_BALANCE = ethers.parseUnits("1", USDC_DECIMALS);
let currentModelOrg: string | null = null;

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

async function initializeCurrentPosition() {
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

    let currentAssetId = null;
    let highestBalance = BigInt(0);

    for (const assetId of assetIds) {
      const balance = await clobClient.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: assetId,
      });

      if (BigInt(balance.balance) > MINIMUM_BALANCE) {
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
      } else if (BigInt(balance.balance) > 0) {
        log(
          `Ignoring dust balance for token ID ${assetId}, balance: ${formatUnits(
            balance.balance,
            USDC_DECIMALS
          )}`
        );
      }
    }

    if (!currentAssetId) {
      log(`No active positions found above minimum threshold`);
      currentModelOrg = null;
      return;
    }

    const token = await db
      .select()
      .from(tokenSchema)
      .where(eq(tokenSchema.tokenId, currentAssetId))
      .limit(1)
      .then((results) => results[0]);

    if (!token?.marketId) {
      log(`Could not find market for token ID ${currentAssetId}`);
      currentModelOrg = null;
      return;
    }

    const market = await db
      .select()
      .from(marketSchema)
      .where(eq(marketSchema.id, token.marketId))
      .limit(1)
      .then((results) => results[0]);

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
      currentModelOrg = null;
    }
  } catch (err) {
    error("Error initializing position:", err);
    process.exit(1);
  }
}

async function sellAllPositions(topModelTokenId: string | null = null) {
  await clobClient.cancelAll();

  log("Starting to sell positions...");

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

  let anySold = false;

  for (const assetId of assetIds) {
    // Skip selling if this is the token for the current top model
    if (topModelTokenId && assetId === topModelTokenId) {
      log(`Keeping position ${assetId} (current top model)`);
      continue;
    }

    const balance = await clobClient.getBalanceAllowance({
      asset_type: AssetType.CONDITIONAL,
      token_id: assetId,
    });

    if (BigInt(balance.balance) > MINIMUM_BALANCE) {
      try {
        const formattedBalance = formatUnits(balance.balance, USDC_DECIMALS);
        log(`Selling position ${assetId}, amount: ${formattedBalance}`);

        const sellOrder = await clobClient.createMarketOrder({
          tokenID: assetId,
          amount: parseFloat(formattedBalance),
          side: Side.SELL,
        });

        await clobClient.postOrder(sellOrder, OrderType.FOK);
        anySold = true;
      } catch (err) {
        error(`Error selling ${assetId}:`, err);
      }
    } else if (BigInt(balance.balance) > 0) {
      log(
        `Skipping dust position ${assetId}, amount: ${formatUnits(
          balance.balance,
          USDC_DECIMALS
        )}`
      );
    }
  }

  // Wait for blockchain state to update if we sold anything
  if (anySold) {
    log("Waiting for balances to update after selling...");
    await sleep(3000); // Wait 3 seconds for balance to update
  }
}

async function buyPosition(
  tokenId: string,
  organization: string,
  retries = 30
) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const collateral = await clobClient.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });

    if (BigInt(collateral.balance) > 0) {
      try {
        log(
          `Buying ${organization}, amount: ${formatUnits(
            collateral.balance,
            USDC_DECIMALS
          )} (attempt ${attempt}/${retries})`
        );
        const buyOrder = await clobClient.createMarketOrder({
          tokenID: tokenId,
          amount: parseFloat(formatUnits(collateral.balance, USDC_DECIMALS)),
          side: Side.BUY,
        });
        await clobClient.postOrder(buyOrder, OrderType.FOK);
        currentModelOrg = organization;
        log(`Successfully bought ${organization}`);
        return true;
      } catch (err) {
        error(
          `Error buying ${organization} (attempt ${attempt}/${retries}):`,
          err
        );
      }
    }

    log(`No collateral available for buying. Waiting before retry...`);
    await sleep(1000);
  }

  log(`Failed to buy ${organization} after ${retries} attempts`);
  return false;
}

async function runCycle() {
  try {
    // Re-check our position at the start of each cycle
    await initializeCurrentPosition();

    const topModel = await db
      .select()
      .from(llmLeaderboardSchema)
      .orderBy(desc(llmLeaderboardSchema.arenaScore))
      .limit(1)
      .then((results) => results[0]);

    if (!topModel) return;

    const topModelOrg = topModel.organization.toLowerCase();

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

    const yesToken = await db
      .select()
      .from(tokenSchema)
      .where(eq(tokenSchema.marketId, market.id))
      .then((tokens) => tokens.find((t) => t.outcome?.toLowerCase() === "yes"));

    if (!yesToken?.tokenId) {
      log(`No YES token found for market ${market.marketSlug}`);
      return;
    }

    await sellAllPositions(yesToken.tokenId);

    // Check if we already have this position
    const currentBalance = await clobClient.getBalanceAllowance({
      asset_type: AssetType.CONDITIONAL,
      token_id: yesToken.tokenId,
    });

    // Only buy if we don't already have a significant position
    if (BigInt(currentBalance.balance) <= MINIMUM_BALANCE) {
      await buyPosition(yesToken.tokenId, topModelOrg);
    } else {
      log(`Already holding ${topModelOrg} position, no need to buy`);
      currentModelOrg = topModelOrg;
    }
  } catch (err) {
    error("Error in bot cycle:", err);
  }
}

await initializeCurrentPosition();
while (true) {
  await runCycle();
  await sleep(100);
}
