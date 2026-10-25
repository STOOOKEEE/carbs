// Setup of the minting page (mint.html): an outside account, funded from the genesis account,
// that the session key tries to pay during the "abuse" demonstration. Created once per server
// process; its seed is dropped at once: nobody needs to sign for it.

import type { IncomingMessage, ServerResponse } from "node:http";

import { generateSeed } from "ripple-keypairs";

import { addressOfSeed } from "../src/ledger.ts";

export const MINT_API_PREFIX = "/api/mint/";
export const MINT_SETUP_PATH = `${MINT_API_PREFIX}setup`;

/** What the page receives from POST /api/mint/setup. */
export interface MintSetup {
  /** A funded account outside the studio: where a hijacked desk would send the XRP. */
  outsider: string;
}

/** Funds an address from the genesis account (the server's faucet); resolves to the tx hash. */
type Fund = (destination: string) => Promise<string>;

let setup: Promise<MintSetup> | undefined;

async function createSetup(fund: Fund): Promise<MintSetup> {
  const outsider = addressOfSeed(generateSeed({ algorithm: "ecdsa-secp256k1" }));
  const hash = await fund(outsider);
  console.log(`mint: outside account ${outsider} funded (${hash})`);
  return { outsider };
}

/** The setup of this server process; a failed creation is retried on the next request. */
function mintSetup(fund: Fund): Promise<MintSetup> {
  setup ??= createSetup(fund).catch((error: unknown) => {
    setup = undefined;
    throw error;
  });
  return setup;
}

function replyJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function handleMint(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  fund: Fund,
): Promise<void> {
  if (path !== MINT_SETUP_PATH) {
    replyJson(res, 404, { error: "not found" });
    return;
  }
  if (req.method !== "POST") {
    replyJson(res, 405, { error: "method not allowed" });
    return;
  }
  replyJson(res, 200, await mintSetup(fund));
}
