import { connect } from "puppeteer-real-browser";
import { checkWhichLeaderboard, LLM_ARENA_NEW_URL } from "./puppeteer";
import { llmArenaNew } from "./puppeteer/llmArena";
import { error } from "console";

const main = async () => {
  const { page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  const isNewSiteActive = await checkWhichLeaderboard(page);

  if (!isNewSiteActive) {
    await llmArenaNew(page, LLM_ARENA_NEW_URL);
  } else {
    await llmArenaNew(page, "https://lmarena.ai/leaderboard/text/overall");
  }
};

main().catch((err) => {
  error(err);
  process.exit(1);
});
