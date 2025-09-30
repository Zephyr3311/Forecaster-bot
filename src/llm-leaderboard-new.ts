import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import { connect } from "puppeteer-real-browser";
import { llmArenaNew } from "./puppeteer/llmArena";
import { execSync } from "child_process";

const main = async () => {
  const { page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  try {
    execSync("rm -rf /tmp/lighthouse.* /tmp/puppeteer* 2>/dev/null", {
      timeout: 5000,
    });
    log("Cleaned up temp folders on startup");
  } catch {}

  await llmArenaNew(
    page,
    "https://lmarena.ai/leaderboard/text/overall-no-style-control"
  );
};

main().catch((err) => {
  error(err);
  process.exit(1);
});
