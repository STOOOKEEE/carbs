/**
 * The Content-Security-Policy, built from the configured networks. `script-src` is
 * `'self'` alone (no `unsafe-inline`, no hash, no third-party script); `connect-src`
 * lists the hosts of the networks' nodes and faucets, never a bare scheme or a wildcard.
 * Explorers and the team's apps are only linked to: navigation needs no `connect-src`.
 * `nuxt.config.ts` serves it; `docs/DEPLOY.md` and `vercel.json` carry the same text
 * (a test fails if they drift).
 */

export interface CspOptions {
  /** Origins the page may connect to besides itself, for example `wss://alphanet.xrpl.org`. */
  connectOrigins: readonly string[];
  /** Dev server only: Vite's hot-reload WebSocket. */
  dev?: boolean;
}

export function buildCspDirectives(options: CspOptions): string[] {
  const connect = ["'self'", ...options.connectOrigins];
  if (options.dev === true) connect.push("ws://localhost:*", "ws://127.0.0.1:*");
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
}

export function buildCsp(options: CspOptions): string {
  return buildCspDirectives(options).join("; ");
}

/** The meta-tag form: browsers ignore `frame-ancestors` there. */
export function buildMetaCsp(options: CspOptions): string {
  return buildCspDirectives(options)
    .filter((directive) => !directive.startsWith("frame-ancestors"))
    .join("; ");
}

export interface SecurityHeaders {
  "Content-Security-Policy": string;
  "Referrer-Policy": string;
  "X-Content-Type-Options": string;
}

export function securityHeaders(csp: string): SecurityHeaders {
  return {
    "Content-Security-Policy": csp,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Netlify's `_headers` file. */
export function netlifyHeaders(headers: SecurityHeaders): string {
  const lines = Object.entries(headers).map(([key, value]) => `  ${key}: ${value}`);
  return ["/*", ...lines, ""].join("\n");
}

/** Vercel's `vercel.json`. */
export function vercelConfig(headers: SecurityHeaders): string {
  const list = Object.entries(headers).map(([key, value]) => ({ key, value }));
  return `${JSON.stringify({ headers: [{ source: "/(.*)", headers: list }] }, null, 2)}\n`;
}
