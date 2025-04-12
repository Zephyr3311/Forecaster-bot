import "@dotenvx/dotenvx/config";
import { Wallet } from "@ethersproject/wallet";
import { log } from "console";
import { getClobClient } from "./constants";

const wallet = Wallet.createRandom();
const clobClient = getClobClient(wallet);
const polymarketApi = await clobClient.createOrDeriveApiKey();

log("🔑 New Ethereum Wallet Generated:");
log("----------------------------------");
log(`Address:       ${wallet.address}`);
log(`Mnemonic:      ${wallet.mnemonic?.phrase}`);
log(`PK=${wallet.privateKey}`);
log(`CLOB_API_KEY=${polymarketApi.key}`);
log(`CLOB_SECRET=${polymarketApi.secret}`);
log(`CLOB_PASS_PHRASE=${polymarketApi.passphrase}`);
