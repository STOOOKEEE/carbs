import { reactive } from "vue";
import {
  DEFAULT_LOCAL_WSS,
  DEFAULT_NETWORK_ID,
  LOCAL_URL_STORAGE_KEY,
  NETWORK_STORAGE_KEY,
  SELECTABLE_NETWORK_IDS,
  checkNodeUrl,
  createNetworks,
  explorerTxUrl,
  isNetworkId,
  localRpcFor,
  type AppNetwork,
  type NetworkId,
  type UrlCheck,
} from "./networks";

/** Minimal storage surface, so tests can pass a fake (or none). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NetworkStoreOptions {
  storage?: KeyValueStorage | null;
  /** `location.protocol` of the page: https forbids ws:// and http:// nodes. */
  pageProtocol?: string;
  /** Default URL of the local node, from `NUXT_PUBLIC_LOCAL_NODE_URL`. */
  localWss?: string;
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

/** Which network the person chose, and the local node URL, with persistence. */
export function createNetworkStore(options: NetworkStoreOptions = {}) {
  const storage = options.storage ?? null;
  const pageProtocol = options.pageProtocol ?? "http:";
  const defaultLocal = options.localWss ?? DEFAULT_LOCAL_WSS;

  const saved = safeGet(storage, NETWORK_STORAGE_KEY);
  const savedId = saved !== null && isNetworkId(saved) && SELECTABLE_NETWORK_IDS.includes(saved);
  const state = reactive({
    selectedId: (savedId ? saved : DEFAULT_NETWORK_ID) as NetworkId,
    localWss: safeGet(storage, LOCAL_URL_STORAGE_KEY) ?? defaultLocal,
  });

  function check(): UrlCheck {
    return checkNodeUrl(state.localWss, pageProtocol);
  }

  function networks(): Record<NetworkId, AppNetwork> {
    return createNetworks({ wss: state.localWss, rpc: localRpcFor(state.localWss) });
  }

  return {
    state,
    /** The network in use. A local URL the page cannot use is refused, not silently kept. */
    selected(): AppNetwork {
      return networks()[state.selectedId];
    },
    networks,
    select(id: NetworkId): void {
      if (!SELECTABLE_NETWORK_IDS.includes(id)) return;
      state.selectedId = id;
      safeSet(storage, NETWORK_STORAGE_KEY, id);
    },
    /** Set the local node URL. Returns the check; an invalid URL is not saved. */
    setLocalWss(url: string): UrlCheck {
      const result = checkNodeUrl(url, pageProtocol);
      state.localWss = url;
      if (result.ok) safeSet(storage, LOCAL_URL_STORAGE_KEY, url);
      return result;
    },
    check,
    /** Explorer link for a transaction, on the explorer of the selected network. */
    explorerTx(hash: string): string | null {
      return explorerTxUrl(networks()[state.selectedId], hash);
    },
  };
}

export type NetworkStore = ReturnType<typeof createNetworkStore>;
