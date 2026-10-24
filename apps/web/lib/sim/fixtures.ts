/**
 * SIMULATED accounts for the Quantum screen: each shows one outcome of the exposure
 * check. Their histories are written here, not recorded from a network; the recorded
 * fixtures of spec 8.7 belong to packages/core (M2).
 */
import { accountIdOf, signWith, simPublicKey, simTxHash } from "./keys";
import type { SimulatedNode } from "./node";
import type { HistoryEntry, TxJson } from "../ports";

export interface Fixture {
  id: string;
  label: string;
  address: string;
  expected: "exposed" | "no-exposure-found" | "unknown";
}

function payment(account: string, pub: string, sequence: number, ledger: number): HistoryEntry {
  const tx: TxJson = signWith(pub, {
    TransactionType: "Payment",
    Account: account,
    Destination: accountIdOf("fixture:sink"),
    Amount: "1000000",
    Fee: "12",
    Sequence: sequence,
  });
  return { hash: simTxHash(tx), ledgerIndex: ledger, tx, result: "tesSUCCESS" };
}

export function seedFixtures(node: SimulatedNode): Fixture[] {
  const fixtures: Fixture[] = [];

  const exposedPub = simPublicKey("secp256k1", "fixture:exposed-master");
  const exposed = accountIdOf(exposedPub);
  node.seed({
    address: exposed,
    createdLedger: 500,
    history: [payment(exposed, exposedPub, 1, 520), payment(exposed, exposedPub, 2, 530)],
  });
  fixtures.push({
    id: "exposed-master",
    label: "Master key has signed",
    address: exposed,
    expected: "exposed",
  });

  const quiet = accountIdOf("fixture:never-signed");
  node.seed({ address: quiet, createdLedger: 500 });
  fixtures.push({
    id: "never-signed",
    label: "Funded, never signed",
    address: quiet,
    expected: "no-exposure-found",
  });

  const partial = accountIdOf("fixture:partial-history");
  node.seed({ address: partial, createdLedger: 500, historyMin: 900 });
  fixtures.push({
    id: "partial-history",
    label: "Node history is partial",
    address: partial,
    expected: "unknown",
  });

  const regPub = simPublicKey("secp256k1", "fixture:regular");
  const regular = accountIdOf("fixture:regular-account");
  node.seed({
    address: regular,
    createdLedger: 500,
    masterDisabled: true,
    regularKey: accountIdOf(regPub),
    history: [payment(regular, regPub, 1, 610)],
  });
  fixtures.push({
    id: "regular-key",
    label: "Regular key has signed",
    address: regular,
    expected: "exposed",
  });

  const signerPubs = [1, 2, 3].map((n) => simPublicKey("secp256k1", `fixture:signer-${n}`));
  const signers = signerPubs.map(accountIdOf);
  signers.forEach((address, index) => {
    const pub = signerPubs[index] ?? "";
    node.seed({
      address,
      createdLedger: 500,
      history: index < 2 ? [payment(address, pub, 1, 700 + index)] : [],
    });
  });
  const multisig = accountIdOf("fixture:multisig");
  node.seed({
    address: multisig,
    createdLedger: 500,
    signerList: { quorum: 2, entries: signers.map((account) => ({ account, weight: 1 })) },
  });
  fixtures.push({
    id: "multisig",
    label: "Signers at quorum",
    address: multisig,
    expected: "exposed",
  });

  return fixtures;
}
