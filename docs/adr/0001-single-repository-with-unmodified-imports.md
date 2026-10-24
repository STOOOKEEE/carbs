# 0001. One repository, upstream bases imported unmodified

**Status:** Accepted (2026-10-24)

**Context.** The work changes two upstream code bases (`XRPLF/rippled` alphanet and `LedgerHQ/app-xrp`) and adds a TypeScript client. A fork per base means several repositories to submit and review; a submodule renders as a link and clones empty without `--recursive`; a private or deleted fork breaks the review.

**Decision.** One public repository. Each base is imported as its tracked tree, without history, in its own first commit for its directory, with source, commit and licence recorded in `UPSTREAM.md`. Everything after an import commit is ours.

**Consequences.** `git diff <import-commit> HEAD -- rippled/` is exactly our protocol work. One base defect per commit, never mixed with the amendment. Rebasing on a newer upstream means importing the new tree as its own commit. Upstream pull requests would need a separate fork, which is not planned; contributions to `xrpl-connect` and `scaffold-xrp` go through forks of those repositories.
