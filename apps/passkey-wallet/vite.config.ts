// Every top-level page is an entry: the wallet (index.html), the stage demo of the AI agent
// (demo.html) and one page per session use case (game.html, dex.html, ...).

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PAGE_SUFFIX = ".html";

const pages = Object.fromEntries(
  readdirSync(ROOT)
    .filter((name) => name.endsWith(PAGE_SUFFIX))
    .map((name) => [name.slice(0, -PAGE_SUFFIX.length), `${ROOT}${name}`]),
);

export default defineConfig({
  build: {
    rolldownOptions: {
      input: pages,
    },
  },
});
