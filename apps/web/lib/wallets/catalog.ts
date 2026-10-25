/**
 * What the wallet entry shows for each adapter: the key type, who signs what, and which
 * parts are SIMULATED. Written once here so the modal, the tests and the docs agree.
 */

export type WalletId = "ledger-stax" | "passkey-mac" | "demo-account";

/** A part of the setup that can be simulated. */
export type SimulatedPart = "node" | "device" | "authenticator" | "account";

export interface WalletDescription {
  id: WalletId;
  name: string;
  /** The key type of the account's own authority. */
  keyType: string;
  /** Who signs what, one line each. */
  signs: readonly string[];
  /** One sentence for the modal. */
  summary: string;
  /** Parts that are real when the backend is live; SIMULATED while it is not. */
  simulatedWhenBackendSimulated: readonly SimulatedPart[];
  /** Parts that are SIMULATED whatever the backend, until a real flow exists. */
  alwaysSimulated: readonly SimulatedPart[];
}

export const LEDGER_STAX: WalletDescription = {
  id: "ledger-stax",
  name: "Ledger Stax",
  keyType: "ML-DSA-44 root key (post-quantum) plus the device's secp256k1 master key",
  signs: [
    "Master key (secp256k1, on the device): SetRegularKey and asfDisableMaster, during setup",
    "ML-DSA-44 key (on the device): everything the account's own authority signs, sessions included",
    "Session key (ML-DSA-44, made in the page): the transactions inside its session, no prompt",
  ],
  summary:
    "Post-quantum root. Every own-authority transaction is read and confirmed on the device, through the Device Management Kit.",
  simulatedWhenBackendSimulated: ["node"],
  // The device part follows the chosen device (`simulatedParts`): simulated double or real Stax.
  alwaysSimulated: [],
};

export const PASSKEY_MAC: WalletDescription = {
  id: "passkey-mac",
  name: "Passkey (this Mac)",
  keyType: "P-256 passkey (WebAuthn); not post-quantum",
  signs: [
    "Master key (secp256k1, in the page): PasskeyListSet, once, during setup",
    "Passkey (Touch ID or Face ID): opens sessions and signs what the account's own authority signs",
    "Session key (P-256, non-extractible): the transactions inside its session, no prompt",
  ],
  summary:
    "A passkey has full authority and cannot be replaced or removed once registered, so this account is not post-quantum.",
  simulatedWhenBackendSimulated: ["node"],
  alwaysSimulated: [],
};

export const DEMO_ACCOUNT: WalletDescription = {
  id: "demo-account",
  name: "Demo account",
  keyType: "secp256k1 master key, in memory, thrown away on reload",
  signs: [
    "Master key (in the page): everything the account's own authority signs",
    "Session key (P-256): the transactions inside its session, no prompt",
  ],
  summary: "A throw-away account to try the screens. Nothing is kept.",
  // On a live node the account is real (funded by its faucet); only its key is thrown away.
  simulatedWhenBackendSimulated: ["node", "account"],
  alwaysSimulated: [],
};

export const WALLET_DESCRIPTIONS: readonly WalletDescription[] = [
  LEDGER_STAX,
  PASSKEY_MAC,
  DEMO_ACCOUNT,
];

const PART_ORDER: readonly SimulatedPart[] = ["node", "device", "authenticator", "account"];

/**
 * The parts that are SIMULATED for `description`, given the backend mode, the passkey's
 * authenticator and the device (the simulated double or a real Stax over USB).
 */
export function simulatedParts(
  description: WalletDescription,
  backendSimulated: boolean,
  authenticatorSimulated = false,
  deviceSimulated = true,
): SimulatedPart[] {
  const parts = new Set<SimulatedPart>(description.alwaysSimulated);
  if (backendSimulated)
    for (const part of description.simulatedWhenBackendSimulated) parts.add(part);
  if (description.id === "passkey-mac" && authenticatorSimulated) parts.add("authenticator");
  if (description.id === "ledger-stax" && deviceSimulated) parts.add("device");
  return PART_ORDER.filter((part) => parts.has(part));
}

export const PART_LABELS: Record<SimulatedPart, string> = {
  node: "node",
  device: "Stax",
  authenticator: "passkey",
  account: "account",
};
