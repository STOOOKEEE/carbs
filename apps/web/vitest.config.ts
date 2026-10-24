import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

// Component and unit tests for the screens and the simulated backend. They run without
// Nuxt: screens import what they use explicitly and read the backend by injection.
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "~": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "happy-dom",
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
  },
});
