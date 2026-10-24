# Deploying the web app

`apps/web` is a client-rendered single-page app (`ssr: false`). `pnpm --filter web generate` writes a **static site** to `apps/web/.output/public`; any static host serves it. **Nothing here has been deployed**: publishing and credentials are the owner's (see the end of this file).

## Build and check locally

```sh
pnpm install --frozen-lockfile
pnpm --filter web generate              # apps/web/.output/public
pnpm dlx serve apps/web/.output/public  # open the printed URL: all five screens, SIMULATED badge visible
```

The static build contains `_carbs/inline/<hash>.js`, the file that holds Nuxt's runtime config (Nuxt writes it as an inline script, which `script-src 'self'` forbids). It is written during `generate` and referenced by every page, so keep it when you copy the output.

## One command per host

| Host    | Command (from the repository root, after `pnpm install`)                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| Vercel  | `pnpm dlx vercel deploy apps/web/.output/public --prod` (first run asks to log in and link a project)         |
| Netlify | `pnpm dlx netlify-cli deploy --dir apps/web/.output/public --prod` (first run asks to log in and pick a site) |

Or let the host build: root directory `apps/web`, install command `pnpm install --frozen-lockfile` run at the repository root, build command `pnpm --filter web generate`, output directory `apps/web/.output/public`.

## Networks

| Network                              | Used for                                                            | Node                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AlphaNet (default, network id 24100) | the app's live backend, the Quantum migration                       | `wss://alphanet.xrpl.org`, `https://rpc.alphanet.xrpl.org`, faucet `https://faucet.alphanet.xrpl.org/accounts`, explorer `https://alphanet.xrpl.org` |
| Local node                           | the standalone node of `infra/` with the amendment                  | `NUXT_PUBLIC_LOCAL_NODE_URL`, default `ws://localhost:6006`                                                                                          |
| Mainnet (read-only)                  | the Quantum screen's exposure check only; nothing is ever submitted | `wss://xrplcluster.com`, explorer `https://livenet.xrpl.org`                                                                                         |

Explorer links for the app's transactions point at the explorer of the selected network.

## A hosted site and the node: https needs wss

A page served over **https** cannot call a `ws://` or `http://` node: the browser blocks it as mixed content. The node setting of the app therefore accepts only `wss://` and `https://` URLs when the page is https, and says so next to the field. To use our own node from a hosted site, put it behind TLS (a reverse proxy that terminates `wss://` and `https://`) and set `NUXT_PUBLIC_LOCAL_NODE_URL` at build time. The policy below lists the hosts of the configured networks, so a changed URL is part of the build.

## Wallets

The wallet entry offers a Ledger Stax, a passkey on this Mac and a demo account, with no API key and no third-party service. A passkey needs a secure context: `https://` or `http://localhost`. Over plain `http://` on a LAN address the browser exposes no WebAuthn and the entry says so.

## The Mac account demo needs our own node

A passkey signs with WebAuthn, and the public AlphaNet's validators may refuse such a transaction until they carry the WebAuthn challenge fix (`fixPasskeyChallenge`, `infra/README.md`): where `char` is signed, the challenge comparison of the imported tree fails for any byte at or above 0x80. The Mac account demo against the real node therefore needs **our own node**, started from `infra/standalone.cfg`, which enables the fix. The Ledger account does not use a passkey.

## Browsers

The Ledger path uses WebHID. **Use Chrome.** Brave and Firefox may not expose `navigator.hid`; the Account screen says so when it is missing. The simulated Stax works in any browser; the real one does not.

## Security headers (set them at the host)

| Header                    | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss://alphanet.xrpl.org https://rpc.alphanet.xrpl.org https://faucet.alphanet.xrpl.org https://alphanet.xrpl.org ws://localhost:6006 http://localhost:5005 http://localhost:3005 wss://xrplcluster.com https://xrplcluster.com https://livenet.xrpl.org; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` |
| `Referrer-Policy`         | `no-referrer`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `X-Content-Type-Options`  | `nosniff`                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`script-src 'self'` and no third-party script are the point; `connect-src` lists hosts, never a bare scheme or a wildcard (a test fails otherwise). The policy is built from the networks in `apps/web/lib/networks.ts` by `apps/web/lib/csp.ts`. The host's own config file is generated from it:

- Vercel: `apps/web/vercel.json` (committed; a test fails if it drifts; rewrite it with `UPDATE_HOST_FILES=1 pnpm --filter web exec vitest run lib/csp.test.ts`)
- Netlify: `_headers`, written into the output by `pnpm --filter web generate`

A `<meta http-equiv="Content-Security-Policy">` fallback is added to the production build for hosts that cannot set headers. A meta policy cannot carry `frame-ancestors` (browsers ignore it there), so the header remains the real protection.

`style-src` keeps `'unsafe-inline'` because Vue writes style attributes (the spent bar); the rule of this project is about scripts.

## Environment variables

| Variable                       | Default                          | Meaning                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_BACKEND`          | empty (simulated)                | `live` runs Session, Actions and Attack on the local node; the page falls back to the simulation, with the reason in the header, if the node cannot be used. A person can also pick it in the header (saved in the browser) |
| `NUXT_PUBLIC_LOCAL_NODE_URL`   | `ws://localhost:6006`            | public WebSocket of the node behind the "Local node" network; `wss://` when the site is https                                                                                                                               |
| `NUXT_PUBLIC_LOCAL_FAUCET_URL` | `http://localhost:3005/accounts` | the dev faucet that funds fresh accounts on the local node (started by `pnpm demo`; the browser never holds the genesis key)                                                                                                |

The simulated backend needs nothing else. There is no API key anywhere.

## Which screens work without our node

| Screen                            | Without a node with the amendment                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quantum                           | works against the simulated history today; with the live backend it reads **mainnet read-only** and migrates on the **AlphaNet** with a fresh account |
| Account, Session, Actions, Attack | need a node that carries the `SigningSessions` amendment; until one is hosted they run in **SIMULATED** mode and the badge stays visible              |

## For the owner (human-only)

- Creating the account on a host, logging in, linking the project, the domain and the DNS.
- Any credential or token of a host. None is in the repository.
