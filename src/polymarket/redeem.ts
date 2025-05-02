import { error, log } from "console";
import { ethers } from "ethers";
import { type SafeTransaction, CallType, OperationType } from "../types";
import {
  CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  USDC_ADDRESS,
} from "./constants";
import { safeAbi } from "./safeWallet/abis/safeAbi";
import {
  encodeErc1155Approve,
  encodeRedeem,
  encodeRedeemNegRisk,
} from "./safeWallet/encode";
import { signAndExecuteSafeTransaction } from "./safeWallet/safe-helpers";

async function getWalletAndSafe() {
  const provider = new ethers.providers.JsonRpcProvider(
    `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
  const wallet = new ethers.Wallet(process.env.PK).connect(provider);
  const safeAddress = process.env.POLYMARKET_FUNDER_ADDRESS;
  const safe = new ethers.Contract(safeAddress, safeAbi, wallet);

  const [currentNonce, gasPrice] = await Promise.all([
    provider.getTransactionCount(wallet.address, "latest"),
    provider.getGasPrice(),
  ]);

  return { wallet, safe, safeAddress, provider, currentNonce, gasPrice };
}

export async function verifyEOANonce() {
  const { wallet, provider, currentNonce, gasPrice } = await getWalletAndSafe();

  try {
    const amountToSend = ethers.utils.parseUnits("0.001", "ether");

    const tx = {
      to: wallet.address,
      value: amountToSend,
      nonce: currentNonce,
      gasLimit: 21000,
      maxPriorityFeePerGas: gasPrice,
      maxFeePerGas: gasPrice,
      type: Number(CallType.DelegateCall),
      chainId: (await provider.getNetwork()).chainId,
    };

    const txResponse = await wallet.sendTransaction(tx);
    const receipt = await txResponse.wait();
    log(`✅ Transaction confirmed: ${receipt.transactionHash}`);
  } catch (err) {
    error("❌ Error sending transaction:", err);
  }
}

export async function approveRedeem() {
  const { wallet, safe, currentNonce, gasPrice } = await getWalletAndSafe();

  const safeTxn: SafeTransaction = {
    to: CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS,
    operation: OperationType.Call,
    data: encodeErc1155Approve(NEG_RISK_ADAPTER_ADDRESS, true),
    value: "0",
  };

  try {
    const txn = await signAndExecuteSafeTransaction(wallet, safe, safeTxn, {
      nonce: currentNonce,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
    });

    await txn.wait();
    log(`✅ Approval confirmed for spender: ${NEG_RISK_ADAPTER_ADDRESS}`);
  } catch (err) {
    error("❌ Approval Error:", err);
  }
}

export async function redeem(
  conditionId: string,
  negRisk: boolean | null,
  redeemAmounts: [string, string]
) {
  await approveRedeem();

  const { wallet, safe, currentNonce, gasPrice } = await getWalletAndSafe();

  const to = negRisk
    ? NEG_RISK_ADAPTER_ADDRESS
    : CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS;
  const data = negRisk
    ? encodeRedeemNegRisk(conditionId, redeemAmounts)
    : encodeRedeem(USDC_ADDRESS, conditionId);

  const safeTxn: SafeTransaction = {
    to,
    data,
    operation: OperationType.Call,
    value: "0",
  };

  const txn = await signAndExecuteSafeTransaction(wallet, safe, safeTxn, {
    nonce: currentNonce,
    maxFeePerGas: gasPrice,
    maxPriorityFeePerGas: gasPrice,
  });

  await txn.wait();
  log(`✅ Redeem confirmed for condition ID: ${conditionId}`);
  return txn;
}
