/**
 * SIMULATED Ledger Stax. It follows the screen lines of spec 7.3 for the session
 * transactions; the lines for SetRegularKey, AccountSet and Payment are plausible
 * stand-ins until the device track freezes them. It signs with the simulated keys of
 * keys.ts, so nothing here proves anything about the real device.
 */
import { formatDuration, formatXrp } from "../format";
import { ASF_DISABLE_MASTER, TF_ALL_TRANSACTIONS } from "../constants";
import {
  DeviceRejectedError,
  type DeviceApprover,
  type DeviceKey,
  type DevicePort,
  type DeviceReview,
  type TxJson,
} from "../ports";
import { KEY_BYTES, accountIdOf, signWith, simPublicKey } from "./keys";

const NOTE = "Cannot change keys, signers or the account";

function fee(tx: TxJson): { label: string; value: string } {
  return { label: "Fee", value: `${tx.Fee} drops` };
}

export function reviewTransaction(tx: TxJson): DeviceReview {
  const base = { simulated: true };
  switch (tx.TransactionType) {
    case "SigningSessionSet": {
      const lines: { label: string; value: string }[] = [
        { label: "Transaction type", value: "Open session" },
        { label: "Account", value: tx.Account },
        { label: "Session key", value: String(tx.SessionKey) },
        { label: "Valid for", value: formatDuration(Number(tx.SessionDuration)) },
        fee(tx),
      ];
      if (Array.isArray(tx.Permissions)) {
        for (const permission of tx.Permissions as string[]) {
          lines.push({ label: "Allows", value: permission });
        }
      } else if (tx.SessionCap !== undefined) {
        lines.push({ label: "Max spend", value: formatXrp(Number(tx.SessionCap)) });
      } else if (((tx.Flags ?? 0) & TF_ALL_TRANSACTIONS) !== 0) {
        lines.push({ label: "Allows", value: "All transactions" });
      }
      lines.push({ label: "Note", value: NOTE });
      return { title: "Open session?", lines, ...base };
    }
    case "SigningSessionDelete":
      return {
        title: "Close session?",
        lines: [
          { label: "Transaction type", value: "Close session" },
          { label: "Account", value: tx.Account },
          { label: "Session key", value: String(tx.SessionKey) },
          fee(tx),
        ],
        ...base,
      };
    case "SetRegularKey":
      return {
        title: "Set regular key?",
        lines: [
          { label: "Transaction type", value: "Set regular key" },
          { label: "Account", value: tx.Account },
          { label: "Regular key", value: String(tx.RegularKey ?? "(none)") },
          fee(tx),
        ],
        ...base,
      };
    case "AccountSet":
      return {
        title: "Account settings?",
        lines: [
          { label: "Transaction type", value: "Account settings" },
          { label: "Account", value: tx.Account },
          {
            label: "Change",
            value: tx.SetFlag === ASF_DISABLE_MASTER ? "Disable master key" : "No change",
          },
          fee(tx),
        ],
        ...base,
      };
    case "Payment":
      return {
        title: "Send payment?",
        lines: [
          { label: "Transaction type", value: "Payment" },
          { label: "Account", value: tx.Account },
          { label: "Destination", value: String(tx.Destination) },
          { label: "Amount", value: isDrops(tx.Amount) ? formatXrp(Number(tx.Amount)) : "(token)" },
          fee(tx),
        ],
        ...base,
      };
    default:
      return {
        title: "Blind signing required",
        lines: [
          { label: "Transaction type", value: tx.TransactionType },
          { label: "Account", value: tx.Account },
          { label: "Note", value: "This type has no clear-signing screen" },
          fee(tx),
        ],
        ...base,
      };
  }
}

function isDrops(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

export class SimulatedDevice implements DevicePort {
  readonly mode = "simulated" as const;
  readonly model = "SIMULATED Ledger Stax";
  private approver: DeviceApprover;
  private generation = 0;

  constructor(approver: DeviceApprover = async () => true) {
    this.approver = approver;
  }

  /** The UI registers the modal that shows the review. */
  setApprover(approver: DeviceApprover): void {
    this.approver = approver;
  }

  reset(): void {
    this.generation += 1;
  }

  async getPublicKey(algorithm: DeviceKey["algorithm"]): Promise<DeviceKey> {
    const publicKey = simPublicKey(algorithm, `device:${this.generation}`);
    return {
      algorithm,
      publicKey,
      address: accountIdOf(publicKey),
      publicKeyBytes: KEY_BYTES[algorithm],
    };
  }

  review(tx: TxJson): DeviceReview {
    return reviewTransaction(tx);
  }

  async signTransaction(algorithm: DeviceKey["algorithm"], tx: TxJson): Promise<TxJson> {
    const key = await this.getPublicKey(algorithm);
    const approved = await this.approver(this.review(tx));
    if (!approved) throw new DeviceRejectedError();
    return signWith(key.publicKey, tx);
  }
}
