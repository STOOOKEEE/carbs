import { describe, expect, it } from "vitest";
import { addressFromPublicKey } from "./address.js";
import { kBlackholeAddress } from "./constants.js";
import { decodeTx } from "./encode.js";
import { classicSignerFromSeed, generateClassicSeed } from "./keys/classic.js";
import { SoftwareAuthenticator } from "./keys/passkey.js";
import type { NodeClient } from "./node.js";
import { buildPasskeyWallet, PasskeyWalletError, runPasskeyWallet } from "./passkey-wallet.js";
import { alphanetDefinitions } from "./testing/simulated-definitions.js";

const defs = alphanetDefinitions();

/** A scripted node: answers the reads, records each submitted transaction, gives `results` in turn. */
function scriptedNode(account: string, results: string[]) {
  const submitted: Record<string, unknown>[] = [];
  let sequence = 1;
  const node: NodeClient = {
    async request(method, params) {
      switch (method) {
        case "account_info":
          return {
            account_data: {
              Account: account,
              Sequence: sequence,
              Flags: 0,
              Balance: "100000000",
              OwnerCount: 0,
            },
          };
        case "server_info":
          return { info: { network_id: 24100 } };
        case "fee":
          return { drops: { base_fee: "10" }, ledger_current_index: 100 };
        case "submit": {
          const tx = decodeTx(String(params["tx_blob"]), defs);
          submitted.push(tx);
          const result = results[submitted.length - 1] ?? "tesSUCCESS";
          sequence += 1;
          return {
            engine_result: result,
            engine_result_code: 0,
            engine_result_message: "",
            accepted: true,
            tx_json: { hash: `H${submitted.length}` },
          };
        }
        case "tx": {
          const index = Number(String(params["transaction"]).slice(1)) - 1;
          return {
            validated: true,
            ledger_index: 101,
            meta: { TransactionResult: results[index] ?? "tesSUCCESS" },
          };
        }
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  };
  return { node, submitted };
}

describe("passkey wallet (SIMULATED software authenticator)", () => {
  const master = classicSignerFromSeed(generateClassicSeed());
  const account = addressFromPublicKey(master.publicKey);

  it("plans PasskeyListSet, a passkey proof, SetRegularKey to the blackhole, asfDisableMaster", () => {
    const authenticator = new SoftwareAuthenticator("https://localhost");
    const plan = buildPasskeyWallet(account, [authenticator.credential], defs);
    expect(plan.steps.map((s) => [s.kind, s.signer])).toEqual([
      ["passkey-list", "master"],
      ["passkey-proof", "passkey"],
      ["blackhole-regular-key", "master"],
      ["disable-master", "master"],
    ]);
    expect(plan.steps[2].tx).toMatchObject({ RegularKey: kBlackholeAddress });
    expect(plan.steps[3].tx).toMatchObject({ SetFlag: defs.accountSetFlag("asfDisableMaster") });
  });

  it("signs steps 1, 3, 4 with the master and step 2 through WebAuthn", async () => {
    const authenticator = new SoftwareAuthenticator("https://localhost");
    const plan = buildPasskeyWallet(account, [authenticator.credential], defs);
    const { node, submitted } = scriptedNode(account, []);
    const run = await runPasskeyWallet(plan, {
      node,
      defs,
      master,
      passkey: { credential: authenticator.credential, authenticator, rpId: "localhost" },
    });
    expect(run.completed).toBe(true);
    expect(submitted.map((t) => t["TransactionType"])).toEqual([
      "PasskeyListSet",
      "AccountSet",
      "SetRegularKey",
      "AccountSet",
    ]);
    expect(submitted[1]?.["PasskeySignature"]).toBeDefined();
    expect(submitted[1]?.["TxnSignature"]).toBeUndefined();
    for (const i of [0, 2, 3])
      expect(submitted[i]?.["SigningPubKey"]).toBe(
        Buffer.from(master.publicKey).toString("hex").toUpperCase(),
      );
  });

  it("never disables the master key when the passkey proof is refused", async () => {
    const authenticator = new SoftwareAuthenticator("https://localhost");
    const plan = buildPasskeyWallet(account, [authenticator.credential], defs);
    const { node, submitted } = scriptedNode(account, ["tesSUCCESS", "tefBAD_AUTH"]);
    const run = await runPasskeyWallet(plan, {
      node,
      defs,
      master,
      passkey: { credential: authenticator.credential, authenticator, rpId: "localhost" },
    });
    expect(run.completed).toBe(false);
    expect(submitted).toHaveLength(2);
  });

  it("refuses a signing passkey that is not in the list", async () => {
    const listed = new SoftwareAuthenticator("https://localhost");
    const other = new SoftwareAuthenticator("https://localhost");
    const plan = buildPasskeyWallet(account, [listed.credential], defs);
    const { node } = scriptedNode(account, []);
    await expect(
      runPasskeyWallet(plan, {
        node,
        defs,
        master,
        passkey: { credential: other.credential, authenticator: other, rpId: "localhost" },
      }),
    ).rejects.toThrow(PasskeyWalletError);
  });
});
