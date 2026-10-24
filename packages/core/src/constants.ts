/**
 * Named constants of the client (FIANSO-SPEC.md sections 6.9, 6.14, 8.2 and appendix A).
 *
 * Protocol codes (transaction types, fields, result codes, flags) are NOT here: they are read from
 * the node's `server_definitions` at run time (see `definitions.ts`). Only the names the client
 * looks up, the limits the protocol enforces and the key formats are constants.
 */

/** Longest session the protocol accepts, in seconds (decision D2). */
export const kMaxSessionDuration = 600;
/** Multiple of the base fee unit a session may pay on top of the required fee. */
export const kSessionFeeMultiple = 1000;
/** A session transaction's `LastLedgerSequence` must be at most this many ledgers ahead. */
export const kSessionMaxLedgerWindow = 256;
/** Most XLS-75 permission values a mode-P session may carry (same as `DelegateSet`). */
export const kPermissionMaxSize = 10;
/**
 * `LastLedgerSequence` offset the client sets on every transaction it builds. With 1-second
 * ledgers +20 is too short for a device prompt; +150 stays inside `kSessionMaxLedgerWindow`.
 */
export const kLastLedgerSequenceOffset = 150;
/** Default session duration offered by the UI, in seconds (10 minutes). */
export const kDefaultSessionDuration = kMaxSessionDuration;
/** Seconds between 1970-01-01 and the Ripple epoch, 2000-01-01. */
export const kRippleEpochOffset = 946_684_800;

/** Signing prefix of a single signature: `STX\0` (`HashPrefix::TxSign`). */
export const kTxSignPrefix = Uint8Array.of(0x53, 0x54, 0x58, 0x00);
/** Prefix of the transaction id hash: `TXN\0` (`HashPrefix::TransactionId`). */
export const kTxIdPrefix = Uint8Array.of(0x54, 0x58, 0x4e, 0x00);

/** First byte of an XRPL P-256 public key (`0xF6 ‖ X ‖ Y`, `PublicKey.cpp:252`). */
export const kP256PublicKeyPrefix = 0xf6;
/** Length of an XRPL P-256 public key. */
export const kP256PublicKeyLength = 65;
/** First byte of an uncompressed SEC1 point, as WebCrypto exports a raw P-256 public key. */
export const kSec1UncompressedPrefix = 0x04;
/** Length of a P-256 coordinate and of a P1363 `r` or `s`. */
export const kP256ScalarLength = 32;
/** Order `n` of the P-256 group. */
export const kP256Order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** ML-DSA-44 sizes (FIPS 204), as the node expects them: the public key has no prefix. */
export const kMlDsa44PublicKeyLength = 1312;
export const kMlDsa44SignatureLength = 2420;
export const kMlDsa44SecretKeyLength = 2560;
export const kMlDsa44SeedLength = 32;

/** Length of a compressed secp256k1 or a prefixed Ed25519 public key. */
export const kClassicPublicKeyLength = 33;
/** Prefix of an XRPL Ed25519 public key. */
export const kEd25519PublicKeyPrefix = 0xed;

/** The blackhole address: no key can sign for it (AccountID of all zeroes plus one). */
export const kBlackholeAddress = "rrrrrrrrrrrrrrrrrrrrBZbvji";

/** Names the client looks up in `server_definitions` (never their numbers). */
export const kSessionTransactionTypes = ["SigningSessionSet", "SigningSessionDelete"] as const;
export const kSessionFields = [
  "SessionKey",
  "SessionCap",
  "SessionSpent",
  "SessionDuration",
] as const;
export const kSessionLedgerEntryType = "SigningSession";
export const kSessionResultCodes = [
  "tefSESSION_EXPIRED",
  "tefSESSION_LIMIT",
  "tefSESSION_TX_NOT_ALLOWED",
] as const;
export const kAllTransactionsFlagName = "tfAllTransactions";
export const kDisableMasterFlagName = "asfDisableMaster";

/** Public AlphaNet (spikes only, FIANSO-SPEC.md section 5.1). */
export const kAlphaNetRpcUrl = "https://rpc.alphanet.xrpl.org";
export const kAlphaNetFaucetUrl = "https://faucet.alphanet.xrpl.org/accounts";
export const kAlphaNetNetworkId = 24100;
export const kAlphaNetExplorerTxUrl = "https://alphanet.xrpl.org/transactions/";
/** A public mainnet full-history server, used read-only by the exposure check. */
export const kMainnetRpcUrl = "https://xrplcluster.com";
/** Networks with an id above this must carry `NetworkID` in every transaction. */
export const kNetworkIdRequiredAbove = 1024;

/** Bounds of the exposure search (FIANSO-SPEC.md section 8.7 rule 6). */
export const kExposureDefaultPageLimit = 20;
export const kExposurePageSize = 200;
/** Pages allowed for each sub-check of a signer, delegate or regular-key account. */
export const kExposureSubCheckPageLimit = 5;

/** Interval between two polls for the validation of a submitted transaction. */
export const kValidationPollIntervalMs = 1000;
