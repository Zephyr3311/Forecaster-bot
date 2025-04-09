import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import { writeFileSync } from "fs";
import { getClobClient, getWallet } from "./constants";

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

log(`Bot Wallet Address: ${await wallet.getAddress()}`);

async function getAllMarkets(): Promise<Market[]> {
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
