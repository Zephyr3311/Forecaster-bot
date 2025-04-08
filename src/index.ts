import { config } from "@dotenvx/dotenvx";
import { Wallet } from "@ethersproject/wallet";
import { type ApiKeyCreds, Chain, ClobClient } from "@polymarket/clob-client";
import { Alchemy, Network } from "alchemy-sdk";
import { log } from "console";

config();

const provider = await new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.MATIC_MAINNET,
}).config.getProvider();

const wallet = new Wallet(process.env.PK, provider);
log(`Bot Wallet Address: ${await wallet.getAddress()}`);

const creds: ApiKeyCreds = {
  key: process.env.CLOB_API_KEY,
  secret: process.env.CLOB_SECRET,
  passphrase: process.env.CLOB_PASS_PHRASE,
};

const clobClient = new ClobClient(
  process.env.CLOB_API_URL,
  Chain.POLYGON,
  wallet,
  creds
);

log(`CLOB Client Address: `, await clobClient.getApiKeys());
