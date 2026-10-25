/**
 * A SIMULATED device: it follows the contract of `docs/device-contract.md` APDU by APDU (chunking,
 * P1/P2, prefixes, answers, status words), parses what it is asked to sign with the node's
 * definitions, shows the review lines of `screen.ts` to an `approve` callback, and signs in
 * software. It is a test double of the XRP app, not the app: every result it produces is SIMULATED.
 */

import {
  bytesToHex,
  classicSignerFromSeed,
  decodeTx,
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
import { deviceMlDsaSeed } from "./slip21.js";

export interface SimulatedDeviceOptions {
  defs: Definitions;
  /** BIP39 seed of the device (64 bytes); the ML-DSA key is derived from it as the device does. */
  bip39Seed: Uint8Array;
  /** XRPL family seeds standing in for the BIP32 keys of each curve (SIMULATED). */
  classicSeeds: { secp256k1: string; ed25519: string };
  /** The user's answer to a review; resolves `true` to sign. */
  approve: (review: Review, kind: "classic" | "ml-dsa") => Promise<boolean>;
}

type SignState = "idle" | "waiting";

const ok = (data: Uint8Array = new Uint8Array()): ApduResponse => ({ data, statusWord: kSw.ok });
const sw = (statusWord: number): ApduResponse => ({ data: new Uint8Array(), statusWord });

export class SimulatedDevice implements ApduTransport {
  readonly reviews: Review[] = [];
  readonly #options: SimulatedDeviceOptions;
  readonly #mlDsa: BytesSigner;
  readonly #classic: Record<"secp256k1" | "ed25519", BytesSigner>;
  #lastIns = -1;
  #signState: SignState = "idle";
  #raw: number[] = [];
  #curve: "secp256k1" | "ed25519" = "secp256k1";
  #pqMessage: number[] = [];
  #pqSignature: Uint8Array | undefined;

  constructor(options: SimulatedDeviceOptions) {
    this.#options = options;
    this.#mlDsa = mlDsaSignerFromSeed(deviceMlDsaSeed(options.bip39Seed));
    this.#classic = {
      secp256k1: classicSignerFromSeed(options.classicSeeds.secp256k1),
      ed25519: classicSignerFromSeed(options.classicSeeds.ed25519),
    };
  }

  /** The ML-DSA-44 public key the device holds (for tests). */
  get mlDsaPublicKey(): Uint8Array {
    return this.#mlDsa.publicKey;
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
    const review = this.#review(fields);
    if (!review) return sw(0x6800);
    if (!(await this.#options.approve(review, "classic"))) return sw(kSw.denied);
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
    const review = this.#review(message.subarray(kTxSignPrefix.length));
    if (!review) return sw(kSw.wrongData);
    if (!(await this.#options.approve(review, "ml-dsa"))) return sw(kSw.denied);
    this.#pqSignature = await this.#mlDsa.sign(message);
    const length = this.#pqSignature.length;
    return ok(Uint8Array.of(length >> 8, length & 0xff));
  }

  #review(fields: Uint8Array): Review | undefined {
    try {
      const tx = decodeTx(bytesToHex(fields), this.#options.defs);
      const review = reviewLines(tx, this.#options.defs);
      this.reviews.push(review);
      return review;
    } catch {
      return undefined;
    }
  }

  #chunk(bytes: Uint8Array, index: number): ApduResponse {
    const offset = index * kPqChunk;
    if (offset >= bytes.length) return sw(kSw.wrongP1P2);
    return ok(bytes.slice(offset, offset + kPqChunk));
  }
}
