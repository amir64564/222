import { getAddress, isAddress } from "viem";

export interface DetectedCA {
  address: string;
  chain: "base";
  sourcePostId: string;
  sourceUsername: string;
}

const EVM_REGEX = /0x[a-fA-F0-9]{40}/g;

export function detectCAs(
  text: string,
  opts: { sourcePostId: string; sourceUsername: string }
): DetectedCA[] {
  const results: DetectedCA[] = [];
  const seen = new Set<string>();

  for (const match of text.match(EVM_REGEX) || []) {
    if (!isAddress(match)) continue;
    const address = getAddress(match);
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    results.push({ address, chain: "base", sourcePostId: opts.sourcePostId, sourceUsername: opts.sourceUsername });
  }

  return results;
}
