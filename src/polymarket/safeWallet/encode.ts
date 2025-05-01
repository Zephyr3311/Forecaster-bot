import { ethers } from "ethers";
import { Interface } from "ethers/lib/utils";
import { ctfAbi } from "./abis/ctfAbi";
import { negRiskAdapterAbi } from "./abis/negRiskAdapterAbi";

const CTF_INTERFACE = new Interface(ctfAbi);
const NEG_RISK_INTERFACE = new Interface(negRiskAdapterAbi);

export const encodeRedeem = (
  collateralToken: string,
  conditionId: string
): string => {
  return CTF_INTERFACE.encodeFunctionData(
    "redeemPositions(address,bytes32,bytes32,uint256[])",
    [collateralToken, ethers.constants.HashZero, conditionId, [1, 2]]
  );
};

export const encodeRedeemNegRisk = (
  conditionId: string,
  amounts: string[]
): string => {
  return NEG_RISK_INTERFACE.encodeFunctionData(
    "redeemPositions(bytes32,uint256[])",
    [conditionId, amounts]
  );
};
