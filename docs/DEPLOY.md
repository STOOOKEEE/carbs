# Deploying the web app

`apps/web` is a client-rendered single-page app (`ssr: false`). `pnpm --filter web generate` writes a **static site** to `apps/web/.output/public`; any static host serves it. **Deployed** at https://carbs-kappa.vercel.app (Vercel project `carbs`, the static output uploaded with `vercel deploy --prod` and `apps/web/vercel.json` copied next to it); publishing and credentials stay the owner's (see the end of this file).

## Build and check locally

```sh
pnpm install --frozen-lockfile
pnpm --filter web generate              # apps/web/.output/public
pnpm dlx serve apps/web/.output/public  # open the printed URL: the six screens, SIMULATED badge visible
```

`node apps/web/scripts/check-static.mjs apps/web/.output/public` (run by CI after `generate`) fails if the built site has an inline script, a script or link to another origin, a `script-src` other than `'self'`, or a `connect-src` with a wildcard or a bare scheme.

The Nitro runtime (`nuxt dev`, or the Node server of `nuxt build`) keeps the externalized script in memory of its process, so a **multi-instance or serverless deployment of the Node server** would answer 404 for it from another instance. Use the static output (below), which writes the file next to the pages.

The static build contains `_carbs/inline/<hash>.js`, the file that holds Nuxt's runtime config (Nuxt writes it as an inline script, which `script-src 'self'` forbids). It is written during `generate` and referenced by every page, so keep it when you copy the output.

## One command per host

| Host    | Command (from the repository root, after `pnpm install`)                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| Vercel  | `pnpm dlx vercel deploy apps/web/.output/public --prod` (first run asks to log in and link a project)         |
| Netlify | `pnpm dlx netlify-cli deploy --dir apps/web/.output/public --prod` (first run asks to log in and pick a site) |

Or let the host build: root directory `apps/web`, install command `pnpm install --frozen-lockfile` run at the repository root, build command `pnpm --filter web generate`, output directory `apps/web/.output/public`.

## Networks

| Network                     | Used for                                                                                                                   | Node                                                                                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AlphaNet (network id 24100) | the Quantum screen's live reads and migration; the public AlphaNet does not carry our amendment                            | `wss://alphanet.xrpl.org`, `https://rpc.alphanet.xrpl.org`, faucet `https://faucet.alphanet.xrpl.org/accounts`, explorer `https://custom.xrpl.org/alphanet.xrpl.org` (the XRPL Explorer in custom-network mode; the AlphaNet host itself answers 403 to a browser) |
| Local node                  | the header's Node > Local node: the standalone node of `infra/` with the amendment, on the visitor's machine (`pnpm demo`) | `NUXT_PUBLIC_LOCAL_NODE_URL`, default `ws://localhost:6006`, faucet `NUXT_PUBLIC_LOCAL_FAUCET_URL`, default `http://localhost:3005/accounts` (its HTTP port is the admin RPC and is not in the policy)                                                             |
| Team node                   | the header's Node > Team node: the same node on the team's server, behind TLS, on the team's tailnet                       | `NUXT_PUBLIC_TEAM_NODE_URL`, default `wss://debian-docker.tail8b5861.ts.net:9448`, faucet `NUXT_PUBLIC_TEAM_FAUCET_URL`, default `https://debian-docker.tail8b5861.ts.net:9449/api/faucet` (the wallet server's faucet, which answers CORS for `WEB_ORIGINS`)      |
| Mainnet (read-only)         | the Quantum screen's exposure check only; nothing is ever submitted                                                        | `wss://xrplcluster.com`, explorer `https://livenet.xrpl.org`                                                                                                                                                                                                       |

Account addresses and transaction hashes link to the explorer of the network they live on (for a transaction, the node it was sent to), in a new tab: `<explorer>/accounts/<address>` and `<explorer>/transactions/<hash>`. The local node has no public explorer and a SIMULATED value is on none, so those stay plain text, as does a transaction no validated ledger holds. The public AlphaNet keeps only recent history (`complete_ledgers` 240005 onward on 2026-10-25), so the link of an older transaction opens the explorer's "not found" page; account pages always work. Links are navigation: the explorers are not in `connect-src`.

## A hosted site and the node: https needs wss, except on localhost

A page served over **https** cannot call a `ws://` or `http://` node on another host: the browser blocks it as mixed content. Chrome and Firefox treat `localhost`, `127.0.0.1` and `[::1]` as potentially trustworthy, so in those browsers the hosted page can reach `ws://localhost:6006` and `http://localhost:3005` on the visitor's own machine (Safari was not checked). The app accepts `wss://` and `https://` everywhere, and `ws://` and `http://` on the loopback only (`checkNodeUrl`, tested). Chrome may ask the visitor to let the site reach the local network; the Local node dialog says so. The dev faucet answers only the pages it is told about: the dialog's command adds `--web-origin <the page's origin>` when the page is not the local dev server, and the faucet answers Chrome's Private Network Access preflight for those origins.

To use a node of ours on another host, put it behind TLS (a reverse proxy that terminates `wss://` and `https://`), as the team node is, and set its URL at build time. The policy below lists the hosts of the configured networks, so a changed URL is part of the build; a custom URL typed in the Local node dialog works on the dev server (whose policy allows `ws://localhost:*`) but not on the hosted page unless it is one of those hosts.

## Wallets

The wallet entry offers a Ledger Stax, a passkey on this Mac and a demo account, with no API key and no third-party service. A passkey needs a secure context: `https://` or `http://localhost`. Over plain `http://` on a LAN address the browser exposes no WebAuthn and the entry says so.

## The Mac account demo needs our own node

