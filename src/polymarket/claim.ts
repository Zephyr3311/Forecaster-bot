import { Interface, ZeroHash } from "ethers";
import { getWallet } from "../utils/web3";

const wallet = getWallet(process.env.PK);

/**
 * Helper function to encode redemption function call
 * @param conditionId The condition ID of the market to redeem
 * @param isNegRisk Whether the market is a negative risk market
 * @returns Encoded function data for the redemption call
 */
export function encodeRedeemFunction(
  conditionId: string,
  isNegRisk: boolean | null
): string {
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
