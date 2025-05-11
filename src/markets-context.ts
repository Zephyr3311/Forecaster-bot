import "@dotenvx/dotenvx/config";
import { error } from "console";
import { syncMarkets } from "./polymarket/markets";

async function main() {
  await syncMarkets();
}

main().catch((err) => {
  error(err);
  process.exit(1);
});
