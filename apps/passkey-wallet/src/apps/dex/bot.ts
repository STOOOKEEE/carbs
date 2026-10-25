// The grid bot: every ledger it moves the reference price, checks which of its offers are still
// on the book, and re-quotes the rung that needs it with one OfferCreate (OfferSequence cancels
// the old offer in the same transaction). Signed by the session key alone, no prompt.

import type { Connection } from "../../account.ts";
import { REFERENCE_PRICE_USD, type Market } from "./api.ts";
import { readOwnOffers } from "./book.ts";
import { type LiveRung, driftReference, nextRequote } from "./grid.ts";
import { type Quote, offerCancelTx, offerCreateTx } from "./offers.ts";
import type { SessionSigner, SessionTxResult } from "./session-key.ts";

/** One ledger: the bot waits this long when its ladder is up to date, or after an error. */
const IDLE_TICK_MS = 3_000;
const SUCCESS = "tesSUCCESS";
/** Results after which the session key cannot do anything more: the bot stops. */
const FINAL_RESULTS: readonly string[] = ["tefSESSION_EXPIRED", "tefSESSION_LIMIT", "tefBAD_AUTH"];

export interface BotEvents {
  onQuote: (quote: Quote, result: SessionTxResult) => void;
  onStop: (result: string) => void;
  onError: (error: unknown) => void;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export class GridBot {
  private readonly connection: Connection;
  private readonly market: Market;
  private readonly signer: SessionSigner;
  /** Ripple-epoch seconds: every quote dies with the session, even if the page is gone. */
  private readonly expiration: number | undefined;
  private readonly events: BotEvents;
  private reference = REFERENCE_PRICE_USD;
  /** The bot's offers on the book, by rung. */
  private readonly live = new Map<string, LiveRung>();
  /** Every offer the bot created: what the close cancels. */
  private readonly placed = new Set<number>();
  private running = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    connection: Connection,
    market: Market,
    signer: SessionSigner,
    expiration: number | undefined,
    events: BotEvents,
  ) {
    this.connection = connection;
    this.market = market;
    this.signer = signer;
    this.expiration = expiration;
    this.events = events;
  }

  get referencePrice(): number {
    return this.reference;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  /** Stops after the current step: no quote is sent once this resolves. */
  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  /** Cancels the bot's offers still on the book, one OfferCancel each (stop the bot first). */
  async cancelAll(): Promise<SessionTxResult[]> {
    const own = await readOwnOffers(this.connection, this.market, this.signer.owner);
    const results: SessionTxResult[] = [];
    for (const sequence of this.placed) {
      if (!own.has(sequence)) continue;
      results.push(await this.signer.submit(offerCancelTx(this.signer.owner, sequence)));
    }
    this.live.clear();
    return results;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let quoted = false;
      try {
        quoted = await this.step();
      } catch (error) {
        this.events.onError(error);
      }
      if (!quoted && this.running) await delay(IDLE_TICK_MS);
    }
  }

  /** Forgets the rungs whose offer left the book (filled or expired), notes partial fills. */
  private async syncLive(): Promise<void> {
    const own = await readOwnOffers(this.connection, this.market, this.signer.owner);
    for (const [rung, offer] of this.live) {
      const onBook = own.get(offer.sequence);
      if (onBook === undefined) this.live.delete(rung);
      else offer.sizeXrp = onBook.sizeXrp;
    }
  }

  /** One re-quote at most; false when the ladder was already up to date. */
  private async step(): Promise<boolean> {
    this.reference = driftReference(this.reference, Math.random());
    await this.syncLive();
    const requote = nextRequote(this.reference, this.live);
    if (requote === undefined || !this.running) return false;
    const tx = offerCreateTx(this.signer.owner, this.market, requote.quote, {
      ...(requote.replaces === undefined ? {} : { replaces: requote.replaces }),
      ...(this.expiration === undefined ? {} : { expiration: this.expiration }),
    });
    const result = await this.signer.submit(tx);
    this.events.onQuote(requote.quote, result);
    if (result.result === SUCCESS) {
      this.live.set(requote.rung.id, {
        sequence: result.sequence,
        priceUsd: requote.quote.priceUsd,
        sizeXrp: requote.quote.sizeXrp,
      });
      this.placed.add(result.sequence);
    }
    if (FINAL_RESULTS.includes(result.result)) {
      this.running = false;
      this.events.onStop(result.result);
    }
    return true;
  }
}
