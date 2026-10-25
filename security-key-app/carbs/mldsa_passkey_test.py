#!/usr/bin/env python3
"""carbs: test the ML-DSA-44 passkeys of the Security Key app on a real device, over USB HID.

  make    authenticatorGetInfo, then authenticatorMakeCredential with only COSE algorithm -48
          (ML-DSA-44) in pubKeyCredParams; checks the AKP public key (1312 bytes) and the packed
          attestation, saves the credential to a JSON file, then runs `assert` with it.
  assert  authenticatorGetAssertion of a saved credential on a challenge (a test string, or the
          XRPL signing data `STX\\0 || fields` of a transaction with --challenge-hex); verifies the
          2420-byte ML-DSA-44 signature over authenticatorData || SHA-256(clientDataJSON) on the
          host (pure ML-DSA-44, empty context, dilithium-py), and prints the result in the XRPL
          PasskeySignature shape, with the raw 1312-byte key as SigningPubKey.
  selftest  the same parsing, verification and output with a software ML-DSA-44 authenticator
          (SIMULATED: no device), to check the script itself.

The device asks for approval on its screen for `make` and for `assert`.

Requirements (see CARBS.md): Python >= 3.9, `pip install fido2==1.2.0 dilithium-py==1.5.1`.
"""

import argparse
import base64
import hashlib
import json
import os
import struct
import sys

from dilithium_py.ml_dsa import ML_DSA_44

COSE_ALG_ML_DSA_44 = -48
COSE_ALG_ES256 = -7
COSE_KTY_AKP = 7
PUBLIC_KEY_SIZE = 1312
SIGNATURE_SIZE = 2420
FLAG_UP = 0x01
FLAG_UV = 0x04
FLAG_AT = 0x40
DEFAULT_RP = "carbs.test"
DEFAULT_CHALLENGE = b"carbs ML-DSA-44 passkey test"


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def client_data_json(challenge, rp_id, kind):
    # Same shape as the browser's and as @carbs/core's software authenticator.
    return json.dumps(
        {
            "type": kind,
            "challenge": b64url(challenge),
            "origin": "https://" + rp_id,
            "crossOrigin": False,
        },
        separators=(",", ":"),
    ).encode()


def check_akp_key(cose):
    """The COSE key of an ML-DSA-44 credential: {1: 7, 3: -48, -1: 1312 bytes}, nothing else."""
    cose = dict(cose)
    if set(cose.keys()) != {1, 3, -1}:
        raise SystemExit("unexpected COSE key parameters: %r" % sorted(cose.keys()))
    if cose[1] != COSE_KTY_AKP or cose[3] != COSE_ALG_ML_DSA_44:
        raise SystemExit("not an ML-DSA-44 AKP key: kty %r alg %r" % (cose[1], cose[3]))
    pub = bytes(cose[-1])
    if len(pub) != PUBLIC_KEY_SIZE:
        raise SystemExit("public key of %d bytes, expected %d" % (len(pub), PUBLIC_KEY_SIZE))
    return pub


def verify_assertion(public_key, auth_data, cdj, signature, rp_id):
    """Checks everything the host can check and returns the signed message."""
    if len(signature) != SIGNATURE_SIZE:
        raise SystemExit("signature of %d bytes, expected %d" % (len(signature), SIGNATURE_SIZE))
    if auth_data[:32] != hashlib.sha256(rp_id.encode()).digest():
        raise SystemExit("authenticatorData does not start with SHA-256(rpId)")
    if not auth_data[32] & FLAG_UP:
        raise SystemExit("user presence flag not set")
    message = bytes(auth_data) + hashlib.sha256(cdj).digest()
    if not ML_DSA_44.verify(public_key, message, signature, ctx=b""):
        raise SystemExit("ML-DSA-44 signature does NOT verify")
    # A signature over anything else must fail, or the check above proves nothing.
    tampered = bytearray(message)
    tampered[-1] ^= 1
    if ML_DSA_44.verify(public_key, bytes(tampered), signature, ctx=b""):
        raise SystemExit("verification accepts a tampered message: the verifier is broken")
    return message


def print_xrpl(public_key, credential_id, auth_data, cdj, signature, counter, out=None):
    print("ML-DSA-44 signature verified on the host (pure ML-DSA-44, empty context).")
    print("signCount %d, flags 0x%02x" % (counter, auth_data[32]))
    text = json.dumps(
        {
            "SigningPubKey": public_key.hex().upper(),
            "PasskeySignature": {
                "PasskeyID": credential_id.hex().upper(),
                "AuthenticatorData": bytes(auth_data).hex().upper(),
                "ClientDataJSON": cdj.hex().upper(),
                "Signature": signature.hex().upper(),
            },
        },
        indent=2,
    )
    print(text)
    if out:
        with open(out, "w") as f:
            f.write(text + "\n")
        print("saved", out)


