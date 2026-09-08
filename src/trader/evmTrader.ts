import { Address, parseEther } from "viem";
import { config } from "../config";
import { publicClient, getWalletClient } from "../base";
import { BuyResult, Trader } from "./trader";

const QUOTER_ABI = [
  {
    type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
    inputs: [{ name: "params", type: "tuple", components: [
      { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" }, { name: "fee", type: "uint24" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ]}],
    outputs: [{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }],
  },
] as const;

const ROUTER_ABI = [
  {
    type: "function", name: "exactInputSingle", stateMutability: "payable",
    inputs: [{ name: "params", type: "tuple", components: [
      { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
      { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ]}],
    outputs: [{ type: "uint256" }],
  },
] as const;

const FACTORY_ABI = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [
    { name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" },
  ], outputs: [{ type: "address" }] },
] as const;

export class EVMTrader implements Trader {
  async executeBuy(address: string, buyAmountEth: number, maxSlippageBps: number): Promise<BuyResult> {
    const tokenOut = address as Address;
    const tokenIn = config.wethAddress as Address;
    const amountIn = parseEther(String(buyAmountEth));

    const pool = await publicClient.readContract({
      address: config.uniswapV3FactoryAddress as Address,
      abi: FACTORY_ABI,
      functionName: "getPool",
      args: [tokenIn, tokenOut, config.uniswapFeeTier],
    });
    if (pool === "0x0000000000000000000000000000000000000000") {
      throw new Error(`No Uniswap V3 pool at fee tier ${config.uniswapFeeTier}`);
    }

    const [quotedAmountOut] = await publicClient.readContract({
      address: config.uniswapQuoterV2Address as Address,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee: config.uniswapFeeTier, sqrtPriceLimitX96: 0n }],
    });

    if (quotedAmountOut <= 0n) throw new Error("Uniswap V3 quote returned zero output");
    const minTokenAmount = (quotedAmountOut * BigInt(10_000 - maxSlippageBps)) / 10_000n;
    const wallet = getWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("Wallet account unavailable");

    const txHash = await wallet.writeContract({
      address: config.uniswapRouterAddress as Address,
      abi: ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [{
        tokenIn,
        tokenOut,
        fee: config.uniswapFeeTier,
        recipient: account.address,
        amountIn,
        amountOutMinimum: minTokenAmount,
        sqrtPriceLimitX96: 0n,
      }],
      value: amountIn,
      account,
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash, quotedTokenAmount: quotedAmountOut, minTokenAmount };
  }
}
