import "@dotenvx/dotenvx/config";
import { error } from "console";
import { syncMarkets } from "./polymarket/markets";

async function main() {
  while (true) {
    await syncMarkets();
  }
}

main().catch((err) => {
  error(err);
  process.exit(1);
});
