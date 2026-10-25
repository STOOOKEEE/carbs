// Post-quantum passkeys end to end on a carbs node with the PasskeyMLDSA amendment (PR #113):
// register an ML-DSA-44 WebAuthn passkey, pay with it, see the node refuse three forged
// assertions, open, use and close a signing session with it, lock the account to it, and pay
// again. The same flow as the "Passkey post-quantique (Ledger Stax)" section of the wallet
// (src/pq-webauthn.ts), with a SOFTWARE authenticator in place of the Stax: every WebAuthn
// assertion below is SIMULATED (no device, no browser ceremony). The node's answers are real.
// Every line prints the node's own result; the script exits 1 at the first surprise.
//   GENESIS_SEED=… XRPLD_WS=ws://127.0.0.1:6006 pnpm --filter @carbs/passkey-wallet pq-passkey-demo

import {
  type BytesSigner,
  type Definitions,
  type FinalResult,
  type PasskeySigner,
  type TxJson,
  WebSocketClient,
  addressFromPublicKey,
  base64UrlDecode,
  bytesToHex,
  classicSignerFromSeed,
  createSessionKey,
  fetchCommonFields,
  generateClassicSeed,
  getAccountObjects,
  hexToBytes,
  loadDefinitions,
  mlDsaPasskeyFromAttestation,
  signTransaction,
  submitSignedAndWait,
} from "@carbs/sessions";
import { SoftwareMlDsaAuthenticator, signWithMlDsaPasskeyForTests } from "@carbs/sessions/testing";

import {
  type PqStep,
  accepted,
  closeSessionWithPqPasskey,
  lockToPqPasskey,
  openSessionWithPqPasskey,
  payWithPqPasskey,
  payWithSession,
  registerPqPasskey,
} from "../src/pq-webauthn.ts";
import { read } from "../src/ledger.ts";
import { NodeClient as RawNodeClient } from "../src/rpc.ts";

const NODE_WS = process.env["XRPLD_WS"] ?? "ws://127.0.0.1:6006";
const GENESIS_SEED_ENV = process.env["GENESIS_SEED"];
if (GENESIS_SEED_ENV === undefined) throw new Error("GENESIS_SEED is not set");
const genesisSeed: string = GENESIS_SEED_ENV;

const AMENDMENT = "PasskeyMLDSA";
const RP_ID = "localhost";
const ORIGIN = "https://localhost";
const DROPS_PER_XRP = 1_000_000n;
const ACCOUNT_FUNDING = 1_000n * DROPS_PER_XRP;
const RECIPIENT_FUNDING = 100n * DROPS_PER_XRP;
const PAYMENT = 5n * DROPS_PER_XRP;
const SESSION_PAYMENT = 2n * DROPS_PER_XRP;
const SESSION_RULES = {
  capDrops: 20n * DROPS_PER_XRP,
  maxPerTxDrops: 5n * DROPS_PER_XRP,
  durationSec: 300,
};
const REGISTRATION_CHALLENGE_BYTES = 32;
/** The node's answer to a blob that fails its local signature checks (an RPC error, no code). */
const INVALID_TRANSACTION = "invalidTransaction";

const node = new WebSocketClient(NODE_WS);
const defs: Definitions = await loadDefinitions(node);
const results: { label: string; signer: string; result: string; ok: boolean }[] = [];

/** A result name the node serves (never a hand-copied number); invalidTransaction is an RPC error. */
function known(code: string): string {
  if (code !== INVALID_TRANSACTION) defs.resultCode(code);
  return code;
}

