/**
 * `pnpm demo`: the standalone node of `infra/standalone.cfg`, its ledger closer
 * (`infra/closer.ts`), a dev faucet that holds the genesis key, and the web app on the
 * live backend, all on this machine. Ctrl-C stops everything.
 *
 *   XRPLD_BIN=/path/to/xrpld GENESIS_SEED=… pnpm demo [--no-web] [--web-port 3000] [--keep]
 *
 * XRPLD_BIN must be a build that carries the SigningSessions amendment: without it the web
 * app refuses the node and stays on the simulation, and says why. The genesis seed comes from
 * the environment and is never written anywhere.
 */
import { WebSocketClient, classicSignerFromSeed } from "@carbs/sessions";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localConfig, portsOf } from "./config.js";
import { createFaucetServer } from "./faucet.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FAUCET_PORT = 3005;
const DEFAULT_WEB_PORT = 3000;
const READY_POLLS = 120;
const READY_POLL_MS = 500;

interface Args {
  web: boolean;
  webPort: number;
  keep: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { web: true, webPort: DEFAULT_WEB_PORT, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--no-web") args.web = false;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--web-port") args.webPort = Number(argv[(i += 1)]);
    else throw new Error(`unknown argument ${String(arg)}`);
  }
  return args;
}

function fail(message: string): never {
  console.error(`demo: ${message}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(what: string, probe: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < READY_POLLS; i += 1) {
    if (await probe().catch(() => false)) return;
    await sleep(READY_POLL_MS);
  }
  fail(`${what} did not become ready in ${(READY_POLLS * READY_POLL_MS) / 1000} s`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const xrpld = process.env["XRPLD_BIN"] ?? join(ROOT, "rippled", "build", "xrpld");
  if (!existsSync(xrpld)) {
    fail(`no xrpld at ${xrpld}: set XRPLD_BIN to a build with the SigningSessions amendment`);
  }
  const seed = process.env["GENESIS_SEED"];
  if (seed === undefined || seed === "") {
    fail(
      "set GENESIS_SEED to the seed of the genesis account of the standalone node (the dev faucet funds fresh accounts from it)",
    );
  }
  const genesis = classicSignerFromSeed(seed);

  const sourceConfig = readFileSync(join(ROOT, "infra", "standalone.cfg"), "utf8");
  const ports = portsOf(sourceConfig);
  const dir = mkdtempSync(join(tmpdir(), "carbs-demo-"));
  const configPath = join(dir, "standalone.cfg");
  writeFileSync(configPath, localConfig(sourceConfig, dir));

  const children: ChildProcess[] = [];
  let stopping = false;
  const stop = (code: number): void => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill("SIGTERM");
    if (!args.keep) rmSync(dir, { recursive: true, force: true });
    setTimeout(() => process.exit(code), 500);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  const run = (
    name: string,
    command: string,
    commandArgs: string[],
    env: NodeJS.ProcessEnv = {},
  ): ChildProcess => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream): void => {
      stream.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString("utf8").split("\n"))
          if (line.trim() !== "") out.write(`[${name}] ${line}\n`);
      });
    };
    log(child.stdout, process.stdout);
    log(child.stderr, process.stderr);
    child.on("exit", (code) => {
      if (!stopping) {
        console.error(`demo: ${name} exited (${String(code)}), stopping`);
        stop(1);
      }
    });
    children.push(child);
    return child;
  };

  console.log(`demo: data in ${dir}`);
  run("xrpld", xrpld, ["--conf", configPath, "-a", "--start", "--silent"]);
  const publicUrl = `ws://127.0.0.1:${ports.publicWs}`;
  const client = new WebSocketClient(publicUrl);
  await waitFor("the node", async () => (await client.request("server_info", {})) !== undefined);
  console.log(`demo: node up on ${publicUrl}`);

  run("closer", process.execPath, [join(ROOT, "infra", "closer.ts")], {
    XRPLD_ADMIN_WS: `ws://127.0.0.1:${ports.adminWs}`,
  });

  const origins = [`http://localhost:${args.webPort}`, `http://127.0.0.1:${args.webPort}`];
  const faucet = createFaucetServer({ client, genesis }, origins);
  await new Promise<void>((resolve, reject) => {
    faucet.once("error", reject);
    faucet.listen(FAUCET_PORT, "127.0.0.1", resolve);
  });
  console.log(
    `demo: dev faucet on http://127.0.0.1:${FAUCET_PORT}/accounts (the browser never holds the genesis key)`,
  );

  if (args.web) {
    run("web", "pnpm", ["--filter", "web", "dev", "--port", String(args.webPort)], {
      NUXT_PUBLIC_BACKEND: "live",
      NUXT_PUBLIC_LOCAL_NODE_URL: publicUrl,
      NUXT_PUBLIC_LOCAL_FAUCET_URL: `http://127.0.0.1:${FAUCET_PORT}/accounts`,
    });
    console.log(`demo: web app on http://localhost:${args.webPort}/ (live backend)`);
  } else {
    console.log("demo: --no-web: start the app yourself with NUXT_PUBLIC_BACKEND=live");
  }
  console.log("demo: Ctrl-C stops everything");
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
