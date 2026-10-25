/**
 * A SIMULATED device: it follows the contract of `docs/device-contract.md` APDU by APDU (chunking,
 * P1/P2, prefixes, answers, status words), parses what it is asked to sign with the node's
 * definitions, applies the session rules of the app (a session transaction is never blind-signed,
 * `0x6815`; the session policy is checked before any review, `0x6986`), shows the review lines of
 * `screen.ts` to an `approve` callback, and signs in software. It is a test double of the XRP app,
 * not the app: every result it produces is SIMULATED. It does not predict the review of a `Batch`,
 * so a `Batch` holding a session transaction is refused as never blind-signed.
 */

import {
  bytesToHex,
  classicSignerFromSeed,
  decodeTx,
  kSessionTransactionTypes,
  kTxSignPrefix,
  mlDsaSignerFromSeed,
  type BytesSigner,
  type Definitions,
} from "@carbs/sessions";
import { encodeAccountID } from "ripple-address-codec";
import { accountIdBytes } from "@carbs/sessions";
import {
  kCla,
  kInsGetPublicKey,
  kInsGetSessionPolicy,
  kInsPqGetPublicKey,
  kInsPqGetSignature,
  kInsPqSign,
  kInsSign,
  kMaxRawTx,
  kP1Confirm,
  kP1MaskMore,
  kP1MaskOrder,
  kP1NonConfirm,
  kP2ChainCode,
  kP2Ed25519,
  kP2Secp256k1,
  kPqChunk,
  kPqMaxMessage,
  kSw,
  type Apdu,
  type ApduResponse,
  type ApduTransport,
} from "./apdu.js";
import { reviewLines, type Review } from "./screen.js";
import { encodeSessionPolicy, kSessionPolicyOff, type SessionPolicy } from "./session-policy.js";
import { batchInnerTransactions, sessionPolicyRefusal } from "./session-policy-check.js";
import { deviceMlDsaSeed } from "./slip21.js";

export interface SimulatedDeviceOptions {
  defs: Definitions;
  /** BIP39 seed of the device (64 bytes); the ML-DSA key is derived from it as the device does. */
  bip39Seed: Uint8Array;
  /** XRPL family seeds standing in for the BIP32 keys of each curve (SIMULATED). */
  classicSeeds: { secp256k1: string; ed25519: string };
  /** The user's answer to a review; resolves `true` to sign. */
  approve: (review: Review, kind: "classic" | "ml-dsa") => Promise<boolean>;
  /** The session policy set in the device settings; off by default, as on a fresh install. */
  sessionPolicy?: SessionPolicy;
}

type SignState = "idle" | "waiting";

/** The device's refusal screens (`ledger-app/src/ui/other/`). */
export const kSessionBlindRefusalText = "Session transactions are never blind-signed";
export const kSessionPolicyRefusalText = "Blocked by your session policy";

const ok = (data: Uint8Array = new Uint8Array()): ApduResponse => ({ data, statusWord: kSw.ok });
const sw = (statusWord: number): ApduResponse => ({ data: new Uint8Array(), statusWord });

const isSessionType = (type: unknown): boolean =>
  kSessionTransactionTypes.some((sessionType) => sessionType === type);

/** A session transaction itself, or a `Batch` holding one. */
function holdsSession(tx: Record<string, unknown>): boolean {
  return (
    isSessionType(tx["TransactionType"]) ||
    batchInnerTransactions(tx).some((inner) => isSessionType(inner["TransactionType"]))
  );
}

export class SimulatedDevice implements ApduTransport {
  readonly reviews: Review[] = [];
  /** The refusal screens shown instead of a review, e.g. `Blocked by your session policy: …`. */
  readonly refusals: string[] = [];
  readonly #options: SimulatedDeviceOptions;
  readonly #mlDsa: BytesSigner;
  readonly #classic: Record<"secp256k1" | "ed25519", BytesSigner>;
  #lastIns = -1;
  #signState: SignState = "idle";
  #raw: number[] = [];
  #curve: "secp256k1" | "ed25519" = "secp256k1";
  #pqMessage: number[] = [];
  #pqSignature: Uint8Array | undefined;
  #sessionPolicy: SessionPolicy = kSessionPolicyOff;

