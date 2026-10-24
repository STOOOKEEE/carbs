# 0007. The web app starts from the `create-xrp` Nuxt template

**Status:** Proposed

**Context.** `npx create-xrp` (XRPL Commons' scaffold-xrp) generates a Next.js or Nuxt (Vue) app with `xrpl-connect`, a Testnet/Devnet selector and a payment form. It is a generator, not a repository to fork. It has no Ledger path.

**Decision (proposed).** Generate the Nuxt template into `apps/web`, record it in `UPSTREAM.md`, and add the Session, Actions and Attack screens. Wallet signing for our new transaction types does not go through Xaman or GemWallet (they do not know types 130 and 131); it goes through `packages/core` and `packages/ledger`. WebAuthn, WebHID and WebCrypto are client-only (`ssr: false`).

**Consequences.** Wallet connection and the payment form come for free, and the app builds on the organizers' own tooling. To be confirmed once the template is generated and run.
