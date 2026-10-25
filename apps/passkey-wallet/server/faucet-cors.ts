// CORS for the faucet: only the listed origins (WEB_ORIGINS), POST with a JSON body, no
// credentials. The hosted web app (a public https site) reaches this server on the team's
// tailnet (a 100.64.0.0/10 address), which Chrome counts as a private network: its Private
// Network Access preflight asks for access-control-allow-private-network, answered here for
// the listed origins only.

/** The CORS headers for a request from `origin`, or null when that origin is not allowed. */
export function faucetCorsHeaders(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
  privateNetworkRequested: boolean,
): Record<string, string> | null {
  if (origin === undefined || !allowed.has(origin)) return null;
  const headers: Record<string, string> = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
  if (privateNetworkRequested) headers["access-control-allow-private-network"] = "true";
  return headers;
}
