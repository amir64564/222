import { config } from "./config";

let killSwitchEngaged = false;
let runtimeSlippageBps = config.maxSlippageBps;

export function engageKillSwitch(): void { killSwitchEngaged = true; }
export function releaseKillSwitch(): void { killSwitchEngaged = false; }
export function isKillSwitchEngaged(): boolean { return killSwitchEngaged; }
export function getRuntimeSlippageBps(): number { return runtimeSlippageBps; }
export function setRuntimeSlippageBps(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10000) throw new Error("Slippage must be between 0% and 100%");
  runtimeSlippageBps = Math.round(value);
  return runtimeSlippageBps;
}
export function checkExecutionAllowed(): { allowed: boolean; reason?: string } {
  if (killSwitchEngaged) return { allowed: false, reason: "STOP is engaged" };
  if (!config.autoBuy && !config.dryRun) return { allowed: false, reason: "AUTO_BUY=false" };
  if (config.buyAmountEth <= 0) return { allowed: false, reason: "BUY_AMOUNT_ETH must be > 0" };
  return { allowed: true };
}
