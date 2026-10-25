#!/usr/bin/env python3
"""carbs: read the ML-DSA-44 public key of the XRP app (INS 0x10) and say whether it is the
key of the all-zero seed.

Builds before the SLIP-21 seed fix derived ML-DSA-44.KeyGen_internal(32 zero bytes) on every
device (docs/DEVLOG.md): a key whose secret anyone can compute. A fixed build derives the key
from the device's own SLIP-21 key, so it must NOT print "ZERO-SEED KEY".

  real device   the Stax over USB HID, unlocked, the XRP app open:
                  python ledger-app/carbs/pq_key_check.py
  Speculos      its APDU port (default 9999), labelled SPECULOS in the output:
                  python ledger-app/carbs/pq_key_check.py --speculos 127.0.0.1:9999

Exit status: 0 for a key that is not the zero-seed key, 2 for the zero-seed key, 1 on error.
Needs: pip install ledgerblue (USB only). No signing, no transaction, nothing is shown on the
device: INS 0x10 answers without a screen.
"""

import argparse
import hashlib
import socket
import struct
import sys

CLA = 0xE0
INS_PQ_GET_PUBLIC_KEY = 0x10
CHUNK = 250
PUBLIC_KEY_SIZE = 1312

# SHA-256 of the public key of ML-DSA-44.KeyGen_internal(32 zero bytes), computed with
# @noble/post-quantum 0.7.1 (ml_dsa44.keygen(new Uint8Array(32))); its AccountID is
# rDX7hJiDtUVUnN2tjRqswtuZcbE88yi9i2, the key the Stax returned before the fix.
ZERO_SEED_KEY_SHA256 = "EB4E7302842153B0FA19E8620739AD258AF4929C26DD89079A7EC7D4282208E1"
ZERO_SEED_ADDRESS = "rDX7hJiDtUVUnN2tjRqswtuZcbE88yi9i2"

XRPL_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz"


def xrpl_address(public_key):
    """Classic address of a key (RIPEMD-160 of SHA-256), or None without ripemd160."""
    try:
        account_id = hashlib.new("ripemd160", hashlib.sha256(public_key).digest()).digest()
    except ValueError:
        return None
    payload = b"\x00" + account_id
    checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    number = int.from_bytes(payload + checksum, "big")
    out = ""
    while number > 0:
        number, rest = divmod(number, 58)
        out = XRPL_ALPHABET[rest] + out
    leading = len(payload) - len(payload.lstrip(b"\x00"))
    return XRPL_ALPHABET[0] * leading + out


class Usb:
    label = "REAL DEVICE (USB)"

    def __init__(self):
        from ledgerblue.comm import getDongle

        self.dongle = getDongle(debug=False)

    def exchange(self, apdu):
        from ledgerblue.commException import CommException

        try:
            return bytes(self.dongle.exchange(apdu)), 0x9000
        except CommException as error:
            return b"", error.sw

    def close(self):
        self.dongle.close()


class Speculos:
    """Speculos' raw APDU port: 4-byte big-endian length, then the APDU; the answer is a
    4-byte length, the data, then the 2-byte status word."""

    label = "SPECULOS (simulated device)"

    def __init__(self, address):
        host, port = address.rsplit(":", 1)
        self.sock = socket.create_connection((host, int(port)), timeout=30)

    def _read(self, size):
        data = b""
        while len(data) < size:
            part = self.sock.recv(size - len(data))
            if not part:
                raise ConnectionError("Speculos closed the connection")
            data += part
        return data

    def exchange(self, apdu):
        self.sock.sendall(struct.pack(">I", len(apdu)) + apdu)
        size = struct.unpack(">I", self._read(4))[0]
        data = self._read(size)
        sw = struct.unpack(">H", self._read(2))[0]
        return data, sw

    def close(self):
        self.sock.close()


def read_public_key(transport):
    key = b""
    index = 0
    while len(key) < PUBLIC_KEY_SIZE:
        data, sw = transport.exchange(bytes([CLA, INS_PQ_GET_PUBLIC_KEY, index, 0x00, 0x00]))
        if sw != 0x9000:
            raise RuntimeError(f"INS 0x10 chunk {index}: status word 0x{sw:04X}")
        if not data or len(data) > CHUNK:
            raise RuntimeError(f"INS 0x10 chunk {index}: {len(data)} bytes")
        key += data
        index += 1
    if len(key) != PUBLIC_KEY_SIZE:
        raise RuntimeError(f"public key of {len(key)} bytes, expected {PUBLIC_KEY_SIZE}")
    return key


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--speculos", metavar="HOST:PORT", help="Speculos APDU port instead of USB")
    args = parser.parse_args()

    transport = Speculos(args.speculos) if args.speculos else Usb()
    try:
        key = read_public_key(transport)
    except Exception as error:  # noqa: BLE001 - one message for every failure
        print(f"{transport.label}: {error}", file=sys.stderr)
        return 1
    finally:
        transport.close()

    digest = hashlib.sha256(key).hexdigest().upper()
    address = xrpl_address(key)
    print(f"source:      {transport.label}")
    print(f"sha256(pk):  {digest}")
    print(f"address:     {address or '(no ripemd160 in this Python, address not computed)'}")
    if digest == ZERO_SEED_KEY_SHA256:
        print(f"result:      ZERO-SEED KEY ({ZERO_SEED_ADDRESS}): this build has the seed defect")
        return 2
    print("result:      not the zero-seed key")
    return 0


if __name__ == "__main__":
    sys.exit(main())
