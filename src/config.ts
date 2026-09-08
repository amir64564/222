import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  X_WATCHER_MODE: z.enum(["cookie", "api"]).default("cookie"),
  X_USERNAME: z.string().trim().min(1),
  POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
  X_BEARER_TOKEN: z.string().default(""),
  X_AUTH_TOKEN: z.string().default(""),
  X_CT0: z.string().default(""),
  RPC_URL: z.string().url().default("https://mainnet.base.org"),
  PRIVATE_KEY: z.string().default("0x0000000000000000000000000000000000000000000000000000000000000000"),
  UNISWAP_ROUTER_ADDRESS: z.string().default("0x2626664c2603336E57B271c5C0b26F421741e481"),
  WETH_ADDRESS: z.string().default("0x4200000000000000000000000000000000000006"),
  TARGET_TICKER: z.string().trim().min(1),
  TARGET_NAME: z.string().trim().min(1),
  BUY_AMOUNT_ETH: z.coerce.number().positive().default(0.01),
  MAX_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(10000).default(2000),
  DRY_RUN: z.string().transform((v) => v.trim().toLowerCase() === "true").default("true"),
  AUTO_BUY: z.string().transform((v) => v.trim().toLowerCase() === "true").default("false"),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid configuration: ${message}`);
}

const env = parsed.data;

export const config = {
  xWatcherMode: env.X_WATCHER_MODE,
  xUsername: env.X_USERNAME.replace(/^@/, ""),
  xPollIntervalMs: env.POLL_INTERVAL_MS,
  xBearerToken: env.X_BEARER_TOKEN,
  xAuthToken: env.X_AUTH_TOKEN,
  xCt0: env.X_CT0,

  chainId: 8453 as const,
  rpcUrl: env.RPC_URL,
  privateKey: env.PRIVATE_KEY,
  uniswapRouterAddress: env.UNISWAP_ROUTER_ADDRESS,
  wethAddress: env.WETH_ADDRESS,
  uniswapQuoterV2Address: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  uniswapV3FactoryAddress: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  uniswapFeeTier: 10000 as const,

  targetTicker: env.TARGET_TICKER,
  targetName: env.TARGET_NAME,
  buyAmountEth: env.BUY_AMOUNT_ETH,
  maxSlippageBps: env.MAX_SLIPPAGE_BPS,
  dryRun: env.DRY_RUN,
  autoBuy: env.AUTO_BUY,

  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  telegramChatId: env.TELEGRAM_CHAT_ID,
  databasePath: path.resolve("data", "bot.db"),
};

const ZERO_PRIVATE_KEY = /^0x0{64}$/i;

export function validateConfig(): string[] {
  const problems: string[] = [];
  if (config.xWatcherMode === "api" && !config.xBearerToken) problems.push("X_BEARER_TOKEN is required for X_WATCHER_MODE=api");
  if (config.xWatcherMode === "cookie" && (!config.xAuthToken || !config.xCt0)) {
    problems.push("X_AUTH_TOKEN and X_CT0 are required for X_WATCHER_MODE=cookie");
  }
  if (!config.telegramBotToken || !config.telegramChatId) {
    loggerlessNoop();
  }
  if (config.autoBuy && !config.dryRun) {
    if (ZERO_PRIVATE_KEY.test(config.privateKey)) problems.push("PRIVATE_KEY must be set for live trading");
  }
  return problems;
}

function loggerlessNoop(): void {
  // Telegram is optional for monitoring/trading; missing credentials simply disable alerts/commands.
}
