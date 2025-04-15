import { log } from "console";
import { getClobClient, getWallet } from "./utils/web3";

const wallet = getWallet(process.env.PK);
const clobClient = getClobClient(wallet);

log(`Bot Wallet Address: ${await wallet.getAddress()}`);

try {
  const apiKeyCreds = await clobClient.createOrDeriveApiKey();
  console.log("API Key Credentials (SAVE THESE SECURELY):");
  console.log("Key:", apiKeyCreds.key);
  console.log("Secret:", apiKeyCreds.secret);
  console.log("Passphrase:", apiKeyCreds.passphrase);
  // Store these in your .env file or another secure location
} catch (error) {
  console.error("Error deriving API keys:", error);
}
