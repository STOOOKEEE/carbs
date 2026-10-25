# apps/web

The carbs web app: five screens (Account, Session, Actions, Attack, Quantum) over the signing sessions and the quantum exposure check (`FIANSO-SPEC.md` sections 8.5 and 8.7). Nuxt 3 (Vue 3, TypeScript strict), client-rendered (`ssr: false`), generated from the `create-xrp` template (see `UPSTREAM.md`; credit to XRPL Commons' scaffold-xrp).

## Run it

```sh
pnpm install
pnpm --filter web dev            # http://localhost:3000 (Chrome, Edge or Brave for the real Stax over WebHID)
pnpm --filter web typecheck
pnpm --filter web test           # node tests and component tests (vitest, happy-dom)
XRPLD_BIN=… GENESIS_SEED=… pnpm demo   # the standalone node, its closer, a dev faucet and this app on the live backend
pnpm --filter web generate       # static site in apps/web/.output/public (see docs/DEPLOY.md)
```

## What is real and what is SIMULATED

The app runs on one of two backends behind the same small interfaces (`lib/ports.ts`: `NodePort`, `DevicePort`, `WalletPort`, `ExposurePort`, `TxBuilders`). The default is the **simulation** (`lib/sim/*`); with `pnpm demo` (or the header's Backend switch) it runs on a **live** node (`lib/live/*`). A striped **SIMULATED** badge marks every result or screen that comes from the simulation, including, on the live backend, the Ledger device.

| Piece                                      | Simulated backend (default)                                                                                    | Live backend                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node (submit, account state, sessions)     | `lib/sim/node.ts`: follows spec 6.5 and 6.13 in order, answers the `tefSESSION_*` refusals; no real signatures | the standalone node with the amendment, through `@carbs/sessions` with the definitions of its `server_definitions` (`lib/live/node.ts`)                                                                                    |
| Ledger Stax                                | `lib/sim/device.ts`: the screen lines of spec 7.3                                                              | the person's choice (`lib/live/device-selection.ts`): the SIMULATED software double of `@carbs/ledger` (`lib/live/device.ts`, default) or a real Stax over USB, `connectLedger()` on a click (`lib/live/ledger-device.ts`) |
| Wallet (master key, passkey, session keys) | `lib/sim/wallet.ts`: the software authenticator (real P-256, no prompt), keyed digests instead of signatures   | real keys: secp256k1 master, the browser's WebAuthn passkey (the software authenticator in tests), P-256 or ML-DSA-44 session keys                                                                                         |
| Exposure check                             | `lib/sim/exposure.ts` over the simulated history                                                               | `checkExposure` of `@carbs/sessions` on the AlphaNet and mainnet (read-only), the Quantum screen's default                                                                                                                 |
| Quantum migration                          | the simulated node and Stax                                                                                    | a fresh AlphaNet account, signed in the page, validated, with explorer links; on the chosen device (on a real Stax, step 3 needs the ML-DSA-44 key read again after reinstalling the XRP app)                              |

`lib/sim/node.test.ts` checks the simulation against the cases of spec 6.15; it proves that the simulation follows the spec and nothing about rippled. The live backend was run against the standalone node in modes A, P and C (see `docs/DEVLOG.md`); the component tests run it against a test double of the node.

## Wallet entry

The header's **Connect wallet** lists three adapters, written against the `WalletAdapter` interface of xrpl-connect 1.0.0 (`lib/wallets/adapters.ts`) and nothing else: **Ledger Stax** (post-quantum root, Device Management Kit only; SIMULATED unless a real Stax is connected over USB on the live backend), **Passkey (this Mac)** (the browser's WebAuthn when you press Connect; the software authenticator of `@carbs/sessions` in tests) and **Demo account** (SIMULATED, thrown away on reload). Each shows its key type, who signs what and a SIMULATED badge for the parts that are. No Xaman, WalletConnect or GemWallet adapter, no API key, no environment variable for a wallet. The legacy ledgerjs adapter of xrpl-connect is never imported (a test scans the sources).

On the simulated backend a passkey connected here is registered in the simulated node's passkey list and its WebAuthn assertion is verified there with real P-256; on the live backend the node verifies it.

## Art direction

All of the look lives in one file, **`assets/tokens.css`**. Nothing else in the app holds a colour, a size, a radius or a duration; change a value there and every screen follows (Tailwind reads the same variables, `tailwind.config.js`). Dark mode follows the system; force one with `data-theme="light"` or `"dark"` on `<html>`.

| Knob          | Tokens                                                                                                                                           | Effect                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palette       | `--color-surface`, `--color-surface-raised`, `--color-surface-sunken`, `--color-ink`, `--color-ink-muted`, `--color-line`, `--color-line-strong` | paper, panels, inputs, text, borders                                                                                                                                              |
| Accent        | `--color-accent`, `--color-accent-ink`                                                                                                           | primary buttons, links, focus ring, the spent bar                                                                                                                                 |
| Status        | `--color-ok`, `--color-warn`, `--color-danger`                                                                                                   | `tesSUCCESS`, held back or caution, a refusal by the node                                                                                                                         |
| Simulation    | `--color-sim`, `--color-sim-wash`                                                                                                                | the SIMULATED badge and frame only; do not reuse                                                                                                                                  |
| Device        | `--color-device`, `--color-device-ink`                                                                                                           | the (simulated) Stax screen                                                                                                                                                       |
| Type families | `--font-display`, `--font-sans`, `--font-mono`                                                                                                   | headings, body, addresses and codes (system stacks; to ship a font, put the file in `public/fonts` and add an `@font-face` in `tokens.css`, nothing is loaded from a third party) |
| Type scale    | `--text-xs` to `--text-3xl`, `--leading-tight`, `--leading-body`, `--tracking-caps`, `--weight-strong`                                           | sizes and rhythm                                                                                                                                                                  |
| Spacing       | `--space-1` to `--space-8`, `--content-width`                                                                                                    | the 4 px grid and the page width                                                                                                                                                  |
| Shape         | `--radius-sm`, `--radius-md`, `--radius-lg`, `--border-width`, `--shadow-panel`                                                                  | corners, borders, depth                                                                                                                                                           |
| Motion        | `--motion-fast`, `--motion-base`, `--motion-slow`, `--ease-out`                                                                                  | all transitions; `prefers-reduced-motion` sets them to 0                                                                                                                          |

The reusable shapes (`.panel`, `.btn`, `.chip`, `.sim-badge`, `.kv`, `.field`) are defined once in `assets/css/main.css` from those tokens.

## Layout

```text
assets/tokens.css        design tokens (the look)
assets/css/main.css      base styles and the few shared classes
components/screens/      the five screens, one component each, with their tests
components/ui/           SIMULATED badge, result view, device modal, headers
lib/ports.ts             Node, Device, Wallet, Exposure interfaces
lib/sim/                 the simulated implementations and their tests
lib/demo.ts, migration.ts  the stores behind the screens (state is read back from the node)
layouts/, pages/         Nuxt routing: /, /account, /session, /actions, /attack, /quantum
lib/wallets/             the three wallet adapters, the passkey and the wallet entry's logic
lib/networks.ts, csp.ts  AlphaNet, Local node, Mainnet (read-only); the CSP is built from them
server/                  Nitro: moves the inline config script into a file (CSP script-src 'self')
```

## Security headers

The page loads no third-party script, font or image. `nuxt.config.ts` sets a Content-Security-Policy with `script-src 'self'` (no `unsafe-inline`, no hash); Nuxt's inline runtime-config script is replaced by a same-origin file, in the dev server, the Node server and the static build. See `docs/DEPLOY.md`.
