import { AssetType, type ClobClient } from "@polymarket/clob-client";
import { log } from "console";
import { formatUnits } from "ethers/lib/utils";
import { USDCE_DIGITS } from "../polymarket/constants";
import { getClobClient, getWallet } from "./web3";

import type { Wallet } from "@ethersproject/wallet";
// Portfolio state for managing balances and positions
export class PortfolioState {
  clobClient: ClobClient;
  wallet: Wallet;

  currentModelOrg: string | null = null;
  assetBalances: Map<string, string> = new Map();
  collateralBalance: string = "0";

  constructor() {
    this.wallet = getWallet(process.env.PK);
    this.clobClient = getClobClient(this.wallet);
    log("Portfolio state initialized with clobClient");
  }

  // Method to update a specific asset balance
  updateAssetBalance(assetId: string, balance: string) {
    this.assetBalances.set(assetId, balance);
  }

  // Method to update collateral balance
  updateCollateralBalance(balance: string) {
    this.collateralBalance = balance;
  }

  // Method to fetch and cache balance if not already present
  async fetchAssetBalanceIfNeeded(assetId: string): Promise<string> {
    if (!this.assetBalances.has(assetId)) {
      const balance = await this.clobClient.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: assetId,
      });
      this.assetBalances.set(assetId, balance.balance);
      log(
        `Fetched balance for ${assetId}: ${formatUnits(
          balance.balance,
          USDCE_DIGITS
        )}`
      );
    }

    return this.assetBalances.get(assetId)!;
  }

  // Method to fetch and update collateral balance
  async fetchCollateralBalance(): Promise<string> {
    const balance = await this.clobClient.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });
    this.collateralBalance = balance.balance;
    log(
      `Fetched collateral balance: ${formatUnits(
        balance.balance,
        USDCE_DIGITS
      )}`
    );
    return this.collateralBalance;
  }

  // Method to clear all cached balances
  clearBalances() {
    this.assetBalances.clear();
    this.collateralBalance = "0";
    log("Cleared all cached balances");
  }
}

// Export a single static instance
export const portfolioState = new PortfolioState();
