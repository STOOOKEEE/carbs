/** The command line of `pnpm demo`. */

export const DEFAULT_WEB_PORT = 3000;

export interface Args {
  web: boolean;
  webPort: number;
  keep: boolean;
  /** Other pages allowed to call the dev faucet, for example the hosted web app. */
  webOrigins: string[];
}

/** `https://carbs-kappa.vercel.app`, never a path, a wildcard or another scheme. */
export function parseOrigin(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(
      `--web-origin needs an origin such as https://example.org, not ${String(value)}`,
    );
  }
  const plainHost = /^([a-z0-9-]+\.)*[a-z0-9-]+$|^\[[0-9a-f:]+\]$/i.test(url.hostname);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.origin !== value ||
    !plainHost
  ) {
    throw new Error(
      `--web-origin needs an origin such as https://example.org, not ${String(value)}`,
    );
  }
  return url.origin;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { web: true, webPort: DEFAULT_WEB_PORT, keep: false, webOrigins: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--no-web") args.web = false;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--web-port") args.webPort = Number(argv[(i += 1)]);
    else if (arg === "--web-origin") args.webOrigins.push(parseOrigin(argv[(i += 1)]));
    else throw new Error(`unknown argument ${String(arg)}`);
  }
  return args;
}

/** The pages the dev faucet answers: the local web app, and the origins given on the command line. */
export function faucetOrigins(args: Args): string[] {
  return [
    ...new Set([
      `http://localhost:${args.webPort}`,
      `http://127.0.0.1:${args.webPort}`,
      ...args.webOrigins,
    ]),
  ];
}
