import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCsp, buildMetaCsp, netlifyHeaders, securityHeaders } from "./lib/csp";
import {
  DEFAULT_LOCAL_FAUCET,
  DEFAULT_LOCAL_WSS,
  allConnectOrigins,
  createNetworks,
  localRpcFor,
} from "./lib/networks";
import { extractEmbeddedScripts } from "./server/utils/inline-scripts";

// https://nuxt.com/docs/api/configuration/nuxt-config
const isProduction = process.env.NODE_ENV === "production";
const localWss = (process.env.NUXT_PUBLIC_LOCAL_NODE_URL ?? "").trim() || DEFAULT_LOCAL_WSS;
const localFaucet = (process.env.NUXT_PUBLIC_LOCAL_FAUCET_URL ?? "").trim() || DEFAULT_LOCAL_FAUCET;
const networks = createNetworks({ wss: localWss, rpc: localRpcFor(localWss), faucet: localFaucet });
// The policy lists the hosts of the configured networks and explorers, no bare scheme.
const cspOptions = { connectOrigins: allConnectOrigins(networks), dev: !isProduction };
const CONTENT_SECURITY_POLICY = buildCsp(cspOptions);
const HEADERS = securityHeaders(buildCsp({ ...cspOptions, dev: false }));

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
      link: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        // The dev server needs inline HMR code, so the meta fallback is production only.
        ...(isProduction
          ? [{ "http-equiv": "Content-Security-Policy", content: buildMetaCsp(cspOptions) }]
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
      defaultNetwork: "alphanet",
      // Public WebSocket of the standalone node (infra/standalone.cfg); wss:// when hosted.
      // "live" runs Session, Actions and Attack on the local node; "" or "simulated" on the simulation.
      backend: "",
      localNodeUrl: "",
      // The dev faucet of the local node (started by `pnpm demo`).
      localFaucetUrl: "",
      // The team's wallet server behind the Apps screen; "" is its tailnet host (lib/live-apps.ts).
      // Only linked to, never fetched: it is not in connect-src.
      appsUrl: "",
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
      headers: { ...HEADERS, "Content-Security-Policy": CONTENT_SECURITY_POLICY },
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
      // Netlify reads headers from this file in the output, built from the same policy.
      compiled(nitro) {
        writeFileSync(join(nitro.options.output.publicDir, "_headers"), netlifyHeaders(HEADERS));
      },
    },
  },

  // Keep the starter as a client-rendered Nuxt app while wallet adapters initialize.
  ssr: false,

  typescript: {
    strict: true,
  },
});
