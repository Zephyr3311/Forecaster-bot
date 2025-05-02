import type { FeeData } from "@ethersproject/abstract-provider";
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

  return { wallet, safe, safeAddress, provider };
}

function calculateFeesWithBuffer(feeData: FeeData) {
  // Apply 50% buffer to current gas prices
  const baseFee =
    feeData.lastBaseFeePerGas || ethers.utils.parseUnits("25", "gwei");
  const priorityFee =
    feeData.maxPriorityFeePerGas || ethers.utils.parseUnits("30", "gwei");

  console.log(baseFee.toString(), priorityFee.toString());

  // Calculate with 50% buffer
  const bufferedPriorityFee = priorityFee.mul(150).div(100);
  const bufferedMaxFee = baseFee.add(bufferedPriorityFee);

  return {
    maxPriorityFeePerGas: bufferedPriorityFee,
    maxFeePerGas: bufferedMaxFee,
  };
}

export async function verifyEOANonce() {
  console.log("Starting EOA nonce verification...");
  const { wallet, provider } = await getWalletAndSafe();
  console.log(`Using EOA: ${wallet.address}`);

  try {
    const currentNonce = await provider.getTransactionCount(
      wallet.address,
      "latest"
    );
    console.log(`Current nonce: ${currentNonce}`);

    const amountToSend = ethers.utils.parseUnits("0.001", "ether");
    const feeData = await provider.getFeeData();
    const fees = calculateFeesWithBuffer(feeData);

    const tx = {
      to: wallet.address,
      value: amountToSend,
      nonce: currentNonce,
      gasLimit: 21000,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      maxFeePerGas: fees.maxFeePerGas,
      type: Number(CallType.DelegateCall),
      chainId: (await provider.getNetwork()).chainId,
    };

    const txResponse = await wallet.sendTransaction(tx);
    console.log(`Tx sent: ${txResponse.hash}`);

    const receipt = await txResponse.wait();
    console.log(`Confirmed in block: ${receipt.blockNumber}`);
  } catch (err) {
    console.error("Error:", err);
  }
}

export async function approveRedeem() {
  console.log(`Starting ERC1155 approval...`);

  const { wallet, safe, safeAddress } = await getWalletAndSafe();
  console.log(`Using EOA: ${wallet.address}, Safe: ${safeAddress}`);

  const spender = NEG_RISK_ADAPTER_ADDRESS;
  const safeTxn: SafeTransaction = {
    to: CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS,
    operation: OperationType.Call,
    data: encodeErc1155Approve(spender, true),
    value: "0",
  };

  const gasPrice = ethers.utils.parseUnits("50", "gwei");
  try {
    const txn = await signAndExecuteSafeTransaction(wallet, safe, safeTxn, {
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
    });

    console.log(`Transaction hash: ${txn.hash}`);
    await txn.wait();
    console.log(`✅ Approval confirmed for spender: ${spender}`);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

export async function redeem(
  conditionId: string,
  negRisk: boolean | null,
  redeemAmounts: [string, string]
) {
  await approveRedeem();
  console.log(`Redeeming:`, conditionId, negRisk, redeemAmounts);

  const { wallet, safe } = await getWalletAndSafe();

  const to = negRisk
    ? NEG_RISK_ADAPTER_ADDRESS
    : CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS;
  const data = negRisk
    ? encodeRedeemNegRisk(conditionId, redeemAmounts)
    : encodeRedeem(USDC_ADDRESS, conditionId);

  console.log(`Using contract: ${to}`);

  const safeTxn: SafeTransaction = {
    to,
    data,
    operation: OperationType.Call,
    value: "0",
  };

  const txn = await signAndExecuteSafeTransaction(wallet, safe, safeTxn, {
    nonce: 6,
  });

  await txn.wait();
  console.log(`Done!`);
  return txn;
}
