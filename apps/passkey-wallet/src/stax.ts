// The Ledger Stax as a signer of its own account, without any page: connection, account state
// (classical key, or the ML-DSA-44 root once migrated), signing and submission. Shared by the
// wallet page (ledger-panel.ts) and the stage demo (demo/). Chrome or Edge only (WebHID).

import {
  type LedgerDevice,
  connectLedger,
  getClassicPublicKey,
  getMlDsaPublicKey,
  kDefaultXrpPath,
  signClassic,
  signMlDsa,
} from "@carbs/ledger";
import { type XrplDefinitions, encodeForSigning } from "ripple-binary-codec";
import { deriveAddress, verify } from "ripple-keypairs";

import type { Connection } from "./account.ts";
import { bytesToHex, hexToBytes } from "./hex.ts";
import {
  type SubmittedTx,
  type TxJson,
  accountInfo,
  autofill,
  read,
  submitAndWait,
} from "./ledger.ts";

const LSF_DISABLE_MASTER = 0x00100000;
const DROPS_PER_XRP = 1_000_000;
/** XRPL single-signing prefix STX\0: the classical path of the XRP app adds it itself. */
const SIGNING_PREFIX_BYTES = 4;
/** The device's classical account key (what the XRP app derives by default). */
const CLASSIC_CURVE = "secp256k1";

/** A key of the device: XRPL address and upper-case hex public key. */
export interface DeviceKey {
  address: string;
  publicKey: string;
}

export interface Stax {
  device: LedgerDevice;
  account: DeviceKey;
  pqKey: DeviceKey;
}

export interface AccountState {
  balance: string;
  regularKey: string | undefined;
  masterDisabled: boolean;
}

/** Opens the device (the browser asks which one) and reads its classical and ML-DSA keys. */
export async function connectStax(): Promise<Stax> {
  const device = await connectLedger();
  try {
    const classic = await getClassicPublicKey(device, kDefaultXrpPath, CLASSIC_CURVE);
    const pqPublicKey = bytesToHex(await getMlDsaPublicKey(device));
    return {
      device,
      account: { address: classic.address, publicKey: bytesToHex(classic.publicKey) },
      pqKey: { address: deriveAddress(pqPublicKey), publicKey: pqPublicKey },
    };
  } catch (error) {
    await device.close();
    throw error;
  }
}

/** The account on the ledger; undefined while it is not funded. */
export async function accountState(
  connection: Connection,
  address: string,
): Promise<AccountState | undefined> {
  const info = await accountInfo(connection.node, address);
  if (info === undefined) return undefined;
  const drops = read(info, ["account_data", "Balance"]);
  const regularKey = read(info, ["account_data", "RegularKey"]);
  const flags = read(info, ["account_data", "Flags"]);
  return {
    balance: typeof drops === "string" ? `${Number(drops) / DROPS_PER_XRP} XRP` : "?",
    regularKey: typeof regularKey === "string" ? regularKey : undefined,
    masterDisabled: typeof flags === "number" && (flags & LSF_DISABLE_MASTER) !== 0,
  };
}

/** Migrated: the ML-DSA-44 key is the regular key and the master key is disabled. */
export function isPostQuantumRoot(stax: Stax, state: AccountState | undefined): boolean {
  return state !== undefined && state.regularKey === stax.pqKey.address && state.masterDisabled;
}

/** Signs with the account key; the device shows the transaction in clear. */
async function signClassicTx(
  device: LedgerDevice,
  account: DeviceKey,
  tx: TxJson,
  defs: XrplDefinitions,
): Promise<TxJson> {
  const unsigned: TxJson = { ...tx, SigningPubKey: account.publicKey };
  const signingData = encodeForSigning(unsigned, defs);
  const fields = hexToBytes(signingData).subarray(SIGNING_PREFIX_BYTES);
  const signature = bytesToHex(await signClassic(device, kDefaultXrpPath, CLASSIC_CURVE, fields));
  if (!verify(signingData, signature, account.publicKey)) {
    throw new Error("the Ledger signature does not verify under the account key");
  }
  return { ...unsigned, TxnSignature: signature };
}

/**
 * Signs with the ML-DSA-44 root: the device parses the signing data (`STX\0` included) and
 * shows it in clear, then signs with pure ML-DSA and an empty context; the node verifies it.
 */
async function signMlDsaTx(
  device: LedgerDevice,
  pqKey: DeviceKey,
  tx: TxJson,
  defs: XrplDefinitions,
): Promise<TxJson> {
  const unsigned: TxJson = { ...tx, SigningPubKey: pqKey.publicKey };
  const signature = await signMlDsa(device, hexToBytes(encodeForSigning(unsigned, defs)));
  return { ...unsigned, TxnSignature: bytesToHex(signature) };
}

/** Signs a transaction of the Stax account on the device (classical or ML-DSA key) and submits it. */
export async function submitSignedByStax(
  connection: Connection,
  stax: Stax,
  tx: TxJson,
  withPq: boolean,
): Promise<SubmittedTx> {
  const filled = await autofill(connection.node, connection.defs, {
    ...tx,
    Account: stax.account.address,
  });
  const signed = withPq
    ? await signMlDsaTx(stax.device, stax.pqKey, filled, connection.defs)
    : await signClassicTx(stax.device, stax.account, filled, connection.defs);
  return submitAndWait(connection.node, connection.defs, signed);
}
