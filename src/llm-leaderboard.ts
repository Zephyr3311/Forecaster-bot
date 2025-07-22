import "@dotenvx/dotenvx/config";
import { error } from "console";
import { connect } from "puppeteer-real-browser";
import { llmArenaNew } from "./puppeteer/llmArena";

const main = async () => {
  const { page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  await llmArenaNew(page, "https://lmarena.ai/leaderboard/text/overall");
};

main().catch((err) => {
  error(err);
  process.exit(1);
});
