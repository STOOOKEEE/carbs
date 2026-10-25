import { existsSync, readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  concatBytes,
  hexToBytes,
  utf8ToBytes,
} from "../bytes.js";
import { decodeCbor, encodeCbor, isCborMap, type CborValue } from "../cbor.js";
import { decodeTx, encodeForSigning, encodeTx, type TxJson } from "../encode.js";
import { standaloneDefinitions } from "../testing/simulated-definitions.js";
import { KeyError } from "./classic.js";
import { generateMlDsaSeed, mlDsaKeyPairFromSeed } from "./mldsa.js";
import {
  buildPasskeyListSet,
  signWithPasskey,
  SoftwareAuthenticator,
  type Authenticator,
  type WebAuthnAssertion,
} from "./passkey.js";
import {
  mlDsa44PublicKeyFromCose,
  mlDsaAssertionProblem,
  mlDsaPasskeyFromAttestation,
  parseAttestationObject,
  parseAuthenticatorData,
  signWithMlDsaPasskey,
  SoftwareMlDsaAuthenticator,
} from "./pq-passkey.js";
import { signWithMlDsaPasskeyForTests } from "../testing/index.js";

// The node's own recorded definitions (not SIMULATED); PasskeyMLDSA adds no field.
const defs = standaloneDefinitions();
const account = "rPV7gv7mxunHkt5wHniAmZZsiTH9CDdVZK";
const rpId = "localhost";
const origin = "https://localhost";
const payment: TxJson = {
  TransactionType: "Payment",
  Account: account,
  Destination: "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy",
  Amount: "1000000",
  Fee: "12",
  Sequence: 7,
  LastLedgerSequence: 500,
};

/** An authenticator that alters what a real one returned (a faulty or hostile device). */
function tampering(
  inner: Authenticator,
  change: (assertion: WebAuthnAssertion) => WebAuthnAssertion,
): Authenticator {
  return { getAssertion: async (request) => change(await inner.getAssertion(request)) };
}

function flipFirst(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  out[0] = (out[0] ?? 0) ^ 0x01;
  return out;
}

describe("COSE AKP keys (RFC 9964, alg -48)", () => {
  it("encodes the software key as {1: 7, 3: -48, -1: bstr(1312)} and reads it back", () => {
    const authenticator = new SoftwareMlDsaAuthenticator(origin);
    const cose = authenticator.coseKey();
    // a3 = map(3); 01 07 = kty: AKP; 03 38 2f = alg: -48; 20 59 0520 = -1: bytes(1312).
    expect(bytesToHex(cose.subarray(0, 10))).toBe("A301070338" + "2F20590520");
    expect(cose.length).toBe(10 + 1312);
    expect(bytesToHex(mlDsa44PublicKeyFromCose(cose))).toBe(
      bytesToHex(authenticator.credential.publicKey),
    );
  });

  it("refuses an ES256 key, ML-DSA-65, a wrong size, a private part, a non-map", () => {
    const pub = new Uint8Array(1312);
    const es256 = new Map<number, CborValue>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(32)],
      [-3, new Uint8Array(32)],
    ]);
    expect(() => mlDsa44PublicKeyFromCose(encodeCbor(es256))).toThrow(/kty is 2/);
    const akp = (entries: [number, CborValue][]) => encodeCbor(new Map(entries));
    expect(() =>
      mlDsa44PublicKeyFromCose(
        akp([
          [1, 7],
          [3, -49],
          [-1, pub],
        ]),
      ),
    ).toThrow(/alg is -49/);
    expect(() =>
      mlDsa44PublicKeyFromCose(
        akp([
          [1, 7],
          [3, -48],
          [-1, pub.subarray(1)],
        ]),
      ),
    ).toThrow(/1312-byte/);
    expect(() =>
      mlDsa44PublicKeyFromCose(
        akp([
          [1, 7],
          [3, -48],
          [-1, pub],
          [-2, new Uint8Array(32)],
        ]),
      ),
    ).toThrow(/private/);
    expect(() =>
      mlDsa44PublicKeyFromCose(
        akp([
          [1, 7],
          [3, -48],
        ]),
      ),
    ).toThrow(/pub/);
    expect(() => mlDsa44PublicKeyFromCose(encodeCbor([1, 7]))).toThrow(/not a CBOR map/);
    expect(() => mlDsa44PublicKeyFromCose(Uint8Array.of(0xa1))).toThrow(/COSE key/);
  });
});

