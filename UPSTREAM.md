# Upstream imports

carbs builds on four upstream code bases. They are **imported unmodified, each in its own commit**, so that `git diff <import-commit> HEAD -- <directory>` shows our work and nothing else. There is no fork and no submodule (see the build specification, section 4).

| Directory                  | Upstream                                                                                                          | Branch      | Commit                                                                                                                                  | Imported in | Licence                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------ |
| `rippled/`                 | https://github.com/XRPLF/rippled                                                                                  | `alphanet`  | `68bd02b64723112dfc08acdecc803c8ed0980ca2` (2026-10-16, "compose: alphanet from XRPLF/rippled@3.4.1 @ 00e64075")                        | `516f6a5`   | ISC, `rippled/LICENSE.md`                        |
| `ledger-app/`              | https://github.com/LedgerHQ/app-xrp                                                                               | `master`    | `7b5185ff09b4b3d15df242b156a6aaadfc99f555` (v2.8.2)                                                                                     | `c7bcb68`   | Apache-2.0, `ledger-app/LICENSE`                 |
| `apps/web/`                | `create-xrp` 0.5.0 on npm (https://github.com/XRPL-Commons/scaffold-xrp, `packages/create-xrp`)                   | npm `0.5.0` | `gitHead` `8cdf24f9339f4642b4cbf2f5d9dd094ca8726bd2`, tarball sha256 `758b8286279292cb926e23159ae17600426dc6130553cb2afe68d03b5b077ee7` | see below   | MIT, `apps/web/LICENSE`                          |
| `packages/signer-kit-xrp/` | https://github.com/LedgerHQ/device-sdk-ts, `packages/signer/signer-xrp` (`@ledgerhq/device-signer-kit-xrp` 0.3.0) | `develop`   | `8ab7cdcaac6330ae6667a9b47cefe152c4968308` (2026-10-24, "Sort imports in SignTransactionDeviceActionFactory (#2048)")                   | see below   | Apache-2.0, `packages/signer-kit-xrp/LICENSE.MD` |

## How an import was made

```sh
git clone https://github.com/XRPLF/rippled.git && git -C rippled checkout 68bd02b64723112dfc08acdecc803c8ed0980ca2
git -C rippled archive 68bd02b64723112dfc08acdecc803c8ed0980ca2 | tar -x -C carbs/rippled   # tracked files only, no .git
git clone https://github.com/LedgerHQ/app-xrp.git && git -C app-xrp checkout 7b5185ff
git -C app-xrp archive 7b5185ff09b4b3d15df242b156a6aaadfc99f555 | tar -x -C carbs/ledger-app
```

The number of files matches `git ls-files` upstream (2300 and 6763).

### The web template (`apps/web/`)

`create-xrp` is a generator, not a repository, so `apps/web/` is its output, generated outside the repository and copied in:

```sh
scratch="$(mktemp -d)" && cd "$scratch" && npx --yes create-xrp@0.5.0 web --framework nuxt --pm pnpm --no-experimental --skip-install
rsync -a --exclude .git --exclude README.md "$scratch/web/" <repository>/apps/web/
cp "$scratch/web/README.md" <repository>/apps/web/README.create-xrp.md   # apps/web/README.md is ours and stays
```

What the generator does (read in `create-xrp/dist/index.js` of the 0.5.0 tarball): it refuses an existing target folder (`:1031-1033`), copies the bundled template (`:806-809`), keeps the Nuxt app and renames it `web` (`:1155-1170`), and without experimental primitives flattens the app to the project root, deletes the `packages` key of `pnpm-workspace.yaml` but keeps its other settings, and pins `xrpl` to `^4.0.0` (`:1223-1273`, `:762-776`); it then runs `git init` and a first commit even with `--skip-install` (`:1296-1330`), which is why it runs outside the repository. The 30 files tracked by that first commit are copied byte for byte; the only rename is the generated `README.md`, kept unchanged as `apps/web/README.create-xrp.md` in the import commit. Later commits of ours replace the template's pages, header, payment form and Testnet/Devnet list, and delete its README, QUICKSTART and `.env.local.example`; `apps/web/LICENSE` (MIT, Scaffold-XRP Contributors) stays. Find the import commit with `git log --diff-filter=A --format=%h -- apps/web/.scaffold-xrp.json`; `git diff <that commit> HEAD -- apps/web` shows our work.

### Ledger's XRP signer kit (`packages/signer-kit-xrp/`)

Ledger's official XRP signer kit for the Device Management Kit, `@ledgerhq/device-signer-kit-xrp`, lives in the `LedgerHQ/device-sdk-ts` monorepo. Its 69 tracked files under `packages/signer/signer-xrp` at `8ab7cdc` (the head of `develop` on 2026-10-25, after the 0.3.0 release, which added Ed25519) were fetched blob by blob with `gh api`, each checked against its SHA-1, and copied unmodified, in the same layout, into `packages/signer-kit-xrp/`. The package has no licence file of its own: the monorepo's `LICENSE.MD` (Apache-2.0, blob `d6b0e531`) is copied next to it, byte for byte.

```sh
gh api "repos/LedgerHQ/device-sdk-ts/git/trees/8ab7cdcaac6330ae6667a9b47cefe152c4968308?recursive=1"
gh api repos/LedgerHQ/device-sdk-ts/git/blobs/<blob sha> --jq .content | base64 -d   # for each of the 69 blobs, and LICENSE.MD
```

Without `LICENSE.MD`, the tree object of the import equals the upstream tree of `packages/signer/signer-xrp` at that commit, `f1069923622e28f56fc9c73cb88bc34ba88f9208`. Find the import commit with `git log --diff-filter=A --format=%h -- packages/signer-kit-xrp/src/api/SignerXrp.ts`; `git diff <that commit> HEAD -- packages/signer-kit-xrp` shows our work: first the tooling that builds and tests the kit in this workspace, then the extension for the XRP app of this repository (the ML-DSA-44 root, the session policy and the session status words), written in the kit's own style so that it can be offered upstream (`packages/signer-kit-xrp/UPSTREAM-PR.md`). Upstream tests are never edited or removed.

## How to verify an import

The tree object of an imported directory must equal the tree object of the upstream commit:

```sh
git rev-parse HEAD:rippled                    # in this repository
git -C rippled rev-parse 68bd02b64723112dfc08acdecc803c8ed0980ca2^{tree}   # in the upstream clone
```

The two hashes are identical for the import commits (`3e3f112e…` for `rippled/` at `516f6a5`), and `git diff <import-commit> HEAD -- <directory>` lists our changes only.

## Rules

- A commit that touches `rippled/` or `ledger-app/` is **ours**: one upstream defect per commit, never mixed with the amendment or the clear-signing work.
- No upstream test is removed or edited to make it pass. A counter that moves with our change (for example the number of delegable transaction types) is re-pinned with a justification in the commit message.
- Upstream licences stay where they are. Our own files carry the repository licence (Apache-2.0, see `LICENSE` and the README).
- To rebase on a newer upstream, import the new tree as its own commit first and update this table.

## Not imported, deliberately

- `XRPL-Commons/xrpl-connect` and `XRPL-Commons/scaffold-xrp`: contributions to those go through pull requests from a fork, not through this repository.
- The Ripple DevRel DevEx capture hook (`RippleDevRel/xrpl-devex-hook`): installed locally by each developer, kept out of git (see the README).