  constructor(options: SimulatedDeviceOptions) {
    this.#options = options;
    this.#mlDsa = mlDsaSignerFromSeed(deviceMlDsaSeed(options.bip39Seed));
    this.#classic = {
      secp256k1: classicSignerFromSeed(options.classicSeeds.secp256k1),
      ed25519: classicSignerFromSeed(options.classicSeeds.ed25519),
    };
    this.sessionPolicy = options.sessionPolicy ?? kSessionPolicyOff;
  }

  /** The ML-DSA-44 public key the device holds (for tests). */
  get mlDsaPublicKey(): Uint8Array {
    return this.#mlDsa.publicKey;
  }

  /** The session policy of the device settings (the host can only read it, with `INS 0x08`). */
  get sessionPolicy(): SessionPolicy {
    return this.#sessionPolicy;
  }

  /** As the user editing the device settings; throws `RangeError` on a limit the device cannot store. */
  set sessionPolicy(policy: SessionPolicy) {
    encodeSessionPolicy(policy);
    this.#sessionPolicy = policy;
  }

  async exchange(apdu: Apdu): Promise<ApduResponse> {
    if (apdu.cla !== kCla) return sw(kSw.claNotSupported);
    // `handle_apdu` resets the transaction context when the instruction changes (entry.c:40-42);
    // the ML-DSA signature lives outside that context (pq_root.c:60-62).
    if (apdu.ins !== this.#lastIns) {
      this.#signState = "idle";
      this.#raw = [];
      this.#pqMessage = [];
    }
    this.#lastIns = apdu.ins;
    switch (apdu.ins) {
      case kInsGetPublicKey:
        return this.#getPublicKey(apdu);
      case kInsSign:
        return this.#sign(apdu);
      case kInsPqGetPublicKey:
        return this.#chunk(this.#mlDsa.publicKey, apdu.p1);
      case kInsPqSign:
        return this.#pqSign(apdu);
      case kInsPqGetSignature:
        return this.#pqSignature ? this.#chunk(this.#pqSignature, apdu.p1) : sw(kSw.noSignature);
      case kInsGetSessionPolicy:
        // `ledger-app/src/apdu/messages/get_session_policy.c`
        if (apdu.p1 !== 0 || apdu.p2 !== 0) return sw(kSw.wrongP1P2);
        return ok(encodeSessionPolicy(this.#sessionPolicy));
      default:
        return sw(kSw.insNotSupported);
    }
  }

  #curveOf(p2: number): "secp256k1" | "ed25519" | undefined {
    const k1 = (p2 & kP2Secp256k1) !== 0;
    const ed = (p2 & kP2Ed25519) !== 0;
    if (k1 === ed) return undefined;
    return k1 ? "secp256k1" : "ed25519";
  }

  #getPublicKey(apdu: Apdu): ApduResponse {
    const curve = this.#curveOf(apdu.p2);
    if ((apdu.p1 !== kP1Confirm && apdu.p1 !== kP1NonConfirm) || !curve) return sw(kSw.wrongP1P2);
    const key = this.#classic[curve].publicKey;
    const address = new TextEncoder().encode(encodeAccountID(accountIdBytes(key)));
    const chain = (apdu.p2 & 0x3f) === kP2ChainCode ? new Uint8Array(32) : new Uint8Array();
    return ok(new Uint8Array([key.length, ...key, address.length, ...address, ...chain]));
  }

  async #sign(apdu: Apdu): Promise<ApduResponse> {
    const first = (apdu.p1 & kP1MaskOrder) === 0;
    let data = apdu.data;
    if (this.#signState === "idle") {
      if (!first) return sw(kSw.wrongData);
      const curve = this.#curveOf(apdu.p2);
      if (!curve) return sw(kSw.wrongP1P2);
      this.#curve = curve;
      const count = data[0] ?? 0;
      data = data.subarray(1 + 4 * count);
      this.#raw = [];
    } else if (first) {
      return sw(kSw.wrongData);
    }
    if (kTxSignPrefix.length + this.#raw.length + data.length > kMaxRawTx) {
      this.#signState = "idle";
      return sw(kSw.wrongLength);
    }
    this.#raw.push(...data);
    if ((apdu.p1 & kP1MaskMore) !== 0) {
      this.#signState = "waiting";
      return ok();
    }
    this.#signState = "idle";
    const fields = Uint8Array.from(this.#raw);
    // A parse failure answers `0x6800 | code` on the classical path.
    const status = await this.#reviewAndApprove(fields, "classic", 0x6800);
    if (status !== kSw.ok) return sw(status);
    // The app prepends STX\0 itself (sign_transaction.c:251-263).
    const signingData = new Uint8Array([...kTxSignPrefix, ...fields]);
    return ok(await this.#classic[this.#curve].sign(signingData));
  }

  async #pqSign(apdu: Apdu): Promise<ApduResponse> {
    if (apdu.p1 > 1 || apdu.p2 > 1) return sw(kSw.wrongP1P2);
    if (apdu.p1 === 0) {
      this.#pqMessage = [];
      this.#pqSignature = undefined;
    }
    if (this.#pqMessage.length + apdu.data.length > kPqMaxMessage) {
      this.#pqMessage = [];
      return sw(kSw.wrongLength);
    }
    this.#pqMessage.push(...apdu.data);
    if (apdu.p2 === 0) return ok();
    const message = Uint8Array.from(this.#pqMessage);
    this.#pqMessage = [];
    if (
      message.length <= kTxSignPrefix.length ||
      !kTxSignPrefix.every((b, i) => message[i] === b)
    ) {
      return sw(kSw.wrongData);
    }
    const status = await this.#reviewAndApprove(
      message.subarray(kTxSignPrefix.length),
      "ml-dsa",
      kSw.wrongData,
    );
    if (status !== kSw.ok) return sw(status);
    this.#pqSignature = await this.#mlDsa.sign(message);
    const length = this.#pqSignature.length;
    return ok(Uint8Array.of(length >> 8, length & 0xff));
  }

  /**
   * What both signing paths do before signing (`sign_transaction.c` and `review_transaction`,
   * `review_signing_data` in `pq_root.c`): parse, refuse a session transaction that cannot be
   * clear-signed (`0x6815`), check the session policy and the profile a session names (`0x6986`),
   * then show the review. Answers the status word, `0x9000` once the user approved.
   */
  async #reviewAndApprove(
    fields: Uint8Array,
    kind: "classic" | "ml-dsa",
    parseFailure: number,
  ): Promise<number> {
    const { defs } = this.#options;
    let tx: Record<string, unknown>;
    let review: Review;
    try {
      tx = decodeTx(bytesToHex(fields), defs);
      review = reviewLines(tx, defs);
    } catch {
      return parseFailure;
    }
    if (review.kind === "blind" && holdsSession(tx)) {
      this.refusals.push(kSessionBlindRefusalText);
      return kSw.sessionBlindRefused;
    }
    const reason = sessionPolicyRefusal(this.#sessionPolicy, tx, defs);
    if (reason !== undefined) {
      this.refusals.push(`${kSessionPolicyRefusalText}: ${reason}`);
      return kSw.sessionPolicyRefused;
    }
    this.reviews.push(review);
    return (await this.#options.approve(review, kind)) ? kSw.ok : kSw.denied;
  }

  #chunk(bytes: Uint8Array, index: number): ApduResponse {
    const offset = index * kPqChunk;
    if (offset >= bytes.length) return sw(kSw.wrongP1P2);
    return ok(bytes.slice(offset, offset + kPqChunk));
  }
}
