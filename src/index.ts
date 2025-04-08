import "@dotenvx/dotenvx/config";
import { Wallet } from "@ethersproject/wallet";
import { type ApiKeyCreds, Chain, ClobClient } from "@polymarket/clob-client";
import { Alchemy, Network } from "alchemy-sdk";
import { error, log } from "console";
import { writeFileSync } from "fs";

const provider = await new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.MATIC_MAINNET,
}).config.getProvider();

const wallet = new Wallet(process.env.PK, provider);
log(`Bot Wallet Address: ${await wallet.getAddress()}`);

const creds: ApiKeyCreds = {
  key: process.env.CLOB_API_KEY,
  secret: process.env.CLOB_SECRET,
  passphrase: process.env.CLOB_PASS_PHRASE,
};

const clobClient = new ClobClient(
  process.env.CLOB_API_URL || "https://clob.polymarket.com", // Use default if not set
  Chain.POLYGON,
  wallet,
  creds
);

try {
  const markets = await clobClient.getMarkets();

  writeFileSync("./markets.json", JSON.stringify(markets, null, 2), "utf-8");
  for (const market of markets.data as Market[]) {
    log(market.question);
  }
} catch (err) {
  error("Error fetching markets:", err);
}
