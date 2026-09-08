import { EVMTrader } from "./evmTrader";
export { Trader, BuyResult } from "./trader";
export function getTrader(): EVMTrader { return new EVMTrader(); }
