import "@dotenvx/dotenvx/config";
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

export async function approveRedeem() {
  console.log(`Starting ERC1155 approval...`);

  const provider = new ethers.providers.JsonRpcProvider(
    `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
  const pk = new ethers.Wallet(process.env.PK);
  const wallet = pk.connect(provider); // This is your EOA signer

  console.log(`Using EOA Signer Address: ${wallet.address}`);

  // === Values to Set ===
  // 1. Set the Safe Address (the contract holding the funds/shares)
  const safeAddress = process.env.POLYMARKET_FUNDER_ADDRESS; // Get Safe address from env
  console.log(`Targeting Safe Address: ${safeAddress}`);

  // 2. Set the Spender Address (the contract that needs approval)
  const spender = NEG_RISK_ADAPTER_ADDRESS; // The Neg Risk Adapter needs approval
  console.log(`Approving Spender: ${spender}`);

  // 3. Create the Safe Contract instance
  const safe = new ethers.Contract(safeAddress, safeAbi, wallet);

  // === Construct the Safe Transaction ===
  // Approves the 'spender' for ERC1155 tokens managed by the CTF contract
  const safeTxn: SafeTransaction = {
    // The Safe needs to call the CTF contract to set the approval
    to: CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS,
    operation: OperationType.Call, // Standard contract call
    // Encodes the 'setApprovalForAll(address spender, bool approved)' function call
    data: encodeErc1155Approve(spender, true), // Granting approval (true)
    value: "0", // No MATIC value transferred
  };

  console.log(`Preparing Safe transaction:`);
  console.log(`  to: ${safeTxn.to} (CTF Contract)`);
  console.log(`  operation: ${safeTxn.operation}`);
  console.log(`  data: ${safeTxn.data}`);
  console.log(`  value: ${safeTxn.value}`);
  const competitiveGasPrice = ethers.utils.parseUnits("50", "gwei"); // Example: 50 Gwei
  try {
    // Sign and execute the transaction via the Safe
    // REMOVE the hardcoded gasPrice - let ethers estimate
    console.log("Signing and executing transaction via Safe...");
    const txn = await signAndExecuteSafeTransaction(
      wallet, // EOA signer
      safe, // Safe contract instance
      safeTxn, // The transaction details for the Safe to execute
      {
        // nonce: 5,
        // Use maxFeePerGas and maxPriorityFeePerGas for EIP-1559
        maxFeePerGas: competitiveGasPrice,
        maxPriorityFeePerGas: competitiveGasPrice, // Can often be slightly lower, but matching is safe
      }
    );

    console.log(`Transaction submitted. Hash: ${txn.hash}`);
    console.log("Waiting for transaction confirmation...");

    await txn.wait(); // Wait for the transaction to be mined

    console.log(`✅ Approval transaction confirmed!`);
    console.log(
      `Safe ${safeAddress} has approved ${spender} for ERC1155 management.`
    );
  } catch (error) {
    console.error("❌ Error executing approval transaction:", error);
  }

  console.log(`Done!`);
}

export async function redeem(
  conditionId: string,
  negRisk: boolean | null,
  redeemAmounts: [string, string]
) {
  await approveRedeem();
  
  console.log(`Starting...`, conditionId, negRisk, redeemAmounts);

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

  // For negative risk positions, MUST USE the negRiskAdapter
  // The key fix here is ensuring the right contract address and encoding method are used
  const data = negRisk
    ? encodeRedeemNegRisk(conditionId, redeemAmounts)
    : encodeRedeem(USDC_ADDRESS, conditionId);

  const to = negRisk
    ? NEG_RISK_ADAPTER_ADDRESS // Make sure this is the correct negRiskAdapter address
    : CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS;

  console.log(`Using contract: ${to}`);
  console.log(`Using encoded function data: ${data}`);

  const safeTxn: SafeTransaction = {
    to: to,
    data: data,
    operation: OperationType.Call,
    value: "0",
  };

  const txn = await signAndExecuteSafeTransaction(wallet, safe, safeTxn, {
    nonce: 6,
    gasPrice: 300000000000, // Using 300 Gwei to ensure transaction goes through
    gasLimit: 1000000, // Higher gas limit to handle complex contract interactions
  });

  await txn.wait();

  console.log(`Done!`);
  return txn;
}
