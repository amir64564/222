import { base } from "viem/chains";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";

export const publicClient = createPublicClient({
  chain: base,
  transport: http(config.rpcUrl, { timeout: 8000 }),
});

export function getWalletClient() {
  if (!/^0x[a-fA-F0-9]{64}$/.test(config.privateKey)) {
    throw new Error("PRIVATE_KEY is missing or invalid");
  }
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  return createWalletClient({ chain: base, transport: http(config.rpcUrl, { timeout: 8000 }), account });
}
