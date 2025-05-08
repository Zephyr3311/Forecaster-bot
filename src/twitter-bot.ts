import { error } from "console";
import { syncTradeHistory } from "./polymarket/twitter";

async function main() {
  await syncTradeHistory();
}

main().catch((err) => {
  error(err);
  process.exit(1);
});
