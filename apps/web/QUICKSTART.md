# Quick start

Requires Node.js `^22.18.0 || >=24.11.0`.

Install dependencies and start the Nuxt app:

```bash
pnpm install
pnpm dev
```

Configure `.env` with `NUXT_PUBLIC_DEFAULT_NETWORK`, `NUXT_PUBLIC_XAMAN_API_KEY`, and `NUXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Xaman and WalletConnect need their public app identifiers; GemWallet works through its browser extension. Use test funds on XRPL Testnet or Devnet, and verify the destination, amount in XRP, and optional destination tag before signing.

This project contains only conventional XRP Ledger starter functionality.
