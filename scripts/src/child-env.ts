/**
 * The environment of the child processes of `pnpm demo` (xrpld, the closer, the web app's dev
 * server). None of them needs the genesis seed: the dev faucet that signs with it runs in the
 * demo process itself. So the seed is removed, even when a caller passes it again.
 */

/** Variables that stay in the demo process. */
export const DEMO_PROCESS_ONLY = ["GENESIS_SEED"] as const;

export function childEnv(
  parent: NodeJS.ProcessEnv,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent, ...extra };
  for (const name of DEMO_PROCESS_ONLY) delete env[name];
  return env;
}