A passkey signs with WebAuthn, and the public AlphaNet's validators may refuse such a transaction until they carry the WebAuthn challenge fix (`fixPasskeyChallenge`, `infra/README.md`): where `char` is signed, the challenge comparison of the imported tree fails for any byte at or above 0x80. The Mac account demo against the real node therefore needs **our own node**, started from `infra/standalone.cfg`, which enables the fix. The Ledger account does not use a passkey.

## Browsers

The Ledger path uses WebHID. **Use Chrome.** Brave and Firefox may not expose `navigator.hid`; the Account screen says so when it is missing. The default device is the SIMULATED one, which works in any browser; a real Stax over USB is picked on a click (Device Management Kit, `connectLedger`).

## Security headers (set them at the host)

| Header                    | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss://alphanet.xrpl.org https://rpc.alphanet.xrpl.org https://faucet.alphanet.xrpl.org ws://localhost:6006 http://localhost:3005 wss://debian-docker.tail8b5861.ts.net:9448 https://debian-docker.tail8b5861.ts.net:9449 wss://xrplcluster.com https://xrplcluster.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `Referrer-Policy`         | `no-referrer`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `X-Content-Type-Options`  | `nosniff`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

`script-src 'self'` and no third-party script are the point; `connect-src` lists hosts, never a bare scheme or a wildcard (a test fails otherwise). The policy is built from the networks in `apps/web/lib/networks.ts` (their nodes and faucets; the explorers and the team's apps are only linked to) by `apps/web/lib/csp.ts`. The host's own config file is generated from it:

- Vercel: `apps/web/vercel.json` (committed; a test fails if it drifts; rewrite it with `UPDATE_HOST_FILES=1 pnpm --filter web exec vitest run lib/csp.test.ts`)
- Netlify: `_headers`, written into the output by `pnpm --filter web generate`

A `<meta http-equiv="Content-Security-Policy">` fallback is added to the production build for hosts that cannot set headers. A meta policy cannot carry `frame-ancestors` (browsers ignore it there), so the header remains the real protection.

`style-src` keeps `'unsafe-inline'` because Vue writes style attributes (the spent bar); the rule of this project is about scripts.

## Environment variables

| Variable                       | Default                                                   | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_BACKEND`          | empty (simulated)                                         | the header's Node for a visitor who has not picked one: `local` or `team` (`live`, its former value, means `local`). The page falls back to the simulation, with the reason in the header, if the node cannot be used. A visitor's own pick is saved in the browser and wins. Leave it empty for a public site: with `team` and the team node down, every load of a visitor who has not picked Simulated waits up to 8 s for it |
| `NUXT_PUBLIC_LOCAL_NODE_URL`   | `ws://localhost:6006`                                     | public WebSocket of the node behind Node > Local node, on the visitor's machine; `ws://` works from an https page on the loopback only, `wss://` elsewhere                                                                                                                                                                                                                                                                      |
| `NUXT_PUBLIC_LOCAL_FAUCET_URL` | `http://localhost:3005/accounts`                          | the dev faucet that funds fresh accounts on the local node (started by `pnpm demo`; the browser never holds the genesis key)                                                                                                                                                                                                                                                                                                    |
| `NUXT_PUBLIC_TEAM_NODE_URL`    | `wss://debian-docker.tail8b5861.ts.net:9448`              | public WebSocket of the node behind Node > Team node (the team's server, on its tailnet), in the policy's `connect-src`                                                                                                                                                                                                                                                                                                         |
| `NUXT_PUBLIC_TEAM_FAUCET_URL`  | `https://debian-docker.tail8b5861.ts.net:9449/api/faucet` | the team's faucet (the wallet server's `/api/faucet`, which must list the site in `WEB_ORIGINS`), in the policy's `connect-src`                                                                                                                                                                                                                                                                                                 |
| `NUXT_PUBLIC_APPS_URL`         | `https://debian-docker.tail8b5861.ts.net:9449`            | the team's wallet server (`apps/passkey-wallet`, port 9449 of `infra/compose.yaml`) whose pages the Apps screen links to, in a new tab; reachable on the team's tailnet only. Navigation only: the Apps screen fetches nothing from it (its origin is in `connect-src` for the Team node's faucet only). A value that is not a plain `http(s)` URL shows no link                                                                |

The simulated backend needs nothing else. There is no API key anywhere.

## Which screens work without our node

| Screen                            | Without a node with the amendment                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quantum                           | works against the simulated history today; with the live backend it reads **mainnet read-only** and migrates on the **AlphaNet** with a fresh account                                                                  |
| Account, Session, Actions, Attack | need a node that carries the `SigningSessions` amendment: the visitor's own (Node > Local node) or the team's (Node > Team node, on the tailnet); otherwise they run in **SIMULATED** mode and the badge stays visible |
| Apps                              | links only: the six apps run on the team's own node and wallet server (`NUXT_PUBLIC_APPS_URL`) and open only where that host is reachable                                                                              |

## Running the node and the app together (local)

`pnpm demo` starts, on this machine, the standalone node of `infra/standalone.cfg` (`XRPLD_BIN`, a build with the SigningSessions amendment), its ledger closer, a dev faucet that holds the genesis key (`GENESIS_SEED`, read from the environment, never written, and not passed to the node, the closer or the web app's dev server; the faucet funds at most 10 accounts per origin per minute) and the web app on the local node. It is not a deployment: nothing is exposed beyond the loopback. With `--no-web` it leaves the web app out, so the hosted site can use this node (Node > Local node); add `--web-origin https://carbs-kappa.vercel.app` (the Local node dialog prints the command with the page's origin) so the dev faucet answers that page. A node on another host needs its own TLS (see "A hosted site and the node").

## For the owner (human-only)

- Creating the account on a host, logging in, linking the project, the domain and the DNS.
- Any credential or token of a host. None is in the repository.
