// One shot, end to end: a Payment to the house signed by the session key and submitted at once
// (no prompt, no wait), a grid cell while it is pending, then the validated ledger's verdict:
// hit (the house pays the reward, followed to validation too), miss, or a refusal in red.

import type { Connection } from "../../account.ts";
import { paymentTx } from "../../session.ts";
import type { Aimed } from "./arena.ts";
import { claimShot } from "./api.ts";
import type { Fired, Gun } from "./gun.ts";
import { formatXrp, renderTally, tally, takeCell } from "./panel.ts";
import { explainRefusal, showRefusal } from "./refusals.ts";
import { isHit } from "./rules.ts";
import { readGameSession } from "./session-entry.ts";
import type { Tracker } from "./tracker.ts";
import { isAccepted } from "./xrpl.ts";

const SUCCESS = "tesSUCCESS";
/**
 * The house's reward carries autofill's LastLedgerSequence window (src/ledger.ts), opened after
 * the shot validated: it cannot validate later than this many ledgers after the shot's limit.
 */
const REWARD_LEDGER_WINDOW = 20;

/** An open game: the owner's account, the house, and the session key's signer. */
export interface Play {
  connection: Connection;
  owner: string;
  house: string;
  sessionKey: string;
  gun: Gun;
  tracker: Tracker;
}

/** The ledger's refusal of a session transaction, explained from the session entry. */
export async function reportRefusal(play: Play, code: string, amountXrp?: number): Promise<void> {
  const state = await readGameSession(play.connection, play.owner, play.sessionKey);
  showRefusal("ledger", code, explainRefusal(code, amountXrp, state));
}

async function payReward(play: Play, fired: Fired, aimed: Aimed): Promise<boolean> {
  const answer = await claimShot(fired.hash);
  if (!answer.hit) return false;
  aimed.visual.hit(`+${formatXrp(answer.rewardXrp)} XRP`);
  tally.hits += 1;
  renderTally();
  const reward = await play.tracker.watch(
    answer.rewardHash,
    fired.lastLedger + REWARD_LEDGER_WINDOW,
  );
  if (reward.kind === "validated" && reward.result === SUCCESS) {
    tally.wonXrp += answer.rewardXrp;
    renderTally();
  }
  return true;
}

/** From pending to the validated ledger's verdict. */
async function follow(play: Play, fired: Fired, aimed: Aimed): Promise<void> {
  const setCell = takeCell();
  tally.fired += 1;
  tally.pending += 1;
  renderTally();
  const outcome = await play.tracker.watch(fired.hash, fired.lastLedger);
  tally.pending -= 1;
  if (outcome.kind === "expired") {
    renderTally();
    setCell?.("expired");
    aimed.visual.miss("dropped");
    return;
  }
  tally.validated += 1;
  renderTally();
  aimed.visual.validated();
  if (outcome.result !== SUCCESS) {
    setCell?.("failed");
    aimed.visual.miss(outcome.result);
    return;
  }
  // The page rolls first so that a miss costs no call; the house rolls again before paying.
  const hit =
    (await isHit(fired.hash, outcome.ledgerHash, aimed.target)) &&
    (await payReward(play, fired, aimed));
  setCell?.(hit ? "hit" : "miss");
  if (!hit) aimed.visual.miss("miss");
}

/**
 * Fires a shot at the target's price (or `amountXrp`) and returns the node's preliminary result
 * as soon as it is submitted; the rest of the shot goes on, its errors handed to `onError`.
 */
export async function fireShot(
  play: Play,
  aimed: Aimed,
  onError: (error: unknown) => void,
  amountXrp: number = aimed.target.priceXrp,
): Promise<string> {
  let fired: Fired;
  try {
    fired = await play.gun({
      ...paymentTx(play.owner, play.house, amountXrp),
      DestinationTag: aimed.target.tag,
    });
  } catch (error) {
    aimed.visual.miss("error");
    throw error;
  }
  if (!isAccepted(fired.result)) {
    aimed.visual.refused(fired.result);
    await reportRefusal(play, fired.result, amountXrp);
    return fired.result;
  }
  follow(play, fired, aimed).catch(onError);
  return fired.result;
}
