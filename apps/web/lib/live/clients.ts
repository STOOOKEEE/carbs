/**
 * Node clients and definitions for the live Quantum screen, on `@carbs/sessions`. The
 * definitions are loaded from the node's `server_definitions` (never the bundled xrpl.js
 * ones, which do not know types 130 and 131) and cached per network. Only public,
 * non-admin methods are used (`JsonRpcClient` refuses anything else), and it waits out a
 * public node's rate limit itself.
 */
import { JsonRpcClient, loadDefinitions, type Definitions, type NodeClient } from "@carbs/sessions";
import type { AppNetwork, NetworkId } from "../networks";
import type { NetworkName } from "../ports";

export type ClientFactory = (url: string) => NodeClient;

export interface LiveClients {
  client(network: NetworkName): NodeClient;
  /**
   * Definitions of the node. `requireSessions` (default false) refuses a node that does not
   * serve the SigningSessions names: the exposure check and the migration do not need them,
   * the session screens will.
   */
  definitions(network: NetworkName, requireSessions?: boolean): Promise<Definitions>;
}

/**
 * A browser sends a CORS preflight before a POST with `content-type: application/json`, and
 * the AlphaNet's RPC answers that preflight with 400 (checked 2026-10-24), so the page could
 * never read it. A POST with `text/plain` is a "simple" request: no preflight, and both nodes
 * answer it with `Access-Control-Allow-Origin: *`. rippled reads the body whatever its type.
 */
export function simpleRequestFetch(
  base: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return (input, init) =>
    base(input, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        "content-type": "text/plain",
      },
    });
}

const defaultFactory: ClientFactory = (url) => new JsonRpcClient(url, simpleRequestFetch());

/** JSON-RPC over HTTPS to the networks' public nodes (CORS allows the browser). */
export function createLiveClients(
  networks: () => Record<NetworkId, AppNetwork>,
  factory: ClientFactory = defaultFactory,
): LiveClients {
  const clients = new Map<string, NodeClient>();
  const definitions = new Map<string, Promise<Definitions>>();

  function client(network: NetworkName): NodeClient {
    const url = networks()[network].rpc;
    let existing = clients.get(url);
    if (existing === undefined) {
      existing = factory(url);
      clients.set(url, existing);
    }
    return existing;
  }

  return {
    client,
    definitions(network, requireSessions = false) {
      const key = `${networks()[network].rpc}#${requireSessions}`;
      let pending = definitions.get(key);
      if (pending === undefined) {
        pending = loadDefinitions(client(network), { requireSessions });
        // A failed load must not be cached: the next attempt asks again.
        pending.catch(() => definitions.delete(key));
        definitions.set(key, pending);
      }
      return pending;
    },
  };
}
