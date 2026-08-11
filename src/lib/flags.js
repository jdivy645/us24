// The handful of yes/no facts a manager counts across records: how many of this
// month's verifications need an authorization, how many need a referral, how many
// have a secondary payer behind them.
//
// Derived from the answers rather than typed separately, and computed once at save
// so the dashboard is a read rather than a scan. Typing them twice is how a
// dashboard ends up disagreeing with the record it is counting.
import { isBypassed } from "./bypass.js";

const up = (s) => String(s || "").trim().toUpperCase();
const yes = (s) => up(s) === "YES";

// The payer has come back one way or the other. A denial counts: "they said no" is
// a finished piece of work, and a record that cannot leave the authorization queue
// on a denial is a record that sits there forever.
//
// An authorization number typed straight onto the form counts too — plenty of
// records arrive with the auth already in hand — as does an explicit N/A, which is
// the operator saying this one genuinely has nothing to chase.
export const authObtained = (v, meta) =>
  up(v.authStatus) === "APPROVED" || up(v.authStatus) === "DENIED"
  || !!String(v.authNum || "").trim()
  || isBypassed(meta, "authNum") || isBypassed(meta, "authStatus");

// The question the whole pipeline turns on. Not `authRequired` alone: a record whose
// authorization is already in hand must not be sent back round the loop when the
// operator resubmits it after a correction.
export const needsAuthWork = (v, meta) => recordFlags(v).authRequired && !authObtained(v, meta);

export function recordFlags(v) {
  return {
    // "Is authorization required" as the client says it on a call: for the initial
    // evaluation, for treatment, or evidenced by an authorization number already
    // in hand.
    authRequired: yes(v.authEval) || yes(v.authTx) || !!String(v.authNum || "").trim(),
    referralRequired: yes(v.referral) || yes(v.pcpRef),
    hasSecondary: yes(v.hasSec),
    inNetwork: up(v.network) === "IN NETWORK",
    // Blank counts as YES: every record in this tool is a verification of benefits
    // unless somebody has said otherwise, and records that predate the field must
    // not silently drop out of the count.
    vobRequired: up(v.vobRequired) !== "NO",
    authOutcome: up(v.authStatus) || "",
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
