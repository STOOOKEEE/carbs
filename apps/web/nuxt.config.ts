import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractEmbeddedScripts } from "./server/utils/inline-scripts";

// https://nuxt.com/docs/api/configuration/nuxt-config
const POLICY_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss: https:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
];
const CONTENT_SECURITY_POLICY = POLICY_DIRECTIVES.join("; ");
// Fallback for hosts that cannot set headers; a meta policy ignores frame-ancestors, so it is left out.
const META_POLICY = POLICY_DIRECTIVES.filter((d) => !d.startsWith("frame-ancestors")).join("; ");

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: false },

  modules: ["@nuxt/eslint", "@nuxtjs/tailwindcss"],

  // Components in subfolders keep their plain names (<SimBadge>, not <UiSimBadge>).
  components: [{ path: "~/components", pathPrefix: false }],

  css: ["~/assets/tokens.css", "~/assets/css/main.css"],

  app: {
    head: {
      title: "carbs",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        // The dev server needs inline HMR code, so the meta fallback is production only.
        ...(process.env.NODE_ENV === "production"
          ? [{ "http-equiv": "Content-Security-Policy", content: META_POLICY }]
          : []),
        {
          name: "description",
          content:
            "Ledger-enforced signing sessions and a quantum exposure check for the XRP Ledger",
        },
      ],
    },
  },

  runtimeConfig: {
    public: {
      defaultNetwork: "testnet",
      xamanApiKey: "",
      walletConnectProjectId: "",
    },
  },

  // Vite configuration for polyfills (similar to next.config.js webpack config)
  vite: {
    resolve: {
      alias: {
        buffer: "buffer/",
        events: "events/",
        stream: "stream-browserify",
      },
    },
    define: {
      "process.env": {},
      global: "globalThis",
    },
    optimizeDeps: {
      include: ["buffer", "events", "process"],
      esbuildOptions: {
        define: {
          global: "globalThis",
        },
      },
    },
    build: {
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
  },

  // Content-Security-Policy: scripts only from this origin, no inline script (the
  // server plugin externalize-inline-scripts moves Nuxt's runtime config into a file).
  // Fonts and assets are self-hosted. connect-src allows the node and the explorers.
  routeRules: {
    "/**": {
      headers: {
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    },
  },

  // Static output (`nuxt generate`): write the externalized inline scripts next to the pages.
  nitro: {
    hooks: {
      "prerender:generate"(route, nitro) {
        if (typeof route.contents !== "string") return;
        const { html, files } = extractEmbeddedScripts(route.contents);
        if (files.length === 0) return;
        route.contents = html;
        const dir = join(nitro.options.output.publicDir, "_carbs", "inline");
        mkdirSync(dir, { recursive: true });
        for (const file of files) writeFileSync(join(dir, file.name), file.body);
      },
    },
  },

  // Keep the starter as a client-rendered Nuxt app while wallet adapters initialize.
  ssr: false,

  typescript: {
    strict: true,
  },
});
