import { connect } from "puppeteer-real-browser";
import { checkWhichLeaderboard } from "./puppeteer";

const main = async () => {
  const { page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  const isNewSiteActive = await checkWhichLeaderboard(page);

  // const check = await checkWhichLeaderboard(page);
  // await check(page);

  // await page.goto(`${LLM_ARENA_URL}/random-test-path`, {
  //   waitUntil: "networkidle2",
  // });
  // const content = await page.content();
  // const isNewSiteActive = content.includes('{"detail":"Not Found"}');

  // console.log(`Site check complete - New site active: ${isNewSiteActive}`);
};

main().catch(console.error);
