/**
 * Shared helpers of the spikes. Spikes run against public networks: the AlphaNet with a fresh
 * account per attempt and client-side signing only, mainnet read-only. Seeds stay in memory; a
 * spike never writes, logs or commits one.
 */

import {
  classicSignerFromSeed,
  generateClassicSeed,
  getAccountState,
  kAlphaNetExplorerTxUrl,
  kAlphaNetFaucetUrl,
  type BytesSigner,
  type NodeClient,
} from "../src/index.js";
import { addressFromPublicKey } from "../src/address.js";

export interface FreshAccount {
  address: string;
  master: BytesSigner;
}

const kFaucetPollMs = 2000;
const kFaucetPolls = 30;

/** A new secp256k1 account funded by the AlphaNet faucet (the seed never leaves this process). */
export async function freshAlphaNetAccount(node: NodeClient): Promise<FreshAccount> {
  const master = classicSignerFromSeed(generateClassicSeed("ecdsa-secp256k1"));
  const address = addressFromPublicKey(master.publicKey);
  const response = await fetch(kAlphaNetFaucetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination: address, userAgent: "carbs-spike" }),
  });
  if (!response.ok) throw new Error(`faucet: HTTP ${response.status} ${await response.text()}`);
  for (let i = 0; i < kFaucetPolls; i += 1) {
    const state = await getAccountState(node, address, "validated");
    if (state) return { address, master };
    await new Promise((resolve) => setTimeout(resolve, kFaucetPollMs));
  }
  throw new Error(`faucet: ${address} not funded after ${(kFaucetPolls * kFaucetPollMs) / 1000} s`);
}

export function explorer(hash: string): string {
  return `${kAlphaNetExplorerTxUrl}${hash}`;
}

export function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(34)} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}
