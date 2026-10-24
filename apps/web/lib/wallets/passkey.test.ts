import { describe, expect, it } from "vitest";
import { bytesToHex } from "@carbs/sessions";
import { p256 } from "@noble/curves/nist.js";
import { browserPasskeySource, createBrowserPasskey, softwarePasskeySource } from "./passkey";
import { createAppContext } from "../app-context";
import { createWalletAdapters } from "./adapters";
import { WEBHID_MESSAGE } from "../browser-support";

/** The 26-byte SubjectPublicKeyInfo header of an uncompressed P-256 key. */
const SPKI_HEADER = Uint8Array.of(
  0x30,
  0x59,
  0x30,
  0x13,
  0x06,
  0x07,
  0x2a,
  0x86,
  0x48,
  0xce,
  0x3d,
  0x02,
  0x01,
  0x06,
  0x08,
  0x2a,
  0x86,
  0x48,
  0xce,
  0x3d,
  0x03,
  0x01,
  0x07,
  0x03,
  0x42,
  0x00,
);

describe("browser passkey creation", () => {
  it("turns the SPKI of the browser's credential into the XRPL passkey key (0xF6 ‖ X ‖ Y)", async () => {
    const raw = p256.getPublicKey(p256.utils.randomSecretKey(), false);
    const spki = new Uint8Array([...SPKI_HEADER, ...raw]);
    let seenRp = "";
    const container = {
      async create(options?: CredentialCreationOptions) {
        seenRp = options?.publicKey?.rp.id ?? "";
        return {
          rawId: new Uint8Array(16).fill(7).buffer,
          response: { getPublicKey: () => spki.buffer },
        };
      },
    } as unknown as CredentialsContainer;
    const key = await createBrowserPasskey(container, { id: "carbs.example", name: "carbs" });
    expect(seenRp).toBe("carbs.example");
    expect(key.algorithm).toBe("p256");
    expect(key.publicKey).toBe(`F6${bytesToHex(raw.subarray(1))}`);
  });

  it("refuses an authenticator that returns no key", async () => {
    const container = {
      async create() {
        return { response: {} };
      },
    } as unknown as CredentialsContainer;
    await expect(createBrowserPasskey(container, { id: "x", name: "x" })).rejects.toThrow(
      /no P-256/,
    );
  });

  it("is unavailable where the browser has no WebAuthn, and never prompts on its own", () => {
    expect(browserPasskeySource().available()).toBe(false);
    expect(browserPasskeySource().simulated).toBe(false);
    expect(softwarePasskeySource().simulated).toBe(true);
  });
});

describe("Ledger Stax availability", () => {
  it("needs WebHID on a live backend, not on the simulated one", async () => {
    const ctx = createAppContext();
    const simulated = createWalletAdapters(
      { backend: ctx.backend, demo: ctx.demo, network: ctx.network },
      softwarePasskeySource(),
    );
    expect(await simulated[0]?.isAvailable()).toBe(true);
    Reflect.deleteProperty(navigator, "hid");
    const live = createWalletAdapters(
      {
        backend: { ...ctx.backend, device: { ...ctx.backend.device, mode: "live" } },
        demo: ctx.demo,
        network: ctx.network,
      },
      softwarePasskeySource(),
    );
    expect(await live[0]?.isAvailable()).toBe(false);
    expect(WEBHID_MESSAGE).toContain("Use Chrome");
  });
});