def open_device():
    from fido2.ctap2 import Ctap2
    from fido2.hid import CtapHidDevice

    devices = list(CtapHidDevice.list_devices())
    if not devices:
        raise SystemExit(
            "no FIDO HID device: connect the Ledger, unlock it and open the Security Key app"
        )
    for dev in devices:
        print("device:", dev.descriptor.product_name, "(%s)" % dev.descriptor.path)
    dev = devices[0]
    try:
        return Ctap2(dev)
    except Exception as error:  # the dashboard answers FIDO HID without CTAP2
        raise SystemExit("no CTAP2 on %s (%s): open the Security Key app" % (dev, error))


def pin_param(ctap, pin, client_data_hash, permissions=None):
    if not pin:
        return {}
    from fido2.ctap2.pin import ClientPin, PinProtocolV1

    protocol = PinProtocolV1()
    token = ClientPin(ctap, protocol).get_pin_token(pin)
    return {
        "pin_uv_param": protocol.authenticate(token, client_data_hash),
        "pin_uv_protocol": protocol.VERSION,
    }


def keepalive(_status):
    sys.stdout.write(".")
    sys.stdout.flush()


def cmd_make(args):
    ctap = open_device()
    info = ctap.info
    print("getInfo versions %s, algorithms %s" % (info.versions, info.algorithms))
    if not info.algorithms or not any(a.get("alg") == COSE_ALG_ML_DSA_44 for a in info.algorithms):
        raise SystemExit("the app on the device does not list ML-DSA-44 (-48): not the carbs build?")

    cdj = client_data_json(os.urandom(32), args.rp, "webauthn.create")
    cdh = hashlib.sha256(cdj).digest()
    print("makeCredential (ML-DSA-44): approve the registration on the device", end="")
    sys.stdout.flush()
    att = ctap.make_credential(
        cdh,
        {"id": args.rp, "name": "carbs"},
        {"id": b"carbs-" + os.urandom(8), "name": "carbs ML-DSA-44", "displayName": "carbs"},
        [{"type": "public-key", "alg": COSE_ALG_ML_DSA_44}],
        on_keepalive=keepalive,
        **pin_param(ctap, args.pin, cdh),
    )
    print()
    auth_data = att.auth_data
    cred = auth_data.credential_data
    if not auth_data.flags & FLAG_AT or cred is None:
        raise SystemExit("no attested credential data")
    public_key = check_akp_key(cred.public_key)
    credential_id = bytes(cred.credential_id)
    print("credential ID (%d bytes) %s" % (len(credential_id), credential_id.hex()))
    print("ML-DSA-44 public key (%d bytes) %s" % (len(public_key), public_key.hex()))
    check_attestation(att, cdh)

    with open(args.credential, "w") as out:
        json.dump(
            {
                "rpId": args.rp,
                "credentialId": credential_id.hex(),
                "publicKey": public_key.hex(),
            },
            out,
            indent=2,
        )
    print("saved", args.credential)
    if args.dump_attestation:
        dump_attestation(args.dump_attestation, att, args.rp, credential_id, public_key)
    run_assert(ctap, args.rp, credential_id, public_key, args)


def dump_attestation(path, att, rp_id, credential_id, public_key):
    """The registration as a browser hands it to the page, for the TypeScript parser's fixture.

    `attestationObject` is the WebAuthn form `{"fmt", "attStmt", "authData"}` (text keys), which a
    browser builds from the CTAP2 response's members 1, 3 and 2: `authData` is the device's own
    bytes, unchanged; `fmt` and `attStmt` are re-encoded here (canonical CBOR, python-fido2), as a
    browser re-encodes them. `rawId` is the credential id. `publicKey` is python-fido2's reading of
    the COSE key, for the test to compare with its own.
    """
    from fido2 import cbor

    attestation_object = cbor.encode(
        {"fmt": att.fmt, "attStmt": att.att_stmt, "authData": bytes(att.auth_data)}
    )
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as out:
        json.dump(
            {
                "source": "Ledger Stax, Security Key app of carbs PR #109, mldsa_passkey_test.py make",
                "rpId": rp_id,
                "rawId": credential_id.hex(),
                "attestationObject": attestation_object.hex(),
                "publicKey": public_key.hex(),
            },
            out,
            indent=2,
        )
        out.write("\n")
    print("attestation dumped to", path)


