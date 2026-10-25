// The page's side of the provider (server/stream.ts): its address, and whether it still
// streams to this payer according to the payments it reads on the ledger.

import {
  type AccessAnswer,
  STREAM_ACCESS_PATH,
  STREAM_PROVIDER_PATH,
  isAccessAnswer,
  isProviderInfo,
} from "./contract.ts";

/** The provider answers 402 Payment Required, with the same body, when it holds the stream. */
const PAYMENT_REQUIRED = 402;

export async function fetchProviderAddress(): Promise<string> {
  const answer = await fetch(STREAM_PROVIDER_PATH);
  if (!answer.ok) throw new Error(`provider unavailable: ${answer.status} ${await answer.text()}`);
  const body: unknown = await answer.json();
  if (!isProviderInfo(body)) throw new Error("the provider answered without an address");
  return body.address;
}

export async function fetchAccess(payer: string, sinceLedger: number): Promise<AccessAnswer> {
  const query = new URLSearchParams({ payer, since: String(sinceLedger) });
  const answer = await fetch(`${STREAM_ACCESS_PATH}?${query.toString()}`);
  if (!answer.ok && answer.status !== PAYMENT_REQUIRED)
    throw new Error(`provider meter unavailable: ${answer.status} ${await answer.text()}`);
  const body: unknown = await answer.json();
  if (!isAccessAnswer(body)) throw new Error("the provider's meter answer is incomplete");
  return body;
}
