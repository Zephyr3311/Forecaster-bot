import "@dotenvx/dotenvx/config";
import { Wallet } from "@ethersproject/wallet";
import { log } from "console";
import { getClobClient, getWallet } from "./web3";

const wallet = process.env.PK
  ? getWallet(process.env.PK)
  : Wallet.createRandom();
const clobClient = getClobClient(wallet);
const polymarketApi = await clobClient.createOrDeriveApiKey();

log("🔑 New Ethereum Wallet Generated:");
log("----------------------------------");
log(`Address:       ${wallet.address}`);
log(`Mnemonic:      ${wallet.mnemonic?.phrase}`);
log(`PK=${process.env.PK || wallet.privateKey}`);
log(`CLOB_API_KEY=${polymarketApi.key}`);
log(`CLOB_SECRET=${polymarketApi.secret}`);
log(`CLOB_PASS_PHRASE=${polymarketApi.passphrase}`);
