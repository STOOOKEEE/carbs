# infra

Everything needed to run the daemon and the demo locally.

| File             | Purpose                                                                                                                                                                                                                  | Status  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `standalone.cfg` | Standalone `xrpld` configuration with `[features]` (`Passkey`, `Quantum`, `SigningSessions`, `BatchV1_1`, `PermissionDelegationV1_1`), a public non-admin WebSocket for the app and a separate admin port for the closer | task N9 |
| `closer.ts`      | The single process that calls `ledger_accept` every 1 to 3 seconds (session expiry is measured on ledger close time)                                                                                                     | task N9 |
| `Dockerfile`     | The node, so the demo can run without a long C++ build                                                                                                                                                                   | stretch |

The genesis seed comes from an environment variable and is never committed. Start from the example configuration upstream (`rippled/cfg/`).
