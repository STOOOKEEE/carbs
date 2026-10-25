import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCsp,
  buildCspDirectives,
  buildMetaCsp,
  netlifyHeaders,
  securityHeaders,
  vercelConfig,
} from "./csp";
import { NETWORKS, allConnectOrigins } from "./networks";

const options = { connectOrigins: allConnectOrigins(NETWORKS) };
const csp = buildCsp(options);

function directive(policy: string, name: string): string[] {
  const found = policy.split("; ").find((d) => d.startsWith(`${name} `));
  return found === undefined ? [] : found.split(" ").slice(1);
}

describe("Content-Security-Policy", () => {
  it("allows scripts from this origin only: no unsafe-inline, no hash, no host", () => {
    expect(directive(csp, "script-src")).toEqual(["'self'"]);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).not.toContain("unsafe-eval");
  });

  it("lists connect hosts from the networks: no wildcard, no bare scheme", () => {
    const connect = directive(csp, "connect-src");
    expect(connect).toContain("'self'");
    for (const origin of allConnectOrigins(NETWORKS)) expect(connect).toContain(origin);
    for (const source of connect) {
      expect(source, source).not.toMatch(/^(wss?|https?|data|blob):$/);
      expect(source, source).not.toContain("*");
    }
  });

  it("adds the hot-reload socket in development only", () => {
    expect(directive(buildCsp({ ...options, dev: true }), "connect-src")).toContain(
      "ws://localhost:*",
    );
    expect(csp).not.toContain("localhost:*");
  });

  it("keeps the fixed hardening directives", () => {
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'none'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    // form-action does not fall back to default-src: without it a form could post anywhere.
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(buildMetaCsp(options)).toContain("form-action 'self'");
  });

  it("leaves frame-ancestors out of the meta form", () => {
    expect(buildMetaCsp(options)).not.toContain("frame-ancestors");
    expect(buildCspDirectives(options).length - 1).toBe(buildMetaCsp(options).split("; ").length);
  });

  it("sets the other headers", () => {
    const headers = securityHeaders(csp);
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(netlifyHeaders(headers)).toContain("  Referrer-Policy: no-referrer");
  });
});

describe("host configuration files", () => {
  const vercelPath = join(import.meta.dirname, "..", "vercel.json");
  const expected = vercelConfig(securityHeaders(csp));

  it("vercel.json is the policy built from the networks (set UPDATE_HOST_FILES=1 to rewrite it)", () => {
    if (process.env.UPDATE_HOST_FILES === "1") writeFileSync(vercelPath, expected);
    expect(readFileSync(vercelPath, "utf8")).toBe(expected);
  });
});
