/**
 * A mode of a signing session (`SigningSessionSet`): capped in XRP (mode C,
 * `SessionCap`), all transactions (mode A, `tfAllTransactions`), or a list of
 * granular permissions (mode P, `Permissions`).
 */
export type SessionMode = "cap" | "all" | "permissions";

/**
 * The session profiles of the XRP app, by id. A `SigningSessionSet` names one
 * with a memo whose `MemoType` is `carbs-profile` and whose `MemoData` is the
 * profile's name.
 */
export const SESSION_PROFILE_NAMES = [
  "agent",
  "game",
  "trading",
  "streaming",
  "minting",
] as const;

export type SessionProfileName = (typeof SESSION_PROFILE_NAMES)[number];

/** The limits of one session profile, as set on the device. */
export type SessionProfilePolicy = {
  /** Its id, the index of its name in {@link SESSION_PROFILE_NAMES}. */
  readonly id: number;
  readonly name: SessionProfileName;
  /** Turned off in the settings: a session naming it is refused. */
  readonly enabled: boolean;
  /** The modes it allows (fixed per profile). */
  readonly modes: SessionMode[];
  /** Largest `SessionCap`, in drops; `null` outside mode C. */
  readonly maxCapDrops: bigint | null;
  /** Largest `SessionMaxPerTx`, in drops; `null` outside mode C. */
  readonly maxPerTxDrops: bigint | null;
  /** Largest `SessionDuration`, in seconds. */
  readonly maxDurationSeconds: number;
  /** Largest `SessionMaxTxCount`, which a session naming it must carry. */
  readonly maxTxCount: number;
  /** The `PermissionValue`s it allows in mode P (fixed per profile). */
  readonly permissions: number[];
};

/**
 * The user's own limits on the signing sessions the device agrees to open,
 * edited on the device only (format version 2 of `INS 0x08`). When the policy
 * is on, the app checks every `SigningSessionSet` against it, or against the
 * profile the session names, before any review, and refuses with `6986`.
 */
export type SessionPolicy = {
  /** Format version of the answer, 2. */
  readonly version: number;
  /** The policy is checked; when off, nothing else applies. */
  readonly enabled: boolean;
  /** Mode A allowed, without a profile. */
  readonly allowAll: boolean;
  /** Mode P allowed, without a profile. */
  readonly allowPermissions: boolean;
  /** `SessionWitness` must be present, profile or not. */
  readonly requireWitness: boolean;
  /** Largest `SessionCap` without a profile, in drops; `null` = no limit. */
  readonly maxCapDrops: bigint | null;
  /** Largest `SessionMaxPerTx` without a profile, in drops; `null` = no limit. */
  readonly maxPerTxDrops: bigint | null;
  /** Largest `SessionDuration` without a profile, in seconds; `null` = no limit. */
  readonly maxDurationSeconds: number | null;
  /** Every profile, in id order. */
  readonly profiles: SessionProfilePolicy[];
};
