/**
 * SIMULATED definitions: the public AlphaNet's recorded `server_definitions` plus the identifiers of
 * FIANSO-SPEC.md section 6.1, which the device track also uses (`ledger-app/src/xrp/signing_session.h`).
 *
 * This is the one place in the client where protocol numbers are written by hand, and only so the
 * library and the web app can be tested before a node with the `SigningSessions` amendment exists.
 * Everything built on it is SIMULATED; it is replaced by the node's own answer once the amendment is
 * merged (`loadDefinitions` against the standalone node), and a test compares the two then.
 */

import alphanet from "../fixtures/alphanet-server-definitions.json" with { type: "json" };
import standalone from "../fixtures/standalone-server-definitions.json" with { type: "json" };
import {
  asServerDefinitions,
  parseDefinitions,
  type Definitions,
  type FieldInfo,
  type ServerDefinitions,
} from "../definitions.js";

/** The public AlphaNet's `server_definitions` as recorded (hash `34614C84…C3C5`). */
export function alphanetServerDefinitions(): ServerDefinitions {
  return asServerDefinitions(structuredClone(alphanet));
}

/** Spec 6.1, written by hand (SIMULATED). */
const kSimulatedFields: [string, FieldInfo][] = [
  [
    "SessionKey",
    { nth: 34, isVLEncoded: true, isSerialized: true, isSigningField: true, type: "AccountID" },
  ],
  [
    "SessionCap",
    { nth: 47, isVLEncoded: false, isSerialized: true, isSigningField: true, type: "Amount" },
  ],
  [
    "SessionSpent",
    { nth: 48, isVLEncoded: false, isSerialized: true, isSigningField: true, type: "Amount" },
  ],
  [
    "SessionDuration",
    { nth: 114, isVLEncoded: false, isSerialized: true, isSigningField: true, type: "UInt32" },
  ],
];
const kSimulatedTransactionTypes = { SigningSessionSet: 130, SigningSessionDelete: 131 };
const kSimulatedLedgerEntryType = { SigningSession: 0x009a };
const kSimulatedAllTransactions = 0x00010000;
/** Appended after the last `tef` code, in the order of spec 6.1. */
const kSimulatedResultOrder = [
  "tefSESSION_EXPIRED",
  "tefSESSION_LIMIT",
  "tefSESSION_TX_NOT_ALLOWED",
];

/** The AlphaNet definitions with the SigningSessions identifiers added (SIMULATED). */
export function simulatedSessionServerDefinitions(
  base: ServerDefinitions = alphanetServerDefinitions(),
): ServerDefinitions {
  const defs = structuredClone(base);
  const names = new Set(defs.FIELDS.map(([name]) => name));
  for (const field of kSimulatedFields) if (!names.has(field[0])) defs.FIELDS.push(field);
  Object.assign(defs.TRANSACTION_TYPES, kSimulatedTransactionTypes);
  Object.assign(defs.LEDGER_ENTRY_TYPES, kSimulatedLedgerEntryType);
  const lastTef = Math.max(
    ...Object.entries(defs.TRANSACTION_RESULTS)
      .filter(([name]) => name.startsWith("tef"))
      .map(([, code]) => code),
  );
  kSimulatedResultOrder.forEach((name, i) => {
    defs.TRANSACTION_RESULTS[name] = lastTef + 1 + i;
  });
  defs.TRANSACTION_FLAGS = {
    ...defs.TRANSACTION_FLAGS,
    SigningSessionSet: { tfAllTransactions: kSimulatedAllTransactions },
    SigningSessionDelete: {},
  };
  defs.LEDGER_ENTRY_FLAGS = {
    ...defs.LEDGER_ENTRY_FLAGS,
    SigningSession: { lsfAllTransactions: kSimulatedAllTransactions },
  };
  delete defs.hash;
  return defs;
}

/** Ready-to-use SIMULATED definitions with sessions. */
export function simulatedSessionDefinitions(): Definitions {
  return parseDefinitions(simulatedSessionServerDefinitions());
}

/** The AlphaNet's recorded definitions (no sessions): enough for the quantum module. */
export function alphanetDefinitions(): Definitions {
  return parseDefinitions(alphanetServerDefinitions(), { requireSessions: false });
}

/**
 * The `server_definitions` of our standalone node with the `SigningSessions` amendment (N2 and N9
 * merged, `develop` 0882800), recorded by `spikes/k1-local.ts`'s setup: the node's own answer, not
 * SIMULATED. Prefer it to the simulated definitions in new tests.
 */
export function standaloneServerDefinitions(): ServerDefinitions {
  return asServerDefinitions(structuredClone(standalone));
}

export function standaloneDefinitions(): Definitions {
  return parseDefinitions(standaloneServerDefinitions());
}
