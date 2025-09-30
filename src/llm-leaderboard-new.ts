import "@dotenvx/dotenvx/config";
import { execSync } from "child_process";
import { error, log } from "console";
import { connect } from "puppeteer-real-browser";
import { llmArenaNew } from "./puppeteer/llmArena";
import { isRunningInDocker } from "./utils";

const main = async () => {
  try {
    if (isRunningInDocker()) {
      execSync("rm -rf /tmp/lighthouse.* /tmp/puppeteer* 2>/dev/null", {
        timeout: 60000,
      });
      log("Cleaned up temp folders on startup");
    }
  } catch {}
  
  const { page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  await llmArenaNew(
    page,
    "https://lmarena.ai/leaderboard/text/overall-no-style-control"
  );
};

main().catch((err) => {
  error(err);
  process.exit(1);
});
