// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkStaticOutput } from "../scripts/check-static.mjs";

const ROOT = join(import.meta.dirname, "..");
const SOURCE_DIRS = ["lib", "components", "pages", "layouts", "plugins", "server", "scripts"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|vue|mjs|js)$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  });
}

const files = SOURCE_DIRS.flatMap((dir) => sources(join(ROOT, dir)));
const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("source guards (hard rules of CLAUDE.md)", () => {
  it("scans the sources", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("has no `as any` and no ts-ignore", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bas any\b/);
      expect(text, file).not.toMatch(/@ts-ignore|@ts-nocheck/);
    }
  });

  it("never encodes with the bundled xrpl.js definitions: no direct xrpl or ripple-binary-codec import", () => {
    for (const file of files) {
      const text = code(file);
      expect(text, file).not.toMatch(/from\s+["']xrpl["']/);
      expect(text, file).not.toMatch(/from\s+["']ripple-binary-codec["']/);
      expect(text, file).not.toMatch(/require\(["']xrpl["']\)/);
    }
  });

  it("never calls the node's sign or admin methods", () => {
    for (const file of files) {
      const text = code(file);
      expect(text, file).not.toMatch(
        /request\(\s*["'](?:sign|sign_for|wallet_propose|ledger_accept)["']/,
      );
    }
  });

  it("holds no secret-looking constant", () => {
    for (const file of files) {
      const text = code(file);
      expect(text, file).not.toMatch(/\bs[1-9A-HJ-NP-Za-km-z]{28,}\b/); // a family seed
    }
  });
});

describe("check of the static output", () => {
  function site(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "carbs-static-"));
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    return dir;
  }
  const policy =
    "Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' wss://node.example.org";
  const page =
    '<html><head><script type="module" src="/_nuxt/a.js"></script><link rel="icon" href="/favicon.svg"></head><body><script type="application/json" id="d">{}</script><script src="/_carbs/inline/x.js"></script></body></html>';

  it("accepts a clean site", () => {
    const dir = site({ "index.html": page, _headers: `/*\n  ${policy}\n` });
    try {
      expect(checkStaticOutput(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags an inline script, a third-party origin, a weak policy and a missing header file", () => {
    const dir = site({
      "index.html":
        '<script>alert(1)</script><script src="https://cdn.example.org/x.js"></script><link href="//fonts.example.org/f.css">',
      _headers:
        "/*\n  Content-Security-Policy: script-src 'self' 'unsafe-inline'; connect-src https:\n",
    });
    const noHeaders = site({ "index.html": page });
    try {
      const found = checkStaticOutput(dir).join("\n");
      expect(found).toContain("an inline script");
      expect(found).toContain("https://cdn.example.org/x.js");
      expect(found).toContain("//fonts.example.org/f.css");
      expect(found).toContain("unsafe-inline");
      expect(found).toContain("bare scheme");
      expect(checkStaticOutput(noHeaders).join("\n")).toContain("_headers: missing");
      expect(checkStaticOutput(join(dir, "nope"))[0]).toContain("no static output");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(noHeaders, { recursive: true, force: true });
    }
  });
});
