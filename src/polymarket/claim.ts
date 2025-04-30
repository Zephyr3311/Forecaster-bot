import { type TransactionRequest } from "@ethersproject/abstract-provider";
import { type Deferrable } from "@ethersproject/properties";
import { error, log } from "console";
import { Interface, ZeroHash } from "ethers";
import { getWallet } from "../utils/web3";
const wallet = getWallet(process.env.PK);

/**
 * Approves the redemption contracts to handle tokens before attempting redemption
 */
export async function approveTokenTransfers() {
  try {
    log("Setting approvals for redemption contracts...");

    // CTF contract address
    const ctfAddress = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

    // Get contract interface
    const ctfInterface = new Interface([
      "function setApprovalForAll(address operator, bool approved)",
    ]);

    // Approve NegRisk adapter
    const approveTx: Deferrable<TransactionRequest> = {
      to: ctfAddress,
      data: ctfInterface.encodeFunctionData("setApprovalForAll", [
        "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296", // NegRisk adapter
        true, // Approved
      ]),
      
    };

    const response = await wallet.sendTransaction(approveTx);
    log(`Approval transaction sent: ${response.hash}`);

    // await response.wait();
    log("✅ Successfully approved NegRisk adapter");

    return true;
  } catch (err) {
    error("Error setting approvals:", err);
    return false;
  }
}

// Helper function to encode redemption function call
export function encodeRedeemFunction(
  conditionId: string,
  isNegRisk: boolean | null
) {
  if (isNegRisk) {
    // For NegRisk markets
    const negRiskInterface = new Interface([
      "function redeemPositions(bytes32,uint256[])",
    ]);

    return negRiskInterface.encodeFunctionData("redeemPositions", [
      conditionId,
      ["1", "1"], // Standard amounts for NegRisk redemption
    ]);
  } else {
    // For standard markets
    const ctfInterface = new Interface([
      "function redeemPositions(address,bytes32,bytes32,uint256[])",
    ]);

    return ctfInterface.encodeFunctionData("redeemPositions", [
      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC address
      ZeroHash, // Empty parent collection ID
      conditionId,
      [1, 2], // Binary indices for YES/NO markets
    ]);
  }
}
