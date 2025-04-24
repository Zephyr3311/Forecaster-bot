import { connect } from "puppeteer-real-browser";

const main = async () => {
  const { page } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
  });

  // const check = await checkWhichLeaderboard(page);
  // await check(page);
};

main().catch(console.error);
