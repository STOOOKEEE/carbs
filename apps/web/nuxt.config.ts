// https://nuxt.com/docs/api/configuration/nuxt-config
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss: https:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: false },

  modules: ["@nuxt/eslint", "@nuxtjs/tailwindcss"],

  css: ["~/assets/css/main.css"],

  app: {
    head: {
      title: "Scaffold-XRP",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "description", content: "A starter kit for building XRP Ledger dApps" },
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

  // Keep the starter as a client-rendered Nuxt app while wallet adapters initialize.
  ssr: false,

  typescript: {
    strict: true,
  },
});
