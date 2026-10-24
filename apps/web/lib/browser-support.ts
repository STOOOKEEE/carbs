/** WebHID is how the Device Management Kit reaches a Ledger. Brave and Firefox may not expose it. */
export function hasWebHid(nav: object | undefined = globalThis.navigator): boolean {
  if (nav === undefined) return false;
  const hid = (nav as { hid?: unknown }).hid;
  return hid !== undefined && hid !== null;
}

export const WEBHID_MESSAGE =
  "This browser does not expose WebHID, which a Ledger needs. Use Chrome (Brave and Firefox may not expose it).";
