/**
 * What the Local node dialog tells a person to run. `pnpm demo` (`scripts/src/demo.ts`)
 * starts the standalone node with the amendment, its ledger closer and a dev faucet on the
 * loopback; `--no-web` leaves the web app out (this page is the web app), and `--web-origin`
 * lets this page call the dev faucet when it is not the local dev server.
 */

/** How to build `xrpld` with the SigningSessions amendment. */
export const BUILDING_DOC_URL = "https://github.com/STOOOKEEE/carbs/blob/main/docs/BUILDING.md";

/** Pages the dev faucet answers without `--web-origin` (`scripts/src/args.ts`, default port). */
const FAUCET_DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

/** The command to start the node, its closer and the dev faucet for a page served at `pageOrigin`. */
export function demoCommand(pageOrigin: string | null): string {
  const base = "XRPLD_BIN=/path/to/xrpld GENESIS_SEED=… pnpm demo --no-web";
  if (pageOrigin === null || FAUCET_DEFAULT_ORIGINS.includes(pageOrigin)) return base;
  return `${base} --web-origin ${pageOrigin}`;
}
