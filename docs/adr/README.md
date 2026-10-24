# Architecture decision records

One short file per decision that is expensive to reverse. Format: Status, Context, Decision, Consequences. A new decision gets the next number; a reversed one is marked `Superseded by NNNN`, never edited away.

| #                                                          | Decision                                                                                   | Status                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| [0001](0001-single-repository-with-unmodified-imports.md)  | One repository, upstream bases imported unmodified                                         | Accepted                             |
| [0002](0002-session-predicate-replaces-checksign.md)       | The session predicate replaces `checkSign`                                                 | Accepted                             |
| [0003](0003-device-management-kit-only.md)                 | Device Management Kit only for Ledger access                                               | Accepted                             |
| [0004](0004-non-extractible-p256-session-keys.md)          | Session keys are non-extractible P-256 WebCrypto keys, fresh per session                   | Accepted; superseded in part by 0011 |
| [0005](0005-opening-is-one-ordinary-signature.md)          | Opening a session is one ordinary signature, not a multisig                                | Accepted                             |
| [0006](0006-relative-duration-absolute-expiry.md)          | Relative duration in the transaction, absolute expiry in the entry                         | Accepted                             |
| [0007](0007-front-from-create-xrp.md)                      | The web app starts from the `create-xrp` Nuxt template                                     | Accepted                             |
| [0008](0008-post-quantum-root-classical-or-pq-sessions.md) | A post-quantum root on the device; session keys are P-256 by default and ML-DSA when asked | Accepted; superseded in part by 0011 |
| [0009](0009-licence.md)                                    | Apache-2.0 for the code written here                                                       | Accepted                             |
| [0010](0010-tickets-for-multisig-coordination.md)          | How sessions use tickets, which serve multisig coordination                                | Proposed                             |
| [0011](0011-two-account-profiles.md)                       | Two account profiles; a Ledger account uses ML-DSA-44 session keys                         | Accepted                             |