describe("registration: attestationObject → PasskeyListSet", () => {
  it("parses the software registration into the credential id and the 1 312-byte key", () => {
    const authenticator = new SoftwareMlDsaAuthenticator(origin);
    const registration = authenticator.makeCredential(new Uint8Array(32), rpId);
    const { fmt, parsed } = parseAttestationObject(registration.attestationObject);
    expect(fmt).toBe("none");
    expect(parsed.flags & 0x40).toBe(0x40);
    expect(bytesToHex(parsed.rpIdHash)).toBe(bytesToHex(sha256(utf8ToBytes(rpId))));
    const passkey = mlDsaPasskeyFromAttestation(registration.attestationObject, {
      rawId: registration.rawId,
      rpId,
    });
    expect(bytesToHex(passkey.credentialId)).toBe(
      bytesToHex(authenticator.credential.credentialId),
    );
    expect(passkey.publicKey.length).toBe(1312);
    expect(bytesToHex(passkey.publicKey)).toBe(bytesToHex(authenticator.credential.publicKey));
    const clientData = JSON.parse(new TextDecoder().decode(registration.clientDataJSON)) as Record<
      string,
      unknown
    >;
    expect(clientData["type"]).toBe("webauthn.create");

    const tx = buildPasskeyListSet(account, [passkey]);
    expect(tx).toEqual({
      TransactionType: "PasskeyListSet",
      Account: account,
      Passkeys: [
        {
          Passkey: {
            PasskeyID: bytesToHex(passkey.credentialId),
            PublicKey: bytesToHex(passkey.publicKey),
          },
        },
      ],
    });
    // The node's codec takes it, and the 1 312-byte key survives the round trip.
    const decoded = decodeTx(
      // A PasskeyListSet as the master would sign it: any 33-byte key, any signature.
      encodeTx({ ...tx, Fee: "12", Sequence: 1, SigningPubKey: "02".padEnd(66, "0") }, defs),
      defs,
    );
    expect(decoded).toMatchObject({ Passkeys: tx["Passkeys"] });
  });

  // Synthetic: the shape PR #109's Security Key app returns (packed, ES256 statement, x5c), built
  // here around a software authData; the real device bytes are the fixture test below.
  it("parses a synthetic packed attestation with an ES256 statement (the Stax's shape)", () => {
    const authenticator = new SoftwareMlDsaAuthenticator(origin);
    const none = parseAttestationObject(
      authenticator.makeCredential(new Uint8Array(32), rpId).attestationObject,
    );
    const packed = encodeCbor(
      new Map<string, CborValue>([
        ["fmt", "packed"],
        [
          "attStmt",
          new Map<string, CborValue>([
            ["alg", -7],
            ["sig", new Uint8Array(71)],
            ["x5c", [new Uint8Array(400)]],
          ]),
        ],
        ["authData", none.authData],
      ]),
    );
    const passkey = mlDsaPasskeyFromAttestation(packed, { rpId });
    expect(bytesToHex(passkey.publicKey)).toBe(bytesToHex(authenticator.credential.publicKey));
  });

  it("refuses another rawId, another relying party, no attested credential, trailing bytes", () => {
    const authenticator = new SoftwareMlDsaAuthenticator(origin);
    const registration = authenticator.makeCredential(new Uint8Array(32), rpId);
    expect(() =>
      mlDsaPasskeyFromAttestation(registration.attestationObject, { rawId: new Uint8Array(16) }),
    ).toThrow(/rawId/);
    expect(() =>
      mlDsaPasskeyFromAttestation(registration.attestationObject, { rpId: "example.com" }),
    ).toThrow(/rpIdHash/);
    const { authData } = parseAttestationObject(registration.attestationObject);
    const assertionOnly = authData.slice(0, 37);
    assertionOnly[32] = 0x05;
    const noCredential = encodeCbor(
      new Map<string, CborValue>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", assertionOnly],
      ]),
    );
    expect(() => mlDsaPasskeyFromAttestation(noCredential)).toThrow(/AT flag/);
    expect(() => parseAuthenticatorData(concatBytes(authData, Uint8Array.of(0)))).toThrow(
      /trailing/,
    );
    expect(() => parseAuthenticatorData(authData.subarray(0, 36))).toThrow(/37/);
  });

  it("refuses no user presence, an empty or over-long credential id, unreadable extensions", () => {
    const authenticator = new SoftwareMlDsaAuthenticator(origin);
    const { authData } = parseAttestationObject(
      authenticator.makeCredential(new Uint8Array(32), rpId).attestationObject,
    );
    const wrap = (data: Uint8Array) =>
      encodeCbor(
        new Map<string, CborValue>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", data],
        ]),
      );
    const noUp = authData.slice();
    noUp[32] = (noUp[32] ?? 0) & ~0x01;
    expect(() => mlDsaPasskeyFromAttestation(wrap(noUp))).toThrow(/UP flag/);

    // rpIdHash 32 ‖ flags 1 ‖ counter 4 ‖ AAGUID 16 ‖ id length 2 (offset 53) ‖ id ‖ COSE key.
    const head = authData.subarray(0, 53);
    const cose = authenticator.coseKey();
    const withId = (length: number) =>
      concatBytes(head, Uint8Array.of(length >> 8, length & 0xff), new Uint8Array(length), cose);
    expect(() => parseAuthenticatorData(withId(0))).toThrow(/credential id length 0/);
    expect(() => parseAuthenticatorData(withId(1024))).toThrow(/credential id length 1024/);
    expect(parseAuthenticatorData(withId(1023)).attestedCredential?.credentialId.length).toBe(1023);

    const badExtensions = concatBytes(authData, Uint8Array.of(0xa1));
    badExtensions[32] = (badExtensions[32] ?? 0) | 0x80;
    expect(() => parseAuthenticatorData(badExtensions)).toThrow(KeyError);
    expect(() => parseAuthenticatorData(badExtensions)).toThrow(/unreadable extensions/);
    const badKey = concatBytes(head, Uint8Array.of(0, 1, 7), Uint8Array.of(0x5b, 0xff));
    expect(() => parseAuthenticatorData(badKey)).toThrow(KeyError);
  });

  // The real device's bytes: `security-key-app/carbs/mldsa_passkey_test.py make --dump-attestation
  // packages/core/src/keys/fixtures/stax-attestation.json` on the Stax. Until that file is recorded,
  // the TypeScript parser has never read a real attestationObject, and this test says so.
  const staxFixture = new URL("./fixtures/stax-attestation.json", import.meta.url);
  it.skipIf(!existsSync(staxFixture))(
    "parses the real Stax attestationObject recorded with mldsa_passkey_test.py (fixture)",
    () => {
      const recorded: unknown = JSON.parse(readFileSync(staxFixture, "utf8"));
      const field = (name: string): string => {
        const value: unknown =
          typeof recorded === "object" && recorded !== null
            ? Reflect.get(recorded, name)
            : undefined;
        if (typeof value !== "string") throw new Error(`fixture: no ${name}`);
        return value;
      };
      const attestationObject = hexToBytes(field("attestationObject"));
      const rawId = hexToBytes(field("rawId"));
      const { fmt } = parseAttestationObject(attestationObject);
      expect(fmt).toBe("packed");
      const passkey = mlDsaPasskeyFromAttestation(attestationObject, {
        rawId,
        rpId: field("rpId"),
      });
      expect(passkey.publicKey.length).toBe(1312);
      // python-fido2's reading of the same bytes, recorded next to them.
      expect(bytesToHex(passkey.publicKey)).toBe(field("publicKey").toUpperCase());
      expect(bytesToHex(passkey.credentialId)).toBe(field("rawId").toUpperCase());
    },
  );
  if (!existsSync(staxFixture)) {
    console.info(
      "pq-passkey.test.ts: no fixtures/stax-attestation.json, so no real device attestation was parsed (record it with mldsa_passkey_test.py make --dump-attestation)",
    );
  }

  it("reads the extensions after the COSE key when the ED flag is set", () => {
    const authenticator = new SoftwareMlDsaAuthenticator(origin);
    const { authData } = parseAttestationObject(
      authenticator.makeCredential(new Uint8Array(32), rpId).attestationObject,
    );
    const withExtensions = concatBytes(authData, encodeCbor(new Map([["credProtect", 1]])));
    withExtensions[32] = (withExtensions[32] ?? 0) | 0x80;
    const parsed = parseAuthenticatorData(withExtensions);
    expect(parsed.attestedCredential?.credentialPublicKey.length).toBe(1322);
    const extensions = parsed.extensions ? decodeCbor(parsed.extensions) : undefined;
    expect(extensions !== undefined && isCborMap(extensions) && extensions.get("credProtect")).toBe(
      1,
    );
  });
});

