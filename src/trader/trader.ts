export interface BuyResult {
  txHash: string;
  quotedTokenAmount: bigint;
  minTokenAmount: bigint;
}

export interface Trader {
  executeBuy(address: string, buyAmountEth: number, maxSlippageBps: number): Promise<BuyResult>;
}
