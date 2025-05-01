import "@dotenvx/dotenvx/config";
import { ethers } from "ethers";
import { type SafeTransaction, OperationType } from "../types";
import {
  CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  USDC_ADDRESS,
} from "./constants";
import { safeAbi } from "./safeWallet/abis/safeAbi";
import { encodeRedeem, encodeRedeemNegRisk } from "./safeWallet/encode";
import { signAndExecuteSafeTransaction } from "./safeWallet/safe-helpers";

export async function redeem(
  conditionId: string,
  negRisk: boolean | null,
  redeemAmounts: [string, string]
) {
  console.log(`Starting...`);

  const provider = new ethers.providers.JsonRpcProvider(
    `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
  const pk = new ethers.Wallet(`${process.env.PK}`);
  const wallet = pk.connect(provider);

  console.log(`Address: ${wallet.address}`);

  const safe = new ethers.Contract(
    process.env.POLYMARKET_FUNDER_ADDRESS,
    safeAbi,
    wallet
  );

  // amounts of conditional tokens to redeem. Only used for neg risk redeems
  // should always have length 2, with the first element being the amount of yes tokens to redeem and the
  // second element being the amount of no tokens to redeem
  // Only necessary for redeeming neg risk tokens
  const data = negRisk
    ? encodeRedeemNegRisk(conditionId, redeemAmounts)
    : encodeRedeem(USDC_ADDRESS, conditionId);
  const to = negRisk
    ? NEG_RISK_ADAPTER_ADDRESS
    : CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS;

  const safeTxn: SafeTransaction = {
    to: to,
    data: data,
    operation: OperationType.Call,
    value: "0",
  };

  const txn = await signAndExecuteSafeTransaction(wallet, safe, safeTxn, {
    gasPrice: 200000000000,
  });

  await txn.wait();

  console.log(`Done!`);
  return txn;
}
