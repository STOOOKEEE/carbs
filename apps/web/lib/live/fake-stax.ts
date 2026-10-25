/**
 * A TEST DOUBLE of a connected Ledger Stax for the real-device tests: the `LedgerDevice` that
 * `connectLedger()` would return, whose APDUs are answered by the contract-following software
 * device of `@carbs/ledger`. It records the instructions it receives, the reviews it was asked
 * to confirm and how many times it was closed.
 */
import { generateClassicSeed, type Definitions } from "@carbs/sessions";
import { SimulatedDevice, type LedgerDevice } from "@carbs/ledger";

const SEED_BYTES = 64;

export interface FakeStax {
  device: LedgerDevice;
  /** The contract device behind it (its keys, for the assertions). */
  contract: SimulatedDevice;
  /** The secp256k1 family seed behind the master key. */
  classicSeed: string;
  /** Instructions received, in order. */
  instructions: number[];
  /** Kinds of the reviews confirmed or refused on the "screen". */
  reviews: ("classic" | "ml-dsa")[];
  /** The answer the person gives on the device. */
  answer: { approve: boolean };
  closes: number;
}

export function fakeStax(defs: Definitions, seedByte = 1): FakeStax {
  const classicSeed = generateClassicSeed("ecdsa-secp256k1");
  const answer = { approve: true };
  const reviews: FakeStax["reviews"] = [];
  const instructions: number[] = [];
  const contract = new SimulatedDevice({
    defs,
    bip39Seed: new Uint8Array(SEED_BYTES).fill(seedByte),
    classicSeeds: { secp256k1: classicSeed, ed25519: generateClassicSeed("ed25519") },
    approve: async (_review, kind) => {
      reviews.push(kind);
      return answer.approve;
    },
  });
  const stax: FakeStax = {
    contract,
    classicSeed,
    instructions,
    reviews,
    answer,
    closes: 0,
    device: {
      exchange: (apdu) => {
        instructions.push(apdu.ins);
        return contract.exchange(apdu);
      },
      close: async () => {
        stax.closes += 1;
      },
    },
  };
  return stax;
}
