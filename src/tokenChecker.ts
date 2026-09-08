import { Address, getAddress } from "viem";
import { config } from "./config";
import { publicClient } from "./base";
import { logger } from "./utils/logger";

const ERC20_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export interface TokenInfo {
  address: string;
  name: string;
  ticker: string;
  decimals: number;
}

export interface ValidationResult {
  passed: boolean;
  reason?: string;
  tokenInfo?: TokenInfo;
}

function normalizeTicker(value: string): string {
  return value.replace(/^\$/, "").trim().toLowerCase();
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function verifyBaseToken(address: string): Promise<ValidationResult> {
  try {
    const tokenAddress = getAddress(address) as Address;
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "name" }),
      publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "symbol" }),
      publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "decimals" }),
    ]);

    const tokenInfo: TokenInfo = {
      address: tokenAddress,
      name,
      ticker: symbol,
      decimals: Number(decimals),
    };

    const tickerMatches = normalizeTicker(symbol) === normalizeTicker(config.targetTicker);
    const nameMatches = normalizeName(name) === normalizeName(config.targetName);

    if (!tickerMatches || !nameMatches) {
      const reasons = [
        !tickerMatches ? `ticker mismatch: on-chain="${symbol}" target="${config.targetTicker}"` : "",
        !nameMatches ? `name mismatch: on-chain="${name}" target="${config.targetName}"` : "",
      ].filter(Boolean);
      return { passed: false, reason: reasons.join("; "), tokenInfo };
    }

    return { passed: true, tokenInfo };
  } catch (error) {
    const reason = (error as Error).message || "ERC-20 read reverted";
    logger.warn("Base token verification failed", { address, error: reason });
    return { passed: false, reason: `invalid/reverting ERC-20 contract: ${reason}` };
  }
}
