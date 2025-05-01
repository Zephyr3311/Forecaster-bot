import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import {
  Contract,
  Interface,
  ZeroAddress,
  ethers,
  getBytes,
  type ContractRunner,
} from "ethers";
import safeAbi from "./abi/GnosisSafe.json";
import { getWallet } from "./utils/web3";

// --- Constants ---
const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"; // Conditional Tokens Framework on Polygon
const NEG_RISK_ADAPTER_ADDRESS = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296"; // NegRiskAdapter on Polygon
const SAFE_ADDRESS = process.env.POLYMARKET_FUNDER_ADDRESS;
const PK = process.env.PK;

// Minimal CTF Interface needed
const ctfInterface = new Interface([
  "function setApprovalForAll(address operator, bool approved)",
]);

// Operation Type for Gnosis Safe execTransaction
enum OperationType {
  Call = 0,
  DelegateCall = 1,
}

// Structure matching SafeTransaction used in reference examples
interface SafeTransaction {
  to: string;
  operation: OperationType;
  data: string;
  value: string | bigint; // Allow bigint for value
  safeTxGas?: string | bigint;
  baseGas?: string | bigint;
  gasPrice?: string | bigint;
  gasToken?: string;
  refundReceiver?: string;
  nonce?: bigint;
}

async function main() {
  if (!SAFE_ADDRESS || !PK) {
    error("POLYMARKET_FUNDER_ADDRESS and PK must be set in your environment.");
    process.exit(1);
  }

  log(`Gnosis Safe Address: ${SAFE_ADDRESS}`);
  log(`Approving Operator:  ${NEG_RISK_ADAPTER_ADDRESS}`);
  log(`On Contract (CTF):   ${CTF_ADDRESS}`);

  try {
    const wallet = getWallet(PK); // Your EOA wallet controlling the Safe
    log(`Using EOA Signer:  ${wallet.address}`);

    const safeContract = new Contract(
      SAFE_ADDRESS,
      safeAbi,
      wallet as unknown as ContractRunner
    );
    const balance = await wallet.provider.getBalance(SAFE_ADDRESS);
    const balanceInMatic = ethers.formatEther(balance.toString()); // Convert Wei to MATIC
    log(`Safe MATIC Balance: ${balanceInMatic} MATIC`);
    // 1. Encode the target transaction data (setApprovalForAll)
    const approvalData = ctfInterface.encodeFunctionData("setApprovalForAll", [
      NEG_RISK_ADAPTER_ADDRESS,
      true,
    ]);

    // 2. Get the current nonce for the Safe
    const nonce = await safeContract.nonce?.();
    log(`Current Safe Nonce: ${nonce}`);

    // 3. Construct the SafeTransaction object
    const safeTx: SafeTransaction = {
      to: CTF_ADDRESS,
      value: "0",
      data: approvalData,
      operation: OperationType.Call,
      safeTxGas: 0n, // Optional: Estimate or set appropriately if needed
      baseGas: 0n, // Optional: Estimate or set appropriately if needed
      gasPrice: 0n, // For EIP-1559 txs, this is 0
      gasToken: ZeroAddress, // Use ETH/Native token for gas
      refundReceiver: ZeroAddress, // No refund receiver
      nonce: nonce,
    };

    // 4. Get the transaction hash from the Safe contract
    const txHash = await safeContract.getTransactionHash?.(
      safeTx.to,
      safeTx.value,
      safeTx.data,
      safeTx.operation,
      safeTx.safeTxGas,
      safeTx.baseGas,
      safeTx.gasPrice,
      safeTx.gasToken,
      safeTx.refundReceiver,
      safeTx.nonce
    );
    log(`Safe Transaction Hash: ${txHash}`);

    // 5. Sign the transaction hash with the EOA wallet
    // Gnosis Safe uses EIP-1271 for contract signatures.
    // For EOA owners, this involves signing the bytes32 transaction hash directly.
    const signature = await wallet.signMessage(getBytes(txHash));

    // Adjust 'v' value for contract signature verification if needed
    let sigV = parseInt(signature.slice(-2), 16);
    if (sigV < 27) {
      // Correct for hardware wallets or certain signers
      sigV += 27;
    }
    if (sigV < 31) {
      // EIP-155 adjustment for contract signatures (v + 4)
      sigV += 4;
    }

    const adjustedSig = signature.slice(0, -2) + sigV.toString(16);

    // 6. Execute the transaction via the Safe
    log("Sending transaction to Safe...");
    const executeTxResponse = await safeContract.execTransaction?.(
      safeTx.to,
      safeTx.value,
      safeTx.data,
      safeTx.operation,
      safeTx.safeTxGas,
      safeTx.baseGas,
      safeTx.gasPrice,
      safeTx.gasToken,
      safeTx.refundReceiver,
      adjustedSig,
      // You might need to add gas overrides here if estimation fails
      {
        maxFeePerGas: ethers.parseUnits("32", "gwei"), // Set to 50 Gwei (adjust as needed)
        maxPriorityFeePerGas: ethers.parseUnits("30", "gwei"), // Minimum 30 Gwei
      }
    );

    log(`Transaction sent: ${executeTxResponse.hash}`);
    log("Waiting for confirmation...");

    const receipt = await executeTxResponse.wait();

    log(`✅ Transaction confirmed! Block Number: ${receipt?.blockNumber}`);
    log(
      `Approval should now be set. You can try running the llm-bot or redemption logic again.`
    );
  } catch (err) {
    error("Error executing Safe transaction:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  error("Unhandled error in main:", err);
  process.exit(1);
});
