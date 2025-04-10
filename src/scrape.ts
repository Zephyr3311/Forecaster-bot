import { Browser, BrowserContext, connect, Page } from "puppeteer-real-browser";

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

interface SessionData {
  cookies: Cookie[];
  headers: Record<string, string>;
}

async function getCloudflareSession(url: string): Promise<SessionData> {
  let browser: Browser | null = null;

  try {
    // Connect to a real browser with anti-detection features
    const connection = await connect({
      headless: false,
      turnstile: true,
      connectOption: { defaultViewport: null },
      disableXvfb: false,
    });

    browser = connection.browser;
    const context: BrowserContext = await browser.createBrowserContext();
    const page: Page = await context.newPage();

    // Find the Accept-Language header which is important for some CF protections
    const acceptLanguage = await page.evaluate(
      async (): Promise<string | null> => {
        try {
          const result = await fetch("https://httpbin.org/get")
            .then((res) => res.json())
            .then(
              (res) =>
                res.headers["Accept-Language"] || res.headers["accept-language"]
            )
            .catch(() => null);
          return result;
        } catch (e) {
          return null;
        }
      }
    );

    // Set up request interception to capture the session
    const sessionData: SessionData = { cookies: [], headers: {} };
    let isResolved = false;

    await page.setRequestInterception(true);

    page.on("request", async (request) => request.continue());

    // Create a promise to handle the response
    const sessionPromise = new Promise<SessionData>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          reject(new Error("Timeout Error"));
        }
      }, 60000); // 60 second timeout

      page.on("response", async (res) => {
        try {
          if (
            [200, 302].includes(res.status()) &&
            [url, url + "/"].includes(res.url())
          ) {
            // Wait for page to fully load
            await page
              .waitForNavigation({ waitUntil: "load", timeout: 5000 })
              .catch(() => {});

            // Get cookies and headers
            const cookies = await page.cookies();
            let headers: Record<string, string> = await res.request().headers();

            // Clean up headers
            delete headers["content-type"];
            delete headers["accept-encoding"];
            delete headers["accept"];
            delete headers["content-length"];
            headers["accept-language"] = acceptLanguage || "";

            clearTimeout(timeout);
            isResolved = true;
            resolve({ cookies, headers });
          }
        } catch (e) {}
      });
    });

    // Navigate to the page
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait for session data or timeout
    return await sessionPromise;
  } finally {
    // Ensure browser is closed
    if (browser) {
      await browser.close();
    }
  }
}

// Usage example
async function main(): Promise<void> {
  try {
    const session = await getCloudflareSession("https://lmarena.ai/");
    console.log("Session established:", session);

    // Example of how to use this session with fetch
    const cookieString = session.cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    // Now you can make regular fetch requests using these credentials
    const response = await fetch("https://lmarena.ai/some-path", {
      headers: {
        ...session.headers,
        Cookie: cookieString,
      },
    });

    const html = await response.text();
    console.log("Successfully fetched content");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
