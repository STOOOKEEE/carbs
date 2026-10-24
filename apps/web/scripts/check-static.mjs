// Checks the static site that `nuxt generate` wrote: it must run under script-src 'self'.
//   node scripts/check-static.mjs [dir]      (default: .output/public)
// Exit code 1 and one line per violation otherwise.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const JSON_TYPES = /type\s*=\s*["']application\/json["']/i;
const ATTR = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "_nuxt" ? [] : htmlFiles(path);
    return path.endsWith(".html") ? [path] : [];
  });
}

/** Violations of the static output of `dir`. */
export function checkStaticOutput(dir) {
  const violations = [];
  if (!existsSync(dir)) return [`${dir}: no static output (run \`pnpm --filter web generate\`)`];
  for (const file of htmlFiles(dir)) {
    const html = readFileSync(file, "utf8");
    const name = file.slice(dir.length + 1);
    for (const match of html.matchAll(SCRIPT)) {
      const [, attributes = "", body = ""] = match;
      if (JSON_TYPES.test(attributes)) continue; // data, not executable
      if (!/\bsrc\s*=/.test(attributes)) {
        violations.push(`${name}: an inline script (script-src 'self' forbids it)`);
      } else if (body.trim() !== "") {
        violations.push(`${name}: a script with a src and a body`);
      }
    }
    for (const match of html.matchAll(ATTR)) {
      const url = match[1] ?? "";
      if (ABSOLUTE.test(url)) violations.push(`${name}: loads ${url} (a third-party origin)`);
    }
  }
  const headers = join(dir, "_headers");
  if (!existsSync(headers)) {
    violations.push("_headers: missing (the host's policy file)");
  } else {
    const text = readFileSync(headers, "utf8");
    const policy = /Content-Security-Policy:\s*(.*)/.exec(text)?.[1] ?? "";
    if (!/(^|;\s*)script-src 'self'(;|$)/.test(policy))
      violations.push("_headers: script-src is not 'self' alone");
    if (/script-src[^;]*unsafe-inline/.test(policy))
      violations.push("_headers: script-src allows unsafe-inline");
    if (/connect-src[^;]*(\*|\s(?:wss?|https?):(?:\s|;|$))/.test(policy)) {
      violations.push("_headers: connect-src has a wildcard or a bare scheme");
    }
  }
  return violations;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? ".output/public");
  const violations = checkStaticOutput(dir);
  if (violations.length > 0) {
    for (const line of violations) console.error(`check-static: ${line}`);
    process.exit(1);
  }
  console.log(`check-static: ${dir} is clean`);
}
