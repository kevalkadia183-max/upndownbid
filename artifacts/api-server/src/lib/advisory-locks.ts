// Postgres advisory-lock keys shared across lib/campaigns.ts, lib/payments.ts,
// and lib/sponsorships.ts. Kept in one place, distinct from each other, so a
// transaction that must serialize against campaign rollover or sponsorship
// slot allocation/expiry always uses the exact same key -- a typo'd or
// re-declared constant would silently stop two code paths from actually
// contending for the same lock.
export const CAMPAIGN_LOCK_KEY = 927_411;
// Serializes: sponsorship purchase (slot allocation), cancellation, the
// expiration/stale-pending sweep, AND payment finalize() activating a
// SPONSORSHIP payment's reservation. Every place that reads a sponsorship's
// status and then writes a new status based on that read must hold this
// lock for the whole read-then-write, or a sweep and a late-arriving
// successful capture can race: one reads "still pending", decides what to
// do, and by the time it writes, the other has already changed the row.
export const SPONSORSHIP_LOCK_KEY = 552_984;