function report(label: string, signer: string, result: FinalResult, expected: string): void {
  const got = result.validated ? result.result : result.submit.engineResult;
  const ok = got === known(expected) && (expected !== "tesSUCCESS" || accepted(result));
  const where = result.validated
    ? `validated, ledger ${result.ledgerIndex ?? "?"}`
    : "not included";
  const message =
    result.submit.engineResultMessage === "" ? "" : ` (${result.submit.engineResultMessage})`;
  console.log(
    `${ok ? "OK " : "!! "} ${label.padEnd(58)} ${signer.padEnd(8)} submit ${result.submit.engineResult}${message} -> ${got} [${where}] ${result.hash}`,
  );
  results.push({ label, signer, result: got, ok });
  if (!ok) throw new Error(`${label}: expected ${expected}, got ${got}`);
}

function step(prefix: string, s: PqStep, expected: string): void {
  report(`${prefix} ${s.label}`, s.signer, s.result, expected);
}

async function submitWithKey(signer: BytesSigner, tx: TxJson): Promise<FinalResult> {
  const common = await fetchCommonFields(node, tx.Account);
  const signed = await signTransaction({ ...tx, ...common }, signer, defs);
  return submitSignedAndWait(node, signed, common.LastLedgerSequence);
}

/** Whether the node has the amendment enabled (`feature` on the public port), when it says. */
async function amendmentStatus(): Promise<string> {
  const raw = await RawNodeClient.connect(NODE_WS);
  try {
    const answer = await raw.request("feature", { feature: AMENDMENT });
    for (const entry of Object.values(answer)) {
      if (typeof entry === "object" && entry !== null && Reflect.get(entry, "name") === AMENDMENT) {
        return Reflect.get(entry, "enabled") === true ? "enabled" : "NOT enabled";
      }
    }
    return "unknown to this node";
  } catch (error) {
    return `not readable (${error instanceof Error ? error.message : String(error)})`;
  } finally {
    raw.close();
  }
}

