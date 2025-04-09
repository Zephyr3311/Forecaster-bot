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
  "https://clob.polymarket.com",
  Chain.POLYGON,
  wallet,
  creds
);

async function getAllMarkets() {
  const allMarkets = [];
  let nextCursor = "MA=="; // Initial cursor

  while (nextCursor !== "LTE=") {
    // "LTE=" is the END_CURSOR value
    try {
      const response = await clobClient.getMarkets(nextCursor);
      allMarkets.push(...response.data);
      nextCursor = response.next_cursor;

      log(
        `Fetched ${response.data.length} markets, next cursor: ${nextCursor}`
      );
    } catch (err) {
      error("Error fetching markets:", err);
      break;
    }
  }

  return allMarkets;
}

try {
  const allMarkets = await getAllMarkets();
  writeFileSync("./markets.json", JSON.stringify(allMarkets, null, 2));
  log(`Total markets fetched: ${allMarkets.length}`);

  for (const market of allMarkets) {
    log(market.question);
  }
} catch (err) {
  error("Error fetching markets:", err);
}
