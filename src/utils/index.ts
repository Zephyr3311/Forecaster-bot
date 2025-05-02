import type { Trade } from "@polymarket/clob-client";

export function extractModelName(htmlString: string): string {
  // Try to extract from HTML format first
  const htmlMatch = htmlString.match(/<a [^>]*>([^<]+)<\/a>/);
  if (htmlMatch && htmlMatch[1]) {
    return htmlMatch[1].trim();
  }

  // If no HTML tags, just return the original string
  return htmlString;
}

export function parseFormattedNumber(str: string): number {
  return parseInt(str.replace(/,/g, ""), 10);
}

export function extractAssetIdsFromTrades(trades: Trade[]): string[] {
  return [
    ...new Set(
      trades
        .map((t) =>
          t.trader_side === "TAKER" ? t.asset_id : t.maker_orders[0]?.asset_id
        )
        .filter(Boolean)
    ),
  ] as string[];
}
