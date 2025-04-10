import type { Browser, BrowserContext, Cookie, Page } from "puppeteer";
import { connect } from "puppeteer-real-browser";

interface SessionData {
  cookies: Cookie[];
  headers: Record<string, string>;
}

async function getCloudflareSession(url: string): Promise<SessionData> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    // Connect to a real browser with anti-detection features
    const connection = await connect({
      headless: true,
    });

    browser = connection.browser as unknown as Browser;
    context = await browser.createBrowserContext();
    const page: Page = await context.newPage();

    // Find the Accept-Language header
    const acceptLanguage = await page.evaluate(
      async (): Promise<string | null> => {
        try {
          const result = await fetch("https://httpbin.org/get")
            .then((res) => res.json())
            .then(
              (res: any) =>
                res.headers["Accept-Language"] || res.headers["accept-language"]
            )
            .catch(() => null);
          return result;
        } catch (e) {
          return null;
        }
      }
    );

    // Set up request interception and response monitoring
    let sessionResolved = false;
    await page.setRequestInterception(true);

    page.on("request", async (request) => request.continue());

    return new Promise<SessionData>((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        if (!sessionResolved) {
          reject(new Error("Timeout waiting for Cloudflare session"));
        }
      }, 60000);

      page.on("response", async (res) => {
        try {
          if (
            [200, 302].includes(res.status()) &&
            [url, url + "/"].includes(res.url())
          ) {
            await page
              .waitForNavigation({ waitUntil: "load", timeout: 5000 })
              .catch(() => {});

            const cookies = await page.cookies();
            let headers = await res.request().headers();

            // Clean up headers
            delete headers["content-type"];
            delete headers["accept-encoding"];
            delete headers["accept"];
            delete headers["content-length"];
            headers["accept-language"] = acceptLanguage || "en-US,en;q=0.9";

            clearTimeout(timeout);
            sessionResolved = true;
            resolve({ cookies, headers });
          }
        } catch (e) {
          // Continue if this response fails
        }
      });

      // Start the navigation
      page.goto(url, { waitUntil: "domcontentloaded" }).catch(reject);
    });
  } catch (error) {
    throw error;
  } finally {
    // Clean up resources
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// Usage example
async function main(): Promise<void> {
  try {
    const session = await getCloudflareSession("https://lmarena.ai/");
    console.log("Session established");

    // Use session with fetch
    const cookieString = session.cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    const response = await fetch("https://lmarena.ai/", {
      headers: {
        ...session.headers,
        Cookie: cookieString,
      },
    });

    const success =
      response.ok && !(await response.text()).includes("cf-error-details");
    console.log(`Fetch ${success ? "succeeded" : "failed"}`);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
