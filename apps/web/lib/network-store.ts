import { reactive } from "vue";
import {
  DEFAULT_LOCAL_FAUCET,
  DEFAULT_LOCAL_WSS,
  DEFAULT_TEAM_FAUCET,
  DEFAULT_TEAM_WSS,
  LOCAL_URL_STORAGE_KEY,
  checkNodeUrl,
  createNetworks,
  localRpcFor,
  type AppNetwork,
  type NetworkId,
  type UrlCheck,
} from "./networks";
import type { LiveNodeChoice, NodeChoice } from "./node-choice";

/** Minimal storage surface, so tests can pass a fake (or none). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface NetworkStoreOptions {
  storage?: KeyValueStorage | null;
  /** `location.protocol` of the page: https forbids ws:// and http:// nodes but the loopback. */
  pageProtocol?: string;
  /** Default URL of the local node, from `NUXT_PUBLIC_LOCAL_NODE_URL`. */
  localWss?: string;
  /** The dev faucet of the local node, from `NUXT_PUBLIC_LOCAL_FAUCET_URL`. */
  localFaucet?: string;
  /** The team's node, from `NUXT_PUBLIC_TEAM_NODE_URL`. */
  teamWss?: string;
  /** The team's faucet, from `NUXT_PUBLIC_TEAM_FAUCET_URL`. */
  teamFaucet?: string;
}

function safeGet(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: KeyValueStorage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Storage can be blocked (private window): the choice then lasts for the page only.
  }
}

function safeRemove(storage: KeyValueStorage | null, key: string): void {
  try {
    storage?.removeItem?.(key);
  } catch {
    // Nothing to forget, or storage blocked.
  }
}

/**
 * The nodes the page knows (the local node, with a URL the person may change, and the team's),
 * and which one is in effect, as `lib/boot.ts` found it.
 */
export function createNetworkStore(options: NetworkStoreOptions = {}) {
  const storage = options.storage ?? null;
  const pageProtocol = options.pageProtocol ?? "http:";
  const defaultLocal = options.localWss ?? DEFAULT_LOCAL_WSS;
  const localFaucet = options.localFaucet ?? DEFAULT_LOCAL_FAUCET;
  const team = {
    wss: options.teamWss ?? DEFAULT_TEAM_WSS,
    faucet: options.teamFaucet ?? DEFAULT_TEAM_FAUCET,
  };

  const state = reactive({
    /** The node the screens run on; the simulation until a live node answered. */
    node: "simulated" as NodeChoice,
    localWss: safeGet(storage, LOCAL_URL_STORAGE_KEY) ?? defaultLocal,
  });

  function networks(): Record<NetworkId, AppNetwork> {
    return createNetworks(
      { wss: state.localWss, rpc: localRpcFor(state.localWss), faucet: localFaucet },
      team,
    );
  }

  function nodeNetwork(choice: LiveNodeChoice): AppNetwork {
    return networks()[choice];
  }

  return {
    state,
    pageProtocol,
    /** The local node's URL when nothing was typed. */
    defaultLocalWss: defaultLocal,
    networks,
    nodeNetwork,
    /**
     * The network the screens run on: the live node in effect, else the local node, which the
     * simulation stands in for.
     */
    selected(): AppNetwork {
      return nodeNetwork(state.node === "team" ? "team" : "local");
    },
    /** Whether the page can use that node's URL (https allows wss://, https:// and the loopback). */
    check(choice: LiveNodeChoice = "local"): UrlCheck {
      return checkNodeUrl(nodeNetwork(choice).wss, pageProtocol);
    },
    /**
     * Set the local node URL. An empty value goes back to the default. Returns the check; a URL
     * the page cannot use is neither kept nor saved.
     */
    setLocalWss(url: string): UrlCheck {
      const value = url.trim();
      if (value === "" || value === defaultLocal) {
        state.localWss = defaultLocal;
        safeRemove(storage, LOCAL_URL_STORAGE_KEY);
        return { ok: true, reason: null };
      }
      const result = checkNodeUrl(value, pageProtocol);
      if (!result.ok) return result;
      state.localWss = value;
      safeSet(storage, LOCAL_URL_STORAGE_KEY, value);
      return result;
    },
  };
}

export type NetworkStore = ReturnType<typeof createNetworkStore>;
