// The client's own usage, `GET /v1/usage` (Cycle 5 P2.3 backend, P2.6 client;
// spec 10A.3-10A.4; docs/API_CONTRACT.md, "the client's own usage"). Client-safe:
// no credential, no React, no fetch. Fractions and reset times only, never dollars.

/** One money meter as the client sees it. `available == false` is the only
 *  "limit reached" signal (Ruling 11); `used_fraction` is null when unknown. */
export type UsageMeter = {
  used_fraction: number | null;
  available: boolean;
  /** ISO 8601, UTC. */
  resets_at: string;
};

export type UploadsUsage = {
  /** `YYYY-MM`, UTC. */
  month: string;
  /** Null when there is no monthly limit, and for a client with no limits at all. */
  base: number | null;
  extra: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  /** The first of next month, 00:00 UTC. */
  resets_at: string;
};

export type KeUsage = {
  engine: "ke";
  uploads: UploadsUsage;
  writing: { today: UsageMeter; month: UsageMeter };
  documents: { today: UsageMeter };
};

/** Under M1 the backend answers exactly `{"engine": "m1"}` (A47). */
export type ClientUsage = { engine: "m1" } | KeUsage;
