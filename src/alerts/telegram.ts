import { Telegraf } from "telegraf";
import { config } from "../config";
import { logger } from "../utils/logger";
import { engageKillSwitch, releaseKillSwitch, isKillSwitchEngaged, getRuntimeSlippageBps, setRuntimeSlippageBps } from "../riskManager";
import { getStats } from "../database";

let bot: Telegraf | null = null;
const queue: string[] = [];
let workerRunning = false;

type Verbosity = "all" | "important" | "success_only";
const LEVEL_RANK: Record<Verbosity, number> = { all: 0, important: 1, success_only: 2 };

function shouldSend(_level: Verbosity) { return true; }
async function worker() {
  if (workerRunning || !bot || !config.telegramChatId) return; workerRunning = true;
  try { while (queue.length) { const text = queue.shift()!; await bot.telegram.sendMessage(config.telegramChatId, text).catch((err) => logger.error("Telegram send failed", { error: err.message })); } }
  finally { workerRunning = false; }
}
export function initTelegram(): Telegraf | null {
  if (bot) return bot;
  if (!config.telegramBotToken || !config.telegramChatId) { logger.warn("Telegram disabled: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured"); return null; }
  bot = new Telegraf(config.telegramBotToken);
  const authorized = (chatId: number | string) => String(chatId) === String(config.telegramChatId);
  bot.command("stop", (ctx) => { if (!authorized(ctx.chat.id)) return; engageKillSwitch(); ctx.reply("🛑 STOP engaged. Monitoring + verification continue; buying is halted."); });
  bot.command("resume", (ctx) => { if (!authorized(ctx.chat.id)) return; releaseKillSwitch(); ctx.reply("▶️ RESUME enabled. Buying follows AUTO_BUY + DRY_RUN."); });
  bot.on("text", (ctx) => {
    if (!authorized(ctx.chat.id)) return;
    const text = ctx.message.text.trim();
    if (/^STOP$/i.test(text)) { engageKillSwitch(); void ctx.reply("🛑 STOP engaged."); return; }
    if (/^RESUME$/i.test(text)) { releaseKillSwitch(); void ctx.reply("▶️ RESUME enabled."); return; }
    const match = text.match(/^SLIPPAGE\s+(\d+(?:\.\d+)?)%$/i);
    if (!match) return;
    const pct = Number(match[1]);
    try { const bps = setRuntimeSlippageBps(pct * 100); void ctx.reply(`✅ Slippage set to ${pct}% (${bps} bps).`); }
    catch { void ctx.reply("❌ Slippage must be between 0% and 100%."); }
  });
  bot.command("status", (ctx) => { if (!authorized(ctx.chat.id)) return; const s = getStats(); ctx.reply([
    "📊 BOT STATUS", `Watcher: ${config.xWatcherMode}`, `Target: @${config.xUsername}`, `AUTO_BUY=${config.autoBuy}`, `DRY_RUN=${config.dryRun}`,
    `Kill switch: ${isKillSwitchEngaged() ? "ENGAGED" : "off"}`, `Slippage: ${getRuntimeSlippageBps()/100}%`, `Target ticker: ${config.targetTicker}`, `Target name: ${config.targetName}`,
    `Detected CAs: ${s.detectedCAs}`, `Success/simulated: ${s.successfulBuys}`, `Failed: ${s.failedBuys}`, `Rejected: ${s.rejectedBuys}`
  ].join("\n")); });
  bot.catch((err) => logger.error("Telegram bot error", { error: String(err) }));
  void bot.launch().catch((err) => logger.error("Telegram launch failed", { error: err.message }));
  return bot;
}
export function send(text: string, level: Verbosity = "all"): void { if (!bot || !shouldSend(level)) return; queue.push(text); void worker(); }
export function alertCADetected(p: { address:string; chain:string; sourceUsername:string; sourcePostId:string }) { send(["🔎 CA DETECTED", `Chain: ${p.chain}`, `CA: ${p.address}`, `Source: @${p.sourceUsername}`, `Post: ${p.sourcePostId}`].join("\n")); }
export function alertValidationFailed(p: { address:string; chain:string; reason:string }) { send(["⚠️ VERIFICATION FAILED", `Chain: ${p.chain}`, `CA: ${p.address}`, `Reason: ${p.reason}`].join("\n"), "important"); }
export function alertTokenMatch(p: { address:string; ticker:string; name:string; sourceUsername:string; sourcePostId:string }) { send(["✅ ON-CHAIN MATCH", `Ticker: ${p.ticker}`, `Name: ${p.name}`, `CA: ${p.address}`, `Source: @${p.sourceUsername}`, `Post: ${p.sourcePostId}`].join("\n"), "important"); }
export function alertTradeRejected(p: { address:string; reason:string }) { send(["🚫 TRADE REJECTED", `CA: ${p.address}`, `Reason: ${p.reason}`].join("\n"), "important"); }
export function alertTradeFailed(p: { address:string; error:string }) { send(["🔴 TRADE FAILED", `CA: ${p.address}`, `Error: ${p.error}`].join("\n"), "important"); }
export function alertBuySuccess(p: { ticker:string; name:string; amountEth:number; address:string; txHash:string; simulated:boolean }) { send([(p.simulated?"🟡 SIMULATED BUY (DRY_RUN)":"🟢 AUTO BUY SUCCESS"), `Ticker: ${p.ticker}`, `Name: ${p.name}`, `Amount: ${p.amountEth} ETH`, `CA: ${p.address}`, `TX: ${p.txHash}`].join("\n"), "important"); }
export function alertBotError(message:string) { send(`❗ BOT ERROR\n\n${message}`, "important"); }
