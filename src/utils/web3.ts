import { Wallet } from "@ethersproject/wallet";
import { Chain, ClobClient, type ApiKeyCreds } from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";
import { Alchemy, Network } from "alchemy-sdk";

const creds: ApiKeyCreds = {
  key: process.env.CLOB_API_KEY,
  secret: process.env.CLOB_SECRET,
  passphrase: process.env.CLOB_PASS_PHRASE,
};

export const alchemyProvider = await new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.MATIC_MAINNET,
}).config.getProvider();

export const getWallet = (pk: string) => new Wallet(pk, alchemyProvider);

export const getClobClient = (wallet: Wallet) =>
  new ClobClient(
    "https://clob.polymarket.com",
    Chain.POLYGON,
    wallet,
    creds,
    SignatureType.POLY_GNOSIS_SAFE,
    process.env.POLYMARKET_FUNDER_ADDRESS
  );
