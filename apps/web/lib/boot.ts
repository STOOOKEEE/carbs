/**
 * Choosing the node at page load. The simulation is always available; a live node (the local
 * one or the team's) must carry the amendment on its public port. When it cannot be reached
 * or does not serve the SigningSessions names, the page stays on the simulation and says why:
 * nothing silently pretends to be live.
 */
import { WebSocketClient, type NodeClient } from "@carbs/sessions";
import { reactive } from "vue";
import type { AppContext } from "./app-context";
import { createDemo } from "./demo";
import { createLiveBackend } from "./live/backend";
import { isLiveChoice, type NodeChoice } from "./node-choice";
import { NODE_TIMEOUT_MS, withTimeout } from "./timeout";
import type { PasskeySource } from "./wallets/adapters";

export interface BackendStatus {
  /** The node the person chose (saved in the browser, or the build's default). */
  requested: NodeChoice;
  /** The node the screens run on. */
  active: NodeChoice;
  /** Why the chosen live node was refused, when it was. */
  error: string | null;
  /** The URL of the chosen live node ("" for the simulation). */
  target: string;
}

export interface BootOptions {
  requested: NodeChoice;
  passkeys: PasskeySource;
  clientFactory?: (url: string) => NodeClient;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the node before staying on the simulation. */
  timeoutMs?: number;
}

/** The context to run on, and what happened. */
export async function chooseBackend(
  ctx: AppContext,
  options: BootOptions,
): Promise<{ ctx: AppContext; status: BackendStatus }> {
  const requested = options.requested;
  const status: BackendStatus = reactive({
    requested,
    active: "simulated",
    error: null,
    target: "",
  });
  ctx.network.state.node = "simulated";
  if (!isLiveChoice(requested)) return { ctx, status };

  const network = () => ctx.network.nodeNetwork(requested);
  status.target = network().wss;
  const check = ctx.network.check(requested);
  if (!check.ok) {
    status.error = check.reason ?? "The node URL cannot be used from this page";
    return { ctx, status };
  }
  try {
    const client = (options.clientFactory ?? ((url) => new WebSocketClient(url)))(status.target);
    const backend = await withTimeout(
      createLiveBackend({
        client,
        network,
        approver: () => (review) => ctx.prompt.approver(review),
        device: ctx.deviceSelection,
        passkeys: options.passkeys,
        exposure: ctx.liveExposure,
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      }),
      options.timeoutMs ?? NODE_TIMEOUT_MS,
      status.target,
    );
    status.active = requested;
    ctx.network.state.node = requested;
    return { ctx: { ...ctx, backend, demo: createDemo(backend) }, status };
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
    return { ctx, status };
  }
}
