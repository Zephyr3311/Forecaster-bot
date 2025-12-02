import "@dotenvx/dotenvx/config";
import { error } from "console";
import { syncMarkets } from "./polymarket/markets";
import { sleep } from "./utils/retry";

async function main() {
  while (true) {
    await syncMarkets();

    if (typeof global.gc === "function") {
      global.gc();
    }

    await sleep(60000);
  }
}

main().catch((err) => {
  error(err);
  process.exit(1);
});