describe("signing: PasskeySignature with an ML-DSA-44 assertion (SIMULATED authenticator)", () => {
  it("builds what the node verifies: challenge = STX\\0 ‖ fields, pure ML-DSA-44 over authData ‖ SHA-256(clientDataJSON)", async () => {
    const authenticator = new SoftwareMlDsaAuthenticator(origin);
    const credential = authenticator.credential;
    const signed = await signWithMlDsaPasskey(payment, credential, authenticator, rpId, defs);
    const tx = signed.tx;
    expect(tx["TxnSignature"]).toBeUndefined();
    expect(tx["SigningPubKey"]).toBe(bytesToHex(credential.publicKey));
    const sig = tx["PasskeySignature"] as Record<string, string>;
    // PasskeyID is the id registered in the PasskeyListSet, as the node requires (tefBAD_AUTH otherwise).
    const list = buildPasskeyListSet(account, [credential]);
    const listed = (list["Passkeys"] as { Passkey: { PasskeyID: string } }[])[0]?.Passkey.PasskeyID;
    expect(sig["PasskeyID"]).toBe(listed);
    expect(sig["PasskeyID"]).toBe(bytesToHex(credential.credentialId));

    const clientDataJSON = hexToBytes(String(sig["ClientDataJSON"]));
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON)) as Record<
      string,
      string
    >;
    expect(clientData["type"]).toBe("webauthn.get");
    const signingData = encodeForSigning(tx, defs);
    expect(bytesToHex(signingData.subarray(0, 4))).toBe("53545800");
    // The signing data holds the 1 312-byte key, so it is about 1.4 KB.
    expect(signingData.length).toBeGreaterThan(1312);
    expect(String(clientData["challenge"])).toBe(base64UrlEncode(signingData));
    expect(String(clientData["challenge"])).not.toMatch(/[=+/]/);
    expect(bytesToHex(base64UrlDecode(String(clientData["challenge"])))).toBe(
      bytesToHex(signingData),
    );

    const signature = hexToBytes(String(sig["Signature"]));
    expect(signature.length).toBe(2420);
    const message = concatBytes(
      hexToBytes(String(sig["AuthenticatorData"])),
      sha256(clientDataJSON),
    );
    expect(ml_dsa44.verify(signature, message, credential.publicKey)).toBe(true);
    // Not with a context, not over the signing data itself, not with another key.
    expect(
      ml_dsa44.verify(signature, message, credential.publicKey, { context: Uint8Array.of(0) }),
    ).toBe(false);
    expect(ml_dsa44.verify(signature, signingData, credential.publicKey)).toBe(false);
    const other = mlDsaKeyPairFromSeed(generateMlDsaSeed()).publicKey;
    expect(ml_dsa44.verify(signature, message, other)).toBe(false);

    // The blob decodes to the same transaction; PasskeySignature is not a signing field.
    const decoded = decodeTx(signed.blob, defs);
    expect(decoded["PasskeySignature"]).toEqual(sig);
    expect(bytesToHex(encodeForSigning(decoded as TxJson, defs))).toBe(bytesToHex(signingData));
  });

  it("signWithPasskey routes an ML-DSA-44 credential to the ML-DSA path, a P-256 one to DER", async () => {
    const pq = new SoftwareMlDsaAuthenticator(origin);
    const viaGeneric = await signWithPasskey(payment, pq.credential, pq, rpId, defs);
    const sig = viaGeneric.tx["PasskeySignature"] as Record<string, string>;
    expect(hexToBytes(String(sig["Signature"])).length).toBe(2420);
    const p256 = new SoftwareAuthenticator(origin);
    const classical = await signWithPasskey(payment, p256.credential, p256, rpId, defs);
    const der = hexToBytes(
      String((classical.tx["PasskeySignature"] as Record<string, string>)["Signature"]),
    );
    expect(der[0]).toBe(0x30);
  });

  it("explains each assertion the node would refuse, and refuses to return one", async () => {
    const authenticator = new SoftwareMlDsaAuthenticator(origin);
    const credential = authenticator.credential;
    const unsigned: TxJson = { ...payment, SigningPubKey: bytesToHex(credential.publicKey) };
    const signingData = encodeForSigning(unsigned, defs);
    const good = await authenticator.getAssertion({
      challenge: signingData,
      credentialId: credential.credentialId,
      rpId,
    });
    expect(mlDsaAssertionProblem(good, signingData, credential.publicKey)).toBeUndefined();

    const withClientData = (json: string): WebAuthnAssertion => ({
      ...good,
      clientDataJSON: utf8ToBytes(json),
    });
    const cases: [string, WebAuthnAssertion, RegExp][] = [
      ["not JSON", withClientData("{"), /not JSON/],
      ["an array", withClientData("[]"), /not an object/],
      [
        "webauthn.create",
        withClientData(
          JSON.stringify({ type: "webauthn.create", challenge: base64UrlEncode(signingData) }),
        ),
        /type is webauthn.create/,
      ],
      ["no challenge", withClientData(JSON.stringify({ type: "webauthn.get" })), /not a string/],
      [
        "a challenge over other bytes",
        withClientData(
          JSON.stringify({
            type: "webauthn.get",
            challenge: base64UrlEncode(signingData.subarray(4)),
          }),
        ),
        /signing data/,
      ],
      [
        "an altered signature",
        { ...good, signature: flipFirst(good.signature) },
        /does not verify/,
      ],
      [
        "altered authenticatorData",
        { ...good, authenticatorData: flipFirst(good.authenticatorData) },
        /does not verify/,
      ],
      ["a truncated signature", { ...good, signature: good.signature.subarray(1) }, /2419 bytes/],
      [
        "an extended signature",
        { ...good, signature: concatBytes(good.signature, Uint8Array.of(0)) },
        /2421 bytes/,
      ],
    ];
    for (const [label, assertion, reason] of cases) {
      expect(mlDsaAssertionProblem(assertion, signingData, credential.publicKey), label).toMatch(
        reason,
      );
    }

    const faulty = tampering(authenticator, (a) => ({ ...a, signature: flipFirst(a.signature) }));
    await expect(signWithMlDsaPasskey(payment, credential, faulty, rpId, defs)).rejects.toThrow(
      /node would refuse.*does not verify/,
    );
    // verify: false (tests only) builds it anyway, for negative tests against a node.
    const unchecked = await signWithMlDsaPasskeyForTests(payment, credential, faulty, rpId, defs, {
      verify: false,
    });
    expect(unchecked.tx["PasskeySignature"]).toBeDefined();
  });

  it("writes another PasskeyID only when asked, and refuses a P-256 credential or Signers", async () => {
    const authenticator = new SoftwareMlDsaAuthenticator(origin);
    const otherId = Uint8Array.of(1, 2, 3);
    const signed = await signWithMlDsaPasskeyForTests(
      payment,
      authenticator.credential,
      authenticator,
      rpId,
      defs,
      { passkeyId: otherId },
    );
    // The public entry point always writes the credential's own id.
    const own = await signWithMlDsaPasskey(
      payment,
      authenticator.credential,
      authenticator,
      rpId,
      defs,
    );
    expect((own.tx["PasskeySignature"] as Record<string, string>)["PasskeyID"]).toBe(
      bytesToHex(authenticator.credential.credentialId),
    );
    expect((signed.tx["PasskeySignature"] as Record<string, string>)["PasskeyID"]).toBe("010203");
    const p256 = new SoftwareAuthenticator(origin);
    await expect(signWithMlDsaPasskey(payment, p256.credential, p256, rpId, defs)).rejects.toThrow(
      /1312/,
    );
    await expect(
      signWithMlDsaPasskey(
        { ...payment, Signers: [] },
        authenticator.credential,
        authenticator,
        rpId,
        defs,
      ),
    ).rejects.toThrow(/Signers/);
    await expect(
      authenticator.getAssertion({ challenge: new Uint8Array(1), credentialId: otherId, rpId }),
    ).rejects.toThrow(/unknown credential/);
  });

  it("lists P-256 and ML-DSA-44 passkeys together, and refuses any other key", () => {
    const pq = new SoftwareMlDsaAuthenticator(origin);
    const p256 = new SoftwareAuthenticator(origin);
    const tx = buildPasskeyListSet(account, [p256.credential, pq.credential]);
    expect((tx["Passkeys"] as unknown[]).length).toBe(2);
    expect(() =>
      buildPasskeyListSet(account, [
        { credentialId: Uint8Array.of(1), publicKey: new Uint8Array(33) },
      ]),
    ).toThrow(/P-256.*ML-DSA-44/);
    expect(() =>
      buildPasskeyListSet(account, [
        { credentialId: new Uint8Array(), publicKey: pq.credential.publicKey },
      ]),
    ).toThrow(/credential id/);
  });

  it("derives the same key from the same seed (a deterministic test authenticator)", () => {
    const seed = generateMlDsaSeed();
    const a = new SoftwareMlDsaAuthenticator(origin, seed);
    const b = new SoftwareMlDsaAuthenticator(origin, seed);
    expect(bytesToHex(a.credential.publicKey)).toBe(bytesToHex(b.credential.publicKey));
    expect(a.address).toMatch(/^r/);
  });
});
