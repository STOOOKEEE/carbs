// carbs: builds the kit for this workspace, in place of Ledger's `ldmk-tool`
// (a private package of their monorepo). Run by `pnpm install` (the `prepare`
// script) and by `pnpm build`.
//
// - lib/esm/index.js: one ES module, the `@api/*` and `@internal/*` path
//   aliases resolved by esbuild, every dependency left external so that the
//   consumer shares a single Device Management Kit;
// - lib/types: the declarations emitted by tsc, their aliases rewritten to
//   relative paths by tsc-alias, as upstream's `watch:types` script does.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  "rxjs",
];

const bin = (name, file) =>
  join(dirname(require.resolve(`${name}/package.json`)), file);

rmSync(join(root, "lib"), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: "lib/esm/index.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  external,
  tsconfig: "tsconfig.prod.json",
  logLevel: "warning",
});
// This package is not "type": "module" (its .prettierrc.js is CommonJS), so
// the ES module folder says it itself, as the Device Management Kit's does.
mkdirSync(join(root, "lib/esm"), { recursive: true });
writeFileSync(join(root, "lib/esm/package.json"), '{ "type": "module" }\n');

const run = (file, args) =>
  execFileSync(process.execPath, [file, ...args], {
    cwd: root,
    stdio: "inherit",
  });
run(bin("typescript", "bin/tsc"), ["-p", "tsconfig.prod.json"]);
run(bin("tsc-alias", "dist/bin/index.js"), ["-p", "tsconfig.prod.json"]);
