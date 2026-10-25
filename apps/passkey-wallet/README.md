# apps/passkey-wallet

Proof of concept: an XRPL wallet whose transactions are signed by a WebAuthn passkey (Touch ID, Face ID), verified natively by the node. It runs against the carbs standalone node (`infra/`), which enables `Passkey` and `fixPasskeyChallenge` (defect P5: without the fix a valid passkey signature is refused on x86-64 and macOS on arm64).

What it does, step by step:

1. **Account**: a new classical master key in the browser, funded by the faucet of `server/server.ts` (paid from the genesis account).
2. **Passkey**: `navigator.credentials.create` (ES256), then `PasskeyListSet` signed by the master key. The passkey public key is `0xF6 ‖ X ‖ Y`.
3. **Passkey only** (optional): `SetRegularKey` to `rrrrrrrrrrrrrrrrrrrrBZbvji` (no key controls it), then `asfDisableMaster`; the master seed is then deleted from the browser.
4. **Pay**: `SigningPubKey` = passkey key, WebAuthn challenge = the transaction's signing data (`STX\0` ‖ fields), signature in `PasskeySignature`.

No xrpl.js: its validation rejects `PasskeyListSet`, and the passkey fields need the node's own `server_definitions`. Encoding uses `ripple-binary-codec` with those definitions, over a plain WebSocket.

The master seed stays in `localStorage` until step 3. Test node only.

## Run

```sh
# local node (see docs/BUILDING.md), then:
VITE_NODE_URL=ws://localhost:6006 pnpm build
GENESIS_SEED=<genesis seed> XRPLD_WS=ws://127.0.0.1:6006 PORT=8080 pnpm serve
```

WebAuthn needs a secure context: `http://localhost` or HTTPS with a real host name (not an IP). Deployed, `infra/compose.yaml` runs the node, the closer and this wallet; `tailscale serve` provides HTTPS.
