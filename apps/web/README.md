# apps/web

The carbs web app: five screens (Account, Session, Actions, Attack, Quantum) over the signing sessions and the quantum exposure check (`FIANSO-SPEC.md` sections 8.5 and 8.7). Nuxt 3 (Vue 3, TypeScript strict), client-rendered (`ssr: false`), generated from the `create-xrp` template (see `UPSTREAM.md`; credit to XRPL Commons' scaffold-xrp).

## Run it

```sh
pnpm install
pnpm --filter web dev            # http://localhost:3000
pnpm --filter web typecheck
pnpm --filter web test           # node tests and component tests (vitest, happy-dom)
pnpm --filter web generate       # static site in apps/web/.output/public (see docs/DEPLOY.md)
```

## What is real and what is SIMULATED

Today every node answer and every device screen comes from a **simulation** (`lib/sim/*`), and the interface says so: a striped **SIMULATED** badge sits wherever a result comes from it. The screens depend on small interfaces only (`lib/ports.ts`: `NodePort`, `DevicePort`, `WalletPort`, `ExposurePort`), so replacing the simulation by `packages/core`, `packages/ledger` and the real node changes the backend, not the screens.

| Piece                                      | Now                                                                                                            | Replaced by                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Node (submit, account state, sessions)     | `lib/sim/node.ts`: follows spec 6.5 and 6.13 in order, answers the `tefSESSION_*` refusals, no real signatures | the standalone node with the amendment, through `packages/core`    |
| Ledger Stax                                | `lib/sim/device.ts`: the screen lines of spec 7.3                                                              | `packages/ledger` on the Device Management Kit and the real device |
| Wallet (master key, passkey, session keys) | `lib/sim/wallet.ts`: no WebAuthn prompt, no WebCrypto                                                          | `packages/core` keys                                               |
| Exposure check                             | `lib/sim/exposure.ts` over the simulated history                                                               | `checkExposure` of `packages/core`                                 |

`lib/sim/node.test.ts` checks the simulation against the cases of spec 6.15; it proves that the simulation follows the spec and nothing about rippled.

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
server/                  Nitro: moves the inline config script into a file (CSP script-src 'self')
```

## Security headers

The page loads no third-party script, font or image. `nuxt.config.ts` sets a Content-Security-Policy with `script-src 'self'` (no `unsafe-inline`, no hash); Nuxt's inline runtime-config script is replaced by a same-origin file, in the dev server, the Node server and the static build. See `docs/DEPLOY.md`.
