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

## Security headers (set them at the host)

| Header                    | Value                                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` |
| `Referrer-Policy`         | `no-referrer`                                                                                                                                                                                                    |
| `X-Content-Type-Options`  | `nosniff`                                                                                                                                                                                                        |

`script-src 'self'` and no third-party script are the point. Both are in the host's own config file, committed:

- Vercel: `apps/web/vercel.json`
- Netlify: `apps/web/public/_headers` (copied into the output by `generate`)

A `<meta http-equiv="Content-Security-Policy">` fallback is added to the production build for hosts that cannot set headers. A meta policy cannot carry `frame-ancestors` (browsers ignore it there), so the header remains the real protection.

`style-src` keeps `'unsafe-inline'` because Vue writes style attributes (the spent bar); the rule of this project is about scripts.

## Environment variables

None are required. The simulated backend needs nothing.

## Which screens work without our node

| Screen                            | Without a node with the amendment                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quantum                           | works against the simulated history today; with the live backend it reads **mainnet read-only** and migrates on the **AlphaNet** with a fresh account |
| Account, Session, Actions, Attack | need a node that carries the `SigningSessions` amendment; until one is hosted they run in **SIMULATED** mode and the badge stays visible              |

## For the owner (human-only)

- Creating the account on a host, logging in, linking the project, the domain and the DNS.
- Any credential or token of a host. None is in the repository.
