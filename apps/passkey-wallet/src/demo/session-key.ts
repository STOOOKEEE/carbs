// The algorithm of the agent's session key, as the agent announces it on the stage timeline:
// its first event carries one of these codes, read by the demo page for the Agent ID badge
// and the header claim. Pure module, shared by the agent script and the page.

export type SessionKeyAlgorithm = "ml-dsa-44" | "secp256k1";

/** The event code that announces the algorithm (fits the timeline's code pattern). */
export const SESSION_KEY_CODES: Record<SessionKeyAlgorithm, string> = {
  "ml-dsa-44": "SESSION_KEY_ML_DSA_44",
  secp256k1: "SESSION_KEY_SECP256K1",
};

/** How the page and the console name it. */
export const SESSION_KEY_LABELS: Record<SessionKeyAlgorithm, string> = {
  "ml-dsa-44": "ML-DSA-44",
  secp256k1: "secp256k1",
};

/** The algorithm an event code announces; undefined for any other code. */
export function sessionKeyAlgorithmOf(code: string | undefined): SessionKeyAlgorithm | undefined {
  if (code === SESSION_KEY_CODES["ml-dsa-44"]) return "ml-dsa-44";
  if (code === SESSION_KEY_CODES.secp256k1) return "secp256k1";
  return undefined;
}
