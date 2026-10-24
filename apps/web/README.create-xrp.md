# web

Build an XRP Ledger dApp with Nuxt and Scaffold-XRP.

Requires Node.js `^22.18.0 || >=24.11.0`.

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The starter includes wallet connection, account details, a Testnet/Devnet selector, and an XRP payment form. Enter the amount in XRP, with up to six decimal places; the form converts it to drops exactly. If the recipient requires a destination tag, enter it in the optional tag field.

## Scripts

- `pnpm dev` - start the development server
- `pnpm build` - create a production build
- `pnpm generate` - generate a static site
- `pnpm preview` - preview the production build
- `pnpm lint` - run the linter
- `pnpm type-check` - check TypeScript and Vue types
- `pnpm test` - run payment regression tests

## Wallets and environment

The wallet header supports Xaman, GemWallet, and WalletConnect. Xaman uses `NUXT_PUBLIC_XAMAN_API_KEY`; WalletConnect uses `NUXT_PUBLIC_WALLETCONNECT_PROJECT_ID`; GemWallet requires its browser extension and does not require an API key.

The generated examples use these files:

- Network and wallet settings: `.env.example` (`NUXT_PUBLIC_DEFAULT_NETWORK=testnet` or `devnet`).
- Wallet settings: `.env.local.example` (`NUXT_PUBLIC_XAMAN_API_KEY` and `NUXT_PUBLIC_WALLETCONNECT_PROJECT_ID`).
- Runtime environment: `.env` (Nuxt reads `.env` while running.)

Copy the example, then edit the runtime file:

```bash
cp .env.example .env
```

```dotenv
NUXT_PUBLIC_DEFAULT_NETWORK=testnet
NUXT_PUBLIC_XAMAN_API_KEY=your_xaman_api_key_here
NUXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id_here
```

Testnet is the default; Devnet is also available. Fund your wallet using the [XRPL test faucets](https://xrpl.org/resources/dev-tools/xrp-faucets) and confirm the network before signing. These environment variables are public browser configuration. Never put API secrets or wallet seeds in them. Restart the development server after editing the environment file.

Advanced contract features are omitted from this starter. Re-run create-xrp with --experimental and --primitives to include them.

## Project structure

- `./` - Nuxt application
- `.scaffold-xrp.json` - generated framework and feature metadata
