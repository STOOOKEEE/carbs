// Post-quantum passkey on a REAL Ledger Stax, end to end on a carbs node with PasskeyMLDSA (#113):
// register the Stax's ML-DSA-44 credential (made by the Security Key app of #109 with
// security-key-app/carbs/mldsa_passkey_test.py make) in a fresh account's passkey list, then pay
// and open a signing session with it. Each assertion is a real CTAP2 getAssertion on the device
// (approved on its screen), driven by the same host script with --challenge-hex = the XRPL signing
// data; the browser ceremony is not involved (python-fido2 stands in for the browser).
//   GENESIS_SEED=… XRPLD_WS=ws://127.0.0.1:6006 MLDSA_CREDENTIAL=…/mldsa-credential.json \
//   PYTHON=…/venv/bin/python pnpm --filter @carbs/passkey-wallet stax-pq-passkey

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AssertionRequest,
  type Authenticator,
  type BytesSigner,
  type Definitions,
  type FinalResult,
  type PasskeySigner,
  type TxJson,
  type WebAuthnAssertion,
  WebSocketClient,
  addressFromPublicKey,
  bytesToHex,
  classicSignerFromSeed,
  createSessionKey,
  fetchCommonFields,
  generateClassicSeed,
  hexToBytes,
  loadDefinitions,
  signTransaction,
  submitSignedAndWait,
} from "@carbs/sessions";

import {
  type PqStep,
  accepted,
  openSessionWithPqPasskey,
  payWithPqPasskey,
  registerPqPasskey,
} from "../src/pq-webauthn.ts";
import { read } from "../src/ledger.ts";

const NODE_WS = process.env["XRPLD_WS"] ?? "ws://127.0.0.1:6006";
const GENESIS_SEED = process.env["GENESIS_SEED"];
const CREDENTIAL_FILE = process.env["MLDSA_CREDENTIAL"];
const PYTHON = process.env["PYTHON"] ?? "python3";
if (GENESIS_SEED === undefined) throw new Error("GENESIS_SEED is not set");
if (CREDENTIAL_FILE === undefined) throw new Error("MLDSA_CREDENTIAL is not set");

const HOST_SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../security-key-app/carbs/mldsa_passkey_test.py",
);
const DROPS_PER_XRP = 1_000_000n;
const ACCOUNT_FUNDING = 1_000n * DROPS_PER_XRP;
const RECIPIENT_FUNDING = 100n * DROPS_PER_XRP;
const PAYMENT = 5n * DROPS_PER_XRP;
const SESSION_RULES = { capDrops: 20n * DROPS_PER_XRP, durationSec: 300 };

interface SavedCredential {
  rpId: string;
  credentialId: string;
  publicKey: string;
}

function loadCredential(path: string): SavedCredential {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const field = (name: string): string => {
    const value = read(parsed, [name]);
    if (typeof value !== "string") throw new Error(`${path}: no ${name}`);
    return value;
  };
  return {
    rpId: field("rpId"),
    credentialId: field("credentialId"),
    publicKey: field("publicKey"),
  };
}

/** A CTAP2 getAssertion on the Stax, through the host script (approve it on the device). */
class StaxAuthenticator implements Authenticator {
  readonly #credentialFile: string;
  readonly #workDir = mkdtempSync(join(tmpdir(), "stax-pq-passkey-"));
  #count = 0;

  constructor(credentialFile: string) {
    this.#credentialFile = credentialFile;
  }

