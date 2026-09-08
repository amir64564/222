import { config, validateConfig } from "./config";
import { logger } from "./utils/logger";
import { XPost, createXWatcher } from "./xWatcher";
import { detectCAs } from "./caDetector";
import { verifyBaseToken } from "./tokenChecker";
import { getTrader } from "./trader";
import { checkExecutionAllowed, getRuntimeSlippageBps } from "./riskManager";
import { isPostProcessed, markPostProcessed, isCAProcessed, saveDetection, createTrade, updateTrade } from "./database";
import { initTelegram, alertCADetected, alertValidationFailed, alertTokenMatch, alertTradeRejected, alertTradeFailed, alertBuySuccess, alertBotError } from "./alerts/telegram";

const inFlightCAs = new Set<string>();

async function handlePost(post: XPost): Promise<void> {
  // Post-level DB guard MUST happen before any post processing.
  if (isPostProcessed(post.id)) return;
  const username = config.xUsername;
  const cas = detectCAs(post.text, { sourcePostId: post.id, sourceUsername: username });
  // Persist the post after detection so a crash cannot silently mark a post complete before CA work starts.
  if (cas.length === 0) { markPostProcessed(post.id, username, post.text); return; }
  await Promise.all(cas.map((ca) => processDetectedCA(ca, post)));
  markPostProcessed(post.id, username, post.text);
}

async function processDetectedCA(ca: { address:string; chain:"base"; sourcePostId:string; sourceUsername:string }, post: XPost): Promise<void> {
  // CA-level DB guard MUST happen before processing. In-memory lock closes async race windows.
  if (isCAProcessed(ca.address, ca.chain)) return;
  const key = ca.address.toLowerCase(); if (inFlightCAs.has(key)) return; inFlightCAs.add(key);
  try {
    alertCADetected({ address: ca.address, chain: ca.chain, sourceUsername: ca.sourceUsername, sourcePostId: ca.sourcePostId });
    const validation = await verifyBaseToken(ca.address);
    // Record the authoritative verification result only AFTER it has been checked, never before the DB guard.
    saveDetection({ address: ca.address, chain: ca.chain, sourcePostId: ca.sourcePostId, sourceUsername: ca.sourceUsername,
      ticker: validation.tokenInfo?.ticker, name: validation.tokenInfo?.name, decimals: validation.tokenInfo?.decimals,
      result: validation.passed ? "match" : (validation.reason?.startsWith("invalid/reverting") ? "error" : "mismatch"), reason: validation.reason });

    if (!validation.passed || !validation.tokenInfo) {
      alertValidationFailed({ address: ca.address, chain: ca.chain, reason: validation.reason || "on-chain criteria mismatch" });
      createTrade({ address: ca.address, chain: ca.chain, ticker: validation.tokenInfo?.ticker, sourcePostId: post.id, sourceUsername: ca.sourceUsername, status: "rejected", dryRun: config.dryRun, errorMessage: validation.reason });
      return;
    }

    alertTokenMatch({ address: ca.address, ticker: validation.tokenInfo.ticker, name: validation.tokenInfo.name, sourceUsername: ca.sourceUsername, sourcePostId: post.id });
    const risk = checkExecutionAllowed();
    if (!risk.allowed) {
      alertTradeRejected({ address: ca.address, reason: risk.reason || "execution not allowed" });
      createTrade({ address: ca.address, chain: ca.chain, ticker: validation.tokenInfo.ticker, sourcePostId: post.id, sourceUsername: ca.sourceUsername, status: "rejected", dryRun: config.dryRun, errorMessage: risk.reason });
      return;
    }

    await executeBuy(ca.address, validation.tokenInfo.ticker, validation.tokenInfo.name, post.id, ca.sourceUsername);
  } catch (err) {
    logger.error("Unhandled CA processing error", { ca, error: (err as Error).message });
    alertBotError(`CA ${ca.address}: ${(err as Error).message}`);
  } finally { inFlightCAs.delete(key); }
}

async function executeBuy(address: string, ticker: string, name: string, postId: string, username: string): Promise<void> {
  const tradeId = createTrade({ address, chain: "base", ticker, sourcePostId: postId, sourceUsername: username, status: "pending", buyAmountEth: config.buyAmountEth, dryRun: config.dryRun });
  if (config.dryRun) {
    const fakeTx = `SIMULATED_${Date.now()}`;
    updateTrade(tradeId, { status: "simulated", txHash: fakeTx });
    alertBuySuccess({ ticker, name, amountEth: config.buyAmountEth, address, txHash: fakeTx, simulated: true });
    return;
  }
  try {
    const result = await getTrader().executeBuy(address, config.buyAmountEth, getRuntimeSlippageBps());
    updateTrade(tradeId, { status: "success", txHash: result.txHash });
    alertBuySuccess({ ticker, name, amountEth: config.buyAmountEth, address, txHash: result.txHash, simulated: false });
  } catch (err) {
    const message = (err as Error).message;
    updateTrade(tradeId, { status: "failed", errorMessage: message });
    alertTradeFailed({ address, error: message });
  }
}

async function main(): Promise<void> {
  const problems = validateConfig();
  if (problems.length) { problems.forEach((p) => logger.error(p)); process.exit(1); }
  initTelegram();
  logger.info("Base CA-first bot starting", { watcher: config.xWatcherMode, user: config.xUsername, chainId: config.chainId, dryRun: config.dryRun, autoBuy: config.autoBuy });

  process.on("unhandledRejection", (reason) => { logger.error("Unhandled rejection", { reason: String(reason) }); alertBotError(String(reason)); });
  process.on("uncaughtException", (err) => { logger.error("Uncaught exception", { error: err.message }); alertBotError(err.message); });

  const watcher = createXWatcher(); watcher.onNewPost(handlePost);
  try { await watcher.start(); }
  catch (err) { logger.error("Watcher failed to start", { error: (err as Error).message }); alertBotError(`Watcher start failed: ${(err as Error).message}`); process.exit(1); }
}
void main();
