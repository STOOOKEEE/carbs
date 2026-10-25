import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

// The real-node runs (`pnpm --filter web live-run`): they need a node and are not in `pnpm test`.
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "~": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node", include: ["manual/**/*.manual.test.ts"], testTimeout: 600_000 },
});
