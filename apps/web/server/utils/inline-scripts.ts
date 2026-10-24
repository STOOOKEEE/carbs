import { createHash } from "node:crypto";

/**
 * Inline scripts moved out of the HTML so that the page runs under a
 * Content-Security-Policy of `script-src 'self'` (no 'unsafe-inline', no hash).
 * Nuxt writes its runtime config as an inline `<script>` in the SPA shell; the
 * Nitro plugin `externalize-inline-scripts` replaces it with a same-origin file
 * served by `routes/_carbs/inline/[file].ts`.
 */
const scripts = new Map<string, string>();

/** Store a script body and return the file name it is served under. */
export function storeInlineScript(body: string): string {
  const id = createHash("sha256").update(body).digest("hex").slice(0, 32);
  scripts.set(id, body);
  return `${id}.js`;
}

/** The script body for a file name returned by `storeInlineScript`. */
export function loadInlineScript(file: string): string | undefined {
  const match = /^([0-9a-f]{32})\.js$/.exec(file);
  return match?.[1] === undefined ? undefined : scripts.get(match[1]);
}

const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/g;

/** Replace every executable inline `<script>` of an HTML chunk by a same-origin one. */
export function externalizeInlineScripts(chunk: string): string {
  return chunk.replace(INLINE_SCRIPT, (_tag, body: string) => {
    return `<script src="/_carbs/inline/${storeInlineScript(body)}"></script>`;
  });
}
