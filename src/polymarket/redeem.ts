import { log } from "console";
import { ethers } from "ethers";
import { type SafeTransaction, OperationType } from "../types";
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

export async function verifyEOANonce() {
  log("Starting EOA nonce verification...");

  const { wallet, provider } = await getWalletAndSafe();

  log(`Using EOA Signer Address: ${wallet.address}`);

  try {
    // --- Get the Current Nonce the Network Expects ---
    // "pending" includes transactions in the mempool, "latest" is only confirmed blocks.
    // For sending the *next* transaction, "latest" confirmed count is what we need.
    const currentNonce = await provider.getTransactionCount(
      wallet.address,
      "latest" // Get count of *confirmed* transactions
    );
    log(
      `Current CONFIRMED transaction count (Next Required Nonce): ${currentNonce}`
    );

    // --- Prepare a Simple Self-Transfer Transaction ---
    const amountToSend = ethers.utils.parseUnits("0.001", "ether"); // Tiny amount of MATIC
    log(
      `Preparing to send ${ethers.utils.formatEther(
        amountToSend
      )} MATIC to self...`
    );

    // --- Get Recommended Gas Fees ---
    const feeData = await provider.getFeeData();
    log(`Current Fee Data: 
      Gas Price: ${ethers.utils.formatUnits(feeData.gasPrice || 0, "gwei")} Gwei
      Max Fee Per Gas: ${ethers.utils.formatUnits(
        feeData.maxFeePerGas || 0,
        "gwei"
      )} Gwei
      Max Priority Fee Per Gas: ${ethers.utils.formatUnits(
        feeData.maxPriorityFeePerGas || 0,
        "gwei"
      )} Gwei`);

    // Use slightly higher than estimated priority fee for better chance of inclusion
    const priorityFee = feeData.maxPriorityFeePerGas
      ? feeData.maxPriorityFeePerGas.add(ethers.utils.parseUnits("2", "gwei")) // Add 2 Gwei buffer
      : ethers.utils.parseUnits("30", "gwei"); // Fallback if estimation fails

    const maxFee = feeData.maxFeePerGas
      ? feeData.maxFeePerGas
      : ethers.utils.parseUnits("150", "gwei"); // Fallback max fee

    const tx = {
      to: wallet.address, // Sending to self
      value: amountToSend,
      nonce: currentNonce, // Use the fetched nonce
      gasLimit: 21000, // Standard limit for basic MATIC transfer
      maxPriorityFeePerGas: priorityFee,
      maxFeePerGas: maxFee,
      type: 2, // EIP-1559 transaction type
      chainId: (await provider.getNetwork()).chainId,
    };

    log("Transaction details prepared:", tx);

    // --- Send the Transaction ---
    log("Sending transaction...");
    const txResponse = await wallet.sendTransaction(tx);
    log(`Transaction submitted. Hash: ${txResponse.hash}`);
    log("Waiting for confirmation...");

    const receipt = await txResponse.wait(1); // Wait for 1 confirmation
    log(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);

    // --- Verify New Nonce ---
    const newNonce = await provider.getTransactionCount(
      wallet.address,
      "latest"
    );
    log(`NEW Confirmed transaction count (Next Required Nonce): ${newNonce}`);

    if (newNonce === currentNonce + 1) {
      log("✅ Nonce incremented correctly. EOA queue seems clear.");
    } else {
      log(
        `❌ Nonce mismatch! Expected: ${currentNonce + 1}, Actual: ${newNonce}`
      );
      log(
        `This could indicate pending transactions or nonce issues. Please investigate further.`
      );
    }
  } catch (err) {}
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
