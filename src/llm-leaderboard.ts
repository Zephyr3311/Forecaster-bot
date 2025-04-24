import { connect } from "puppeteer-real-browser";
import { checkWhichLeaderboard } from "./puppeteer";
import { llmArena, llmArenaNew } from "./puppeteer/llmArena";

const main = async () => {
  const { page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  const isNewSiteActive = await checkWhichLeaderboard(page);

  if (isNewSiteActive) {
    await llmArenaNew(page, "https://lmarena.ai/leaderboard/text/overall");
  } else {
    await llmArena(page);
  }
};

main().catch(console.error);