try {
  console.log(`Node ${NODE_WS}: ${AMENDMENT} ${await amendmentStatus()}`);
  console.log("WebAuthn: SIMULATED software ML-DSA-44 authenticator (@noble/post-quantum 0.7.1)\n");

  const genesis = classicSignerFromSeed(genesisSeed);
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
    report(`0  fund ${address}`, "genesis", funded, "tesSUCCESS");
  }

  // Registration: the authenticator's attestationObject, parsed as the browser would hand it over.
  const authenticator = new SoftwareMlDsaAuthenticator(ORIGIN);
  const registration = authenticator.makeCredential(
    crypto.getRandomValues(new Uint8Array(REGISTRATION_CHALLENGE_BYTES)),
    RP_ID,
  );
  const credential = mlDsaPasskeyFromAttestation(registration.attestationObject, {
    rawId: registration.rawId,
    rpId: RP_ID,
  });
  console.log(
    `    passkey: PasskeyID ${bytesToHex(credential.credentialId)}, ML-DSA-44 key ${credential.publicKey.length} bytes (COSE AKP, alg -48)`,
  );
  const passkey: PasskeySigner = { credential, authenticator, rpId: RP_ID };

  step("1 ", await registerPqPasskey(node, defs, account, master, passkey), "tesSUCCESS");
  const lists = await getAccountObjects(node, account, "passkey_list");
  const stored = JSON.stringify(lists).includes(bytesToHex(credential.publicKey));
  console.log(
    `${stored ? "OK " : "!! "}    account_objects passkey_list holds the 1 312-byte key: ${stored}`,
  );
  if (!stored) throw new Error("the passkey list does not hold the ML-DSA-44 key");

  const paid = await payWithPqPasskey(node, defs, account, passkey, recipient, PAYMENT);
  step("2 ", paid, "tesSUCCESS");
  // What the validated ledger holds (API v2 `tx_json`, or v1 at the top level).
  const answer = await node.request("tx", { transaction: paid.result.hash });
  const onLedger = read(answer, ["tx_json"]) ?? answer;
  const clientData: unknown = JSON.parse(
    new TextDecoder().decode(
      hexToBytes(String(read(onLedger, ["PasskeySignature", "ClientDataJSON"]))),
    ),
  );
  console.log(
    `    on the ledger: SigningPubKey ${hexToBytes(String(read(onLedger, ["SigningPubKey"]))).length} bytes, TxnSignature ${read(onLedger, ["TxnSignature"]) === undefined ? "absent" : "present"}, PasskeySignature.Signature ${hexToBytes(String(read(onLedger, ["PasskeySignature", "Signature"]))).length} bytes, PasskeyID ${String(read(onLedger, ["PasskeySignature", "PasskeyID"]))}, WebAuthn challenge ${base64UrlDecode(String(read(clientData, ["challenge"]))).length} bytes (type ${String(read(clientData, ["type"]))})`,
  );

  // Refusals: the node, not the client, says no (the client's own check is turned off).
  const forged = async (
    label: string,
    signer: PasskeySigner,
    options: { passkeyId?: Uint8Array; tamper?: boolean },
    expected: string,
  ) => {
    const common = await fetchCommonFields(node, account);
    const payment: TxJson = {
      TransactionType: "Payment",
      Account: account,
      Destination: recipient,
      Amount: PAYMENT.toString(),
      ...common,
    };
    const used = options.tamper
      ? {
          getAssertion: async (request: Parameters<typeof authenticator.getAssertion>[0]) => {
            const assertion = await signer.authenticator.getAssertion(request);
            const signature = assertion.signature.slice();
            signature[0] = (signature[0] ?? 0) ^ 0x01;
            return { ...assertion, signature };
          },
        }
      : signer.authenticator;
    const signed = await signWithMlDsaPasskeyForTests(
      payment,
      signer.credential,
      used,
      RP_ID,
      defs,
      {
        verify: false,
        ...(options.passkeyId === undefined ? {} : { passkeyId: options.passkeyId }),
      },
    );
    report(
      label,
      "passkey",
      await submitSignedAndWait(node, signed, common.LastLedgerSequence),
      expected,
    );
  };
  await forged(
    "3a Payment, PasskeySignature.PasskeyID of another credential",
    passkey,
    { passkeyId: Uint8Array.of(1, 2, 3, 4) },
    "tefBAD_AUTH",
  );
  await forged(
    "3b Payment, ML-DSA-44 signature altered (one bit)",
    passkey,
    { tamper: true },
    INVALID_TRANSACTION,
  );
  const stranger = new SoftwareMlDsaAuthenticator(ORIGIN);
  await forged(
    "3c Payment, valid assertion of an unregistered ML-DSA-44 passkey",
    { credential: stranger.credential, authenticator: stranger, rpId: RP_ID },
    {},
    "tefBAD_AUTH",
  );

  // A signing session opened by the passkey; its P-256 WebCrypto key pays with no device.
  const sessionKey = await createSessionKey();
  step(
    "4a",
    await openSessionWithPqPasskey(node, defs, account, passkey, sessionKey, SESSION_RULES),
    "tesSUCCESS",
  );
  step(
    "4b",
    await payWithSession(node, defs, account, sessionKey, recipient, SESSION_PAYMENT),
    "tesSUCCESS",
  );
  step(
    "4c",
    await closeSessionWithPqPasskey(node, defs, account, passkey, sessionKey),
    "tesSUCCESS",
  );

  // Lock: the ML-DSA-44 passkey becomes the account's only authority.
  for (const s of await lockToPqPasskey(node, defs, account, master)) step("5 ", s, "tesSUCCESS");
  const masterPayment = await submitWithKey(master, {
    TransactionType: "Payment",
    Account: account,
    Destination: recipient,
    Amount: PAYMENT.toString(),
  });
  report(
    "6a Payment signed by the disabled master key",
    "master",
    masterPayment,
    "tefMASTER_DISABLED",
  );
  step(
    "6b",
    await payWithPqPasskey(node, defs, account, passkey, recipient, PAYMENT),
    "tesSUCCESS",
  );

  console.log(
    `\nAll ${results.length} node answers as expected. Account ${account}: master key disabled, RegularKey the black hole, one ML-DSA-44 passkey.`,
  );
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  node.close();
}
