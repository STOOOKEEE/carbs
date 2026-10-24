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
const EMBEDDED_SCRIPT =
  /<script src="\/_carbs\/inline\/([0-9a-f]{32}\.js)" data-carbs-body="([A-Za-z0-9+/=]*)"><\/script>/g;

/**
 * Replace every executable inline `<script>` of an HTML chunk by a same-origin one.
 * With `embedBody` (prerender only) the body travels in a data attribute so that the
 * build can write the file next to the page; `extractEmbeddedScripts` removes it again.
 */
export function externalizeInlineScripts(chunk: string, embedBody = false): string {
  return chunk.replace(INLINE_SCRIPT, (_tag, body: string) => {
    const file = storeInlineScript(body);
    const data = embedBody ? ` data-carbs-body="${Buffer.from(body).toString("base64")}"` : "";
    return `<script src="/_carbs/inline/${file}"${data}></script>`;
  });
}

export interface ExtractedScripts {
  html: string;
  files: { name: string; body: string }[];
}

/** Build side of the static output: pull the embedded bodies out of a prerendered page. */
export function extractEmbeddedScripts(html: string): ExtractedScripts {
  const files: { name: string; body: string }[] = [];
  const clean = html.replace(EMBEDDED_SCRIPT, (_tag, name: string, encoded: string) => {
    files.push({ name, body: Buffer.from(encoded, "base64").toString("utf8") });
    return `<script src="/_carbs/inline/${name}"></script>`;
  });
  return { html: clean, files };
}