  /** Delete the host script's answers (public assertion data, but no reason to leave them). */
  cleanup(): void {
    rmSync(this.#workDir, { recursive: true, force: true });
  }

  async getAssertion(request: AssertionRequest): Promise<WebAuthnAssertion> {
    const out = join(this.#workDir, `assertion-${++this.#count}.json`);
    console.log(
      `    Stax: approve the login on the device (challenge = ${request.challenge.length} bytes of XRPL signing data)...`,
    );
    const started = Date.now();
    execFileSync(
      PYTHON,
      [
        HOST_SCRIPT,
        "assert",
        "--credential",
        this.#credentialFile,
        "--challenge-hex",
        bytesToHex(request.challenge),
        "--out",
        out,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    console.log(`    Stax answered in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const answer: unknown = JSON.parse(readFileSync(out, "utf8"));
    const hex = (name: string): Uint8Array => {
      const value = read(answer, ["PasskeySignature", name]);
      if (typeof value !== "string") throw new Error(`host script answer: no ${name}`);
      return hexToBytes(value);
    };
    return {
      authenticatorData: hex("AuthenticatorData"),
      clientDataJSON: hex("ClientDataJSON"),
      signature: hex("Signature"),
    };
  }
}

const node = new WebSocketClient(NODE_WS);
const defs: Definitions = await loadDefinitions(node);
let failed = false;

function report(label: string, result: FinalResult, expected: string): void {
  // A name the node serves (throws otherwise), never a hand-copied number.
  defs.resultCode(expected);
  const got = result.validated ? result.result : result.submit.engineResult;
  const ok = got === expected && (expected !== "tesSUCCESS" || accepted(result));
  console.log(
    `${ok ? "OK " : "!! "} ${label.padEnd(44)} submit ${result.submit.engineResult} -> ${got} [${result.validated ? `validated, ledger ${result.ledgerIndex ?? "?"}` : "not included"}] ${result.hash}`,
  );
  if (!ok) {
    failed = true;
    throw new Error(`${label}: expected ${expected}, got ${got}`);
  }
}

async function submitWithKey(signer: BytesSigner, tx: TxJson): Promise<FinalResult> {
  const common = await fetchCommonFields(node, tx.Account);
  const signed = await signTransaction({ ...tx, ...common }, signer, defs);
  return submitSignedAndWait(node, signed, common.LastLedgerSequence);
}

function step(prefix: string, s: PqStep): void {
  report(`${prefix} ${s.label} (${s.signer})`, s.result, "tesSUCCESS");
}

const stax = new StaxAuthenticator(CREDENTIAL_FILE);
try {
  const saved = loadCredential(CREDENTIAL_FILE);
  const credential = {
    credentialId: hexToBytes(saved.credentialId),
    publicKey: hexToBytes(saved.publicKey),
  };
  console.log(
    `Node ${NODE_WS}. Stax credential: PasskeyID ${saved.credentialId.slice(0, 16)}…, ML-DSA-44 key ${credential.publicKey.length} bytes\n`,
  );
  const passkey: PasskeySigner = { credential, authenticator: stax, rpId: saved.rpId };

  const genesis = classicSignerFromSeed(GENESIS_SEED);
  const genesisAddress = addressFromPublicKey(genesis.publicKey);
  const master = classicSignerFromSeed(generateClassicSeed());
  const account = addressFromPublicKey(master.publicKey);
  const recipient = addressFromPublicKey(classicSignerFromSeed(generateClassicSeed()).publicKey);
  for (const [address, amount] of [
    [account, ACCOUNT_FUNDING],
    [recipient, RECIPIENT_FUNDING],
  ] as const) {
    const funded = await submitWithKey(genesis, {
      TransactionType: "Payment",
      Account: genesisAddress,
      Destination: address,
      Amount: amount.toString(),
    });
    report(`0  fund ${address}`, funded, "tesSUCCESS");
  }

  step("1 ", await registerPqPasskey(node, defs, account, master, passkey));

  const paid = await payWithPqPasskey(node, defs, account, passkey, recipient, PAYMENT);
  step("2 ", paid);
  const answer = await node.request("tx", { transaction: paid.result.hash });
  const onLedger = read(answer, ["tx_json"]) ?? answer;
  const length = (path: string[]): number => hexToBytes(String(read(onLedger, path))).length;
  console.log(
    `    on the ledger: SigningPubKey ${length(["SigningPubKey"])} bytes, TxnSignature ${read(onLedger, ["TxnSignature"]) === undefined ? "absent" : "present"}, PasskeySignature.Signature ${length(["PasskeySignature", "Signature"])} bytes`,
  );

  const sessionKey = await createSessionKey();
  step(
    "3 ",
    await openSessionWithPqPasskey(node, defs, account, passkey, sessionKey, SESSION_RULES),
  );
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  stax.cleanup();
  node.close();
}
process.exit(failed ? 1 : 0);
