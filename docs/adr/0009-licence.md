# 0009. Apache-2.0 for the code written here

**Status:** Accepted (2026-10-24)

**Context.** The repository mixes two imported code bases (`rippled/`, ISC; `ledger-app/`, Apache-2.0) with new TypeScript, C++ and C. Changes to the Ledger app are derivative of Apache-2.0 code. Changes to `rippled/` may be offered upstream, where the licence is ISC.

**Decision.** Apache-2.0 for the code written in this repository, with an explicit patent grant that suits cryptographic work, compatible with the Ledger app base. Changes made inside `rippled/` that are meant for the XRPL code base follow its ISC licence when they are proposed upstream. Imported code keeps its own licence.

**Consequences.** `LICENSE` holds the Apache-2.0 text; the README states the split. A contribution to another repository (for example `xrpl-connect`) follows that repository's licence.
