import "@dotenvx/dotenvx/config";
import { Wallet } from "@ethersproject/wallet";
import { log } from "console";
import { getClobClient } from "./constants";

const wallet = Wallet.createRandom();
const clobClient = getClobClient(wallet);

log("🔑 New Ethereum Wallet Generated:");
log("----------------------------------");
log(`Address:       ${wallet.address}`);
log(`Private Key:   ${wallet.privateKey}`);
log(`Mnemonic:      ${wallet.mnemonic?.phrase}`);
log("----------------------------------");
log("🔑 New CLOB Wallet Generated:");
log("----------------------------------");
log(`Polymarket:       `, await clobClient.createOrDeriveApiKey());