def check_attestation(att, cdh):
    """Packed attestation by the device's ES256 key over authData || clientDataHash.

    The app always attests this way, for every algorithm, so anything else is a failure. A
    side-loaded build signs with the PUBLIC test attestation key of the app's repository
    (attestations/data/test), under Ledger's AAGUID: the check proves the response is
    consistent, not that it comes from a genuine Ledger (see CARBS.md).
    """
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec

    stmt = att.att_stmt
    if att.fmt != "packed" or stmt.get("alg") != COSE_ALG_ES256 or not stmt.get("x5c"):
        raise SystemExit(
            "attestation is not packed ES256 with a certificate: format %r alg %r"
            % (att.fmt, stmt.get("alg"))
        )
    cert = x509.load_der_x509_certificate(bytes(stmt["x5c"][0]))
    cert.public_key().verify(
        bytes(stmt["sig"]), bytes(att.auth_data) + cdh, ec.ECDSA(hashes.SHA256())
    )
    print("packed attestation verified (ES256)")
    print("  subject %s" % cert.subject.rfc4514_string())
    print("  issuer  %s" % cert.issuer.rfc4514_string())
    print("  AAGUID  %s" % bytes(att.auth_data.credential_data.aaguid).hex())
    # The test and production certificates carry the same names; tell them apart by content.
    der = bytes(stmt["x5c"][0])
    here = os.path.dirname(os.path.abspath(__file__))
    for env in ("test", "prod"):
        folder = os.path.join(here, "..", "attestations", "data", env, "FIDO2")
        names = sorted(os.listdir(folder)) if os.path.isdir(folder) else []
        for name in names:
            path = os.path.join(folder, name)
            if name.endswith("-cert.der") and open(path, "rb").read() == der:
                note = ""
                if env == "test":
                    note = "  (TEST key, public in the app's repository: not proof of a genuine Ledger)"
                print("  certificate: %s/FIDO2/%s%s" % (env, name, note))


def cmd_assert(args):
    with open(args.credential) as f:
        saved = json.load(f)
    ctap = open_device()
    run_assert(
        ctap,
        saved["rpId"],
        bytes.fromhex(saved["credentialId"]),
        bytes.fromhex(saved["publicKey"]),
        args,
    )


def challenge_of(args):
    return bytes.fromhex(args.challenge_hex) if args.challenge_hex else DEFAULT_CHALLENGE


def run_assert(ctap, rp_id, credential_id, public_key, args):
    challenge = challenge_of(args)
    cdj = client_data_json(challenge, rp_id, "webauthn.get")
    cdh = hashlib.sha256(cdj).digest()
    print("getAssertion: approve the login on the device", end="")
    sys.stdout.flush()
    assertion = ctap.get_assertion(
        rp_id,
        cdh,
        [{"type": "public-key", "id": credential_id}],
        on_keepalive=keepalive,
        **pin_param(ctap, args.pin, cdh),
    )
    print()
    auth_data = bytes(assertion.auth_data)
    signature = bytes(assertion.signature)
    if assertion.credential and bytes(assertion.credential["id"]) != credential_id:
        raise SystemExit("the assertion names another credential")
    verify_assertion(public_key, auth_data, cdj, signature, rp_id)
    counter = struct.unpack(">I", auth_data[33:37])[0]
    print_xrpl(public_key, credential_id, auth_data, cdj, signature, counter, args.out)


def cmd_selftest(args):
    """SIMULATED: a software ML-DSA-44 authenticator, no device."""
    print("SIMULATED authenticator (software ML-DSA-44), no device involved")
    rp_id = args.rp
    public_key, secret_key = ML_DSA_44.key_derive(hashlib.sha256(b"carbs selftest").digest())
    check_akp_key({1: COSE_KTY_AKP, 3: COSE_ALG_ML_DSA_44, -1: public_key})
    credential_id = hashlib.sha256(b"carbs selftest credential").digest()
    challenge = challenge_of(args)
    cdj = client_data_json(challenge, rp_id, "webauthn.get")
    auth_data = hashlib.sha256(rp_id.encode()).digest() + bytes([FLAG_UP | FLAG_UV]) + (7).to_bytes(4, "big")
    signature = ML_DSA_44.sign(secret_key, auth_data + hashlib.sha256(cdj).digest(), ctx=b"")
    verify_assertion(public_key, auth_data, cdj, signature, rp_id)
    try:
        verify_assertion(public_key, auth_data, cdj, signature[:-1] + bytes([signature[-1] ^ 1]), rp_id)
    except SystemExit:
        print("a corrupted signature is refused")
    else:
        raise SystemExit("a corrupted signature verified")
    print_xrpl(public_key, credential_id, auth_data, cdj, signature, 7, args.out)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["make", "assert", "selftest"])
    parser.add_argument("--rp", default=DEFAULT_RP, help="relying party id (default %(default)s)")
    parser.add_argument("--credential", default="mldsa-credential.json", help="credential file")
    parser.add_argument("--challenge-hex", help="challenge bytes in hex (e.g. XRPL signing data)")
    parser.add_argument("--out", help="also write the PasskeySignature JSON to this file")
    parser.add_argument("--pin", help="the Security Key app's FIDO2 PIN, if one is set")
    parser.add_argument(
        "--dump-attestation",
        metavar="FILE",
        help="make: also write the raw attestationObject and rawId as hex JSON (TypeScript fixture)",
    )
    args = parser.parse_args()
    {"make": cmd_make, "assert": cmd_assert, "selftest": cmd_selftest}[args.command](args)


if __name__ == "__main__":
    main()
