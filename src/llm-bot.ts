import { AssetType } from "@polymarket/clob-client";
import { log } from "console";
import { ilike } from "drizzle-orm";
import { db } from "./db";
import { marketSchema } from "./db/schema";
import { getClobClient, getWallet } from "./utils/web3";

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
    ilike(marketSchema.question, "%which company has best ai model end of%")
  );

console.log(llmMarkets);
