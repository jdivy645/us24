// The handful of yes/no facts a manager counts across records: how many of this
// month's verifications need an authorization, how many need a referral, how many
// have a secondary payer behind them.
//
// Derived from the answers rather than typed separately, and computed once at save
// so the dashboard is a read rather than a scan. Typing them twice is how a
// dashboard ends up disagreeing with the record it is counting.
const up = (s) => String(s || "").trim().toUpperCase();
const yes = (s) => up(s) === "YES";

export function recordFlags(v) {
  return {
    // "Is authorization required" as the client says it on a call: for the initial
    // evaluation, for treatment, or evidenced by an authorization number already
    // in hand.
    authRequired: yes(v.authEval) || yes(v.authTx) || !!String(v.authNum || "").trim(),
    referralRequired: yes(v.referral) || yes(v.pcpRef),
    hasSecondary: yes(v.hasSec),
    inNetwork: up(v.network) === "IN NETWORK",
  };
}

// Days from the request coming in to the verification being done. Null rather than
// zero when either date is missing — a missing date is not a same-day turnaround.
export function turnaroundDays(v) {
  const a = String(v.requestDate || "").trim();
  const b = String(v.today || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const days = Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  return Number.isFinite(days) ? days : null;
}
