/**
 * Turn `infra/standalone.cfg` (written for the container of `infra/compose.yaml`) into a
 * configuration that runs on this machine: data under a temporary directory, listening on
 * the loopback only. The amendments, the ports and everything else are the file's own.
 */

const CONTAINER_DATA_DIR = "/var/lib/xrpld";
const ANY_ADDRESS = /^ip\s*=\s*0\.0\.0\.0\s*$/gm;
const ADMIN_NETWORKS = /^admin\s*=.*$/gm;

export interface LocalPorts {
  /** The public, non-admin WebSocket the web app uses. */
  publicWs: number;
  /** The admin WebSocket the closer uses. */
  adminWs: number;
}

export function localConfig(cfg: string, dataDir: string): string {
  return cfg
    .replaceAll(CONTAINER_DATA_DIR, dataDir)
    .replace(ANY_ADDRESS, "ip = 127.0.0.1")
    .replace(ADMIN_NETWORKS, "admin = 127.0.0.1");
}

/** The ports of the two WebSocket sections, read from the file so the script never drifts from it. */
export function portsOf(cfg: string): LocalPorts {
  const port = (section: string): number => {
    const match = new RegExp(`\\[${section}\\][^\\[]*?^port\\s*=\\s*(\\d+)`, "ms").exec(cfg);
    if (match?.[1] === undefined) throw new Error(`standalone.cfg: no port in [${section}]`);
    return Number(match[1]);
  };
  return { publicWs: port("port_ws_public"), adminWs: port("port_ws_admin_local") };
}
