import { Alchemy, Network } from "alchemy-sdk";

export const alchemyProvider = await new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.MATIC_MAINNET,
}).config.getProvider();
