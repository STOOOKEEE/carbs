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

## Post-quantum passkey on a Ledger Stax

The section "Passkey post-quantique (Ledger Stax)" (`src/pq-stax-panel.ts`, flow in `src/pq-webauthn.ts`) uses an ML-DSA-44 WebAuthn passkey (COSE -48). The node must have the amendment `PasskeyMLDSA` (PR #113, with `Passkey` and `Quantum`), and the authenticator must make -48 credentials: the team's Ledger Stax running the modified Security Key app of PR #109, over USB.

1. **Create**: `navigator.credentials.create` with `pubKeyCredParams: [{alg: -48}]` and `authenticatorAttachment: "cross-platform"`. The 1,312-byte key is read from the `attestationObject` (COSE AKP `pub`).
2. **Register**: a new classical account funded by the faucet, then `PasskeyListSet` signed by its master key (`PasskeyID` = the credential id, `PublicKey` = the 1,312 bytes).
3. **Pay**: `SigningPubKey` = the 1,312-byte key, WebAuthn challenge = `STX\0 ‖ fields` (about 1.4 KB), and a `PasskeySignature` with the raw 2,420-byte signature.
4. **Session**: `SigningSessionSet` (mode C, 20 XRP, 5 per payment, 300 s) signed by the Stax. A fresh non-extractible WebCrypto P-256 session key then pays once without the device.
5. **Lock** (optional): `SetRegularKey` to the black hole, then `asfDisableMaster`. The passkey becomes the account's only authority, and the master seed is deleted from the browser.

The section lists every node answer: the `engine_result` of `submit` and its message, then the validated result and ledger, with the hash linked to the explorer. An error gets one of two labels:

- "Cette étape n'a rien envoyé au nœud": the error was thrown before the step's submit (a missing input, a refused node, the browser or the authenticator, or the client's own check of the assertion);
- "État inconnu … vérifiez le hash ou le compte sur le nœud": anything else (the faucet, the connection, the wait for validation), after which the node may have received the step.

**Test node only:** the account's classical master seed is kept in clear in `localStorage` until the account is locked. The section says so and refuses to create an account unless the node is `localhost`, `127.0.0.1`, `[::1]` or a host listed in `VITE_TEST_NODE_HOSTS` (comma-separated, at build time). If the browser storage is lost, the `PasskeyID` and the key can be read back from the account's `passkey_list` in `account_objects`.

**On the real Stax**: `scripts/stax-pq-passkey.ts` (`pnpm stax-pq-passkey`) registered the Stax's credential, paid and opened a session with real CTAP2 assertions, all `tesSUCCESS` on a node with `PasskeyMLDSA`, and the client's assertion check passed on the real signatures (`docs/DEVLOG.md`). python-fido2 stood in for the browser, because the Security Key app speaks FIDO2 (CTAP2), which the Device Management Kit does not drive. **Not yet proven:** this section in Chrome (the browser forwarding -48, a 1.4 KB challenge), and the TypeScript registration parser on the device's own bytes: the credential came from `security-key-app/carbs/mldsa_passkey_test.py`. `make --dump-attestation <file>` records those bytes for the core test fixture.

**Without a device**, `pnpm pq-passkey-demo` runs the same flow against a node, with a software authenticator (SIMULATED: no device, no browser):

```sh
GENESIS_SEED=snoPBrXtMeMyMHUVTgbuqAfg1SUTb XRPLD_WS=ws://127.0.0.1:6006 pnpm pq-passkey-demo
```

It runs these steps in order:

1. register the passkey and pay with it;
2. submit three forged assertions: another `PasskeyID` (`tefBAD_AUTH`), one altered signature bit (`invalidTransaction`, "Invalid signature."), and an unregistered passkey (`tefBAD_AUTH`);
3. open a session, pay from it and close it;
4. lock the account, see the master key refused (`tefMASTER_DISABLED`), and pay with the passkey again.

It prints each node answer and exits 1 at the first unexpected one.

## Stage demo: an AI agent on a budget

The build has a second page, `demo.html` (full screen, English, for a projector): the AI
agent's live timeline, its budget as the ledger stores it, its Agent ID, the Stax approvals,
and the two guardrail layers (device session policy, ledger SigningSessions). Run sheet,
Stax policy to set beforehand and the 3-minute script: [`scripts/agent/README.md`](scripts/agent/README.md);
on the demo machine the page is **http://localhost:18080/demo.html**.
