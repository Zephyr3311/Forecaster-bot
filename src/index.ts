import { config } from "@dotenvx/dotenvx";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import { type ApiKeyCreds, Chain, ClobClient } from "@polymarket/clob-client";

config();

async function initializeBot() {
  // --- Wallet Setup ---
  const privateKey = process.env.PK;
  if (!privateKey) {
    throw new Error("Private key not found in .env file (PK)");
  }
  // Optional: Use Multi-Endpoint Provider for better RPC reliability
  // import { JsonRpcMultiProvider } from '@polymarket/multi-endpoint-provider';
  // const provider = new JsonRpcMultiProvider([process.env.RPC_URL!, /* add fallback RPCs */]);
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const wallet = new Wallet(privateKey, provider);
  console.log(`Bot Wallet Address: ${await wallet.getAddress()}`);

  // --- CLOB Client Setup ---
  const clobApiUrl = process.env.CLOB_API_URL;
  const chainId = parseInt(process.env.CHAIN_ID || "137") as Chain; // Default to Polygon Mainnet

  if (!clobApiUrl) {
    throw new Error("CLOB API URL not found in .env file (CLOB_API_URL)");
  }

  // --- API Key Credentials ---
  // You MUST generate these first. You can use the clob-client's
  // createOrDeriveApiKey() method once initially, store the keys safely in .env,
  // and then use them here. See clob-client/examples/createOrDeriveApiKey.ts
  const apiKey = process.env.CLOB_API_KEY;
  const apiSecret = process.env.CLOB_SECRET;
  const apiPassphrase = process.env.CLOB_PASS_PHRASE;

  if (!apiKey || !apiSecret || !apiPassphrase) {
    console.warn(
      "CLOB API Credentials not found in .env. API Key specific endpoints will fail."
    );
    // You might still be able to use public endpoints without credentials
  }

  const creds: ApiKeyCreds | undefined =
    apiKey && apiSecret && apiPassphrase
      ? {
          key: apiKey,
          secret: apiSecret,
          passphrase: apiPassphrase,
        }
      : undefined;

  // Initialize the CLOB client
  // SignatureType defaults to EOA (0) if not specified.
  // If using a Polymarket Gnosis Safe or Proxy Wallet, specify the type
  // and the funderAddress (the safe/proxy address).
  const clobClient = new ClobClient(
    clobApiUrl,
    chainId,
    wallet, // Signer for orders and L1/L2 auth
    creds // Credentials for L2 auth (API requests)
    // SignatureType.EOA, // Or POLY_PROXY, POLY_GNOSIS_SAFE
    // undefined // Or the proxy/safe address if using non-EOA sig type
  );

  console.log("CLOB Client Initialized.");

  // Example: Check server time
  try {
    const serverTime = await clobClient.getServerTime();
    console.log(
      `CLOB Server Time: ${new Date(serverTime * 1000).toISOString()}`
    );
  } catch (error) {
    console.error("Error fetching server time:", error);
  }

  return { wallet, provider, clobClient };
}

// --- Main Bot Logic Area ---
async function runBotLogic(client: ClobClient, wallet: Wallet) {
  console.log("Running bot logic...");

  // TODO: Implement your trading strategy here
  // 1. Fetch market data (prices, order books, etc.) using client.getPrice, client.getOrderBook...
  // 2. Analyze data based on your strategy.
  // 3. Decide whether to place an order.
  // 4. If placing an order, use client.createOrder() then client.postOrder().

  // Example: Get price for a specific token (replace with actual token ID)
  const exampleTokenId =
    "71321045679252212594626385532706912750332728571942532289631379312455583992563"; // Example YES token on Amoy
  try {
    const buyPrice = await client.getPrice(exampleTokenId, "buy");
    const sellPrice = await client.getPrice(exampleTokenId, "sell");
    console.log(
      `Token ${exampleTokenId} - Best Buy Price: ${buyPrice?.price}, Best Sell Price: ${sellPrice?.price}`
    );

    // --- Placeholder Strategy ---
    // if (some condition based on prices/data) {
    //    const order = await client.createOrder({
    //        tokenID: exampleTokenId,
    //        price: 0.55, // Your target price
    //        side: Side.BUY,
    //        size: 10, // Amount of shares
    //    });
    //    console.log("Created Order:", order);
    //    const response = await client.postOrder(order);
    //    console.log("Post Order Response:", response);
    // }
  } catch (error: any) {
    console.error(
      `Error fetching price for ${exampleTokenId}:`,
      error.error || error.message || error
    );
  }

  console.log("Bot logic cycle complete.");
}

// --- Bot Execution ---
async function main() {
  try {
    const { clobClient, wallet } = await initializeBot();

    // Example: Run logic every 60 seconds
    const runInterval = 60 * 1000; // 60 seconds
    console.log(
      `Starting bot loop - running every ${runInterval / 1000} seconds`
    );

    // Run once immediately
    await runBotLogic(clobClient, wallet);

    // Then run on an interval
    setInterval(() => runBotLogic(clobClient, wallet), runInterval);
  } catch (error) {
    console.error("Failed to initialize bot:", error);
    process.exit(1);
  }
}

main();
