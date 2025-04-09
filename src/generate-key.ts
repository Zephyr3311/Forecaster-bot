import "@dotenvx/dotenvx/config";
import { Wallet } from "@ethersproject/wallet";
import { Chain, ClobClient } from "@polymarket/clob-client";
import { log } from "console";
import { alchemyProvider } from "./alchemy";
import { creds } from "./clob";

const randomWallet = Wallet.createRandom();
const wallet = new Wallet(randomWallet.privateKey, alchemyProvider);
const clobClient = new ClobClient(
  "https://clob.polymarket.com",
  Chain.POLYGON,
  wallet,
  creds
);

log("🔑 New Ethereum Wallet Generated:");
log("----------------------------------");
log(`Address:       ${randomWallet.address}`);
log(`Private Key:   ${randomWallet.privateKey}`);
log(`Mnemonic:      ${randomWallet.mnemonic?.phrase}`);
log("----------------------------------");
log("🔑 New CLOB Wallet Generated:");
log("----------------------------------");
log(`Polymarket:       `, await clobClient.createOrDeriveApiKey());
