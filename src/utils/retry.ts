import { log } from "console";

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on certain errors
      if (
        error instanceof DOMException &&
        error.name === "InvalidCharacterError"
      ) {
        throw error;
      }

      // For rate limit errors, use longer delays
      const isRateLimit =
        (error as Error)?.message?.includes("429") ||
        (error as Error)?.message?.includes("Too Many Requests");

      if (attempt === maxRetries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff + jitter
      let delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;

      // Use much longer delay for rate limits
      if (isRateLimit) {
        delay = Math.max(delay, 15000); // At least 15 seconds for rate limits
      }

      log(
        `Attempt ${attempt + 1} failed${
          isRateLimit ? " (rate limit)" : ""
        }, retrying in ${Math.round(delay)}ms...`
      );
      await sleep(delay);
    }
  }

  throw lastError!;
}
