import initCycleTLS from "cycletls";
import { mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { connect } from "puppeteer-real-browser";

try {
  unlinkSync("response.html");
} catch (_) {}

try {
  unlinkSync("./stream/page.jpg");
} catch (error) {}

async function getCloudflareSession(url: string) {
  const { browser } = await connect({
    turnstile: true,
    connectOption: { defaultViewport: null },
    disableXvfb: false,
  });

  mkdirSync(join(resolve(), "stream"), { recursive: true });
  setInterval(
    async () =>
      await page.screenshot({ path: "./stream/page.jpg" }).catch(() => {}),
    1000
  );

  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  try {
    page.on("dialog", async (dialog) => {
      try {
        await dialog.accept();
      } catch {}
    });

    const timeoutId = setTimeout(() => {
      throw new Error("Timeout waiting for Cloudflare session");
    }, 60000);

    await page.goto(url, { waitUntil: "networkidle2" });

    try {
      await page.evaluate(() => {
        window.alert = () => {};
        window.confirm = () => true;
        window.prompt = () => "";
      });
    } catch {}

    await new Promise((r) => setTimeout(r, 5000));

    const cookies = await page.cookies();
    const headers = await page.evaluate(() => ({
      "user-agent": navigator.userAgent,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "accept-language": navigator.language,
      "sec-ch-ua": navigator.userAgent.includes("Chrome")
        ? `"Google Chrome";v="${
            navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || ""
          }"`
        : "",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": `"${navigator.platform}"`,
      "upgrade-insecure-requests": "1",
    }));

    clearTimeout(timeoutId);
    return { cookies, headers };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

try {
  const session = await getCloudflareSession("https://lmarena.ai/");
  const cookieString = session.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  const cycleTLS = await initCycleTLS();
  const response = await cycleTLS(
    "https://lmarena.ai/",
    {
      headers: {
        ...session.headers,
        cookie: cookieString,
      },
    },
    "get"
  );

  if (response.status === 200) {
    writeFileSync("response.html", response.body.toString());
  }

  await cycleTLS.exit();
} catch (error) {
  console.error("Error:", error);
}
