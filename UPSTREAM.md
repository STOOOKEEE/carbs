# Upstream imports

carbs builds on two upstream code bases. They are **imported unmodified, each in its own commit**, so that `git diff <import-commit> HEAD -- <directory>` shows our work and nothing else. There is no fork and no submodule (see the build specification, section 4).

| Directory     | Upstream                            | Branch     | Commit                                                                                                           | Imported in | Licence                          |
| ------------- | ----------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------- |
| `rippled/`    | https://github.com/XRPLF/rippled    | `alphanet` | `68bd02b64723112dfc08acdecc803c8ed0980ca2` (2026-10-16, "compose: alphanet from XRPLF/rippled@3.4.1 @ 00e64075") | `516f6a5`   | ISC, `rippled/LICENSE.md`        |
| `ledger-app/` | https://github.com/LedgerHQ/app-xrp | `master`   | `7b5185ff09b4b3d15df242b156a6aaadfc99f555` (v2.8.2)                                                              | `c7bcb68`   | Apache-2.0, `ledger-app/LICENSE` |

## How an import was made

```sh
git clone https://github.com/XRPLF/rippled.git && git -C rippled checkout 68bd02b64723112dfc08acdecc803c8ed0980ca2
git -C rippled archive 68bd02b64723112dfc08acdecc803c8ed0980ca2 | tar -x -C carbs/rippled   # tracked files only, no .git
git clone https://github.com/LedgerHQ/app-xrp.git && git -C app-xrp checkout 7b5185ff
git -C app-xrp archive 7b5185ff09b4b3d15df242b156a6aaadfc99f555 | tar -x -C carbs/ledger-app
```

The number of files matches `git ls-files` upstream (2300 and 6763).

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
