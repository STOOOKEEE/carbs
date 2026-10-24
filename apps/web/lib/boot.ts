/**
 * Choosing the backend at page load. The simulation is always available; the live backend
 * needs a node that carries the amendment on its public port. When it cannot be reached or
 * does not serve the SigningSessions names, the page stays on the simulation and says why:
 * nothing silently pretends to be live.
 */
import { WebSocketClient, type NodeClient } from "@carbs/sessions";
import { reactive } from "vue";
import type { AppContext } from "./app-context";
import type { BackendChoice } from "./backend-choice";
import { createDemo } from "./demo";
import { createLiveBackend } from "./live/backend";
import type { PasskeySource } from "./wallets/adapters";

export interface BackendStatus {
  requested: BackendChoice;
  active: BackendChoice;
  /** Why the live backend was refused, when it was. */
  error: string | null;
  /** The node the live backend talks to. */
  target: string;
}

export interface BootOptions {
  requested: BackendChoice;
  passkeys: PasskeySource;
  clientFactory?: (url: string) => NodeClient;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the node before staying on the simulation. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} did not answer within ${ms / 1000} s`)),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The context to run on, and what happened. */
export async function chooseBackend(
  ctx: AppContext,
  options: BootOptions,
): Promise<{ ctx: AppContext; status: BackendStatus }> {
  const local = ctx.network.networks().local;
  const status: BackendStatus = reactive({
    requested: options.requested,
    active: "simulated",
    error: null,
    target: local.wss,
  });
  if (options.requested !== "live") return { ctx, status };

  const check = ctx.network.check();
  if (!check.ok) {
    status.error = check.reason ?? "The node URL cannot be used from this page";
    return { ctx, status };
  }
  try {
    const client = (options.clientFactory ?? ((url) => new WebSocketClient(url)))(local.wss);
    const backend = await withTimeout(
      createLiveBackend({
        client,
        network: () => ctx.network.networks().local,
        approver: () => (review) => ctx.prompt.approver(review),
        passkeys: options.passkeys,
        exposure: ctx.liveExposure,
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      }),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      local.wss,
    );
    status.active = "live";
    return { ctx: { ...ctx, backend, demo: createDemo(backend) }, status };
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
    return { ctx, status };
  }
}
