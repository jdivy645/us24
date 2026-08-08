// Form completeness — a pure function of the typed values, never of the transcript.
// Deliberately independent of verify.js's SKIP set: that decides what can be
// checked against the call, this decides what the manager still has to ask.
//
// The two used to disagree in a way that mattered. verify.js dropped "NA" from the
// checklist entirely while this counted it as answered, so a field typed "NA" was
// both complete and unverified with nothing recorded. Both now consult
// isBypassed(), and normalizeMeta() promotes a typed "NA" to a real bypass at save
// — so the field still counts as answered, but the reason is on the record.
import { isBypassed, isNegative } from "./bypass.js";
import { ASKED_FIELDS, classOf } from "./schema.js";
import { HEAD } from "../data/fields.js";

const up = (s) => String(s || "").trim().toUpperCase();
const applies = (v, key) => !!String(v[key] || "").trim() && !isNegative(v[key]);
const hasDeductible = (v) => up(v.dedApply) !== "NO" && applies(v, "dedInd");
const hasOop = (v) => applies(v, "oop");

// Some asked fields only become questions once another answer makes them one.
// Chasing a deductible-met figure on a plan with no deductible is how a checklist
// teaches people to ignore it.
const REQUIRED_WHEN = {
  copayAmt: (v) => up(v.copay) === "YES",
  coinsAmt: (v) => up(v.coins) === "YES",
  covPct: (v) => up(v.coins) === "YES",
  dedMet: hasDeductible,
  dedRem: hasDeductible,
  oopMet: hasOop,
  oopRem: hasOop,
  authWindow: (v) => up(v.authEval) === "YES" || up(v.authTx) === "YES",
  // Offered on the blank template, unused on the client's own filled one — most
  // payers quote one network status. Captured and verified when present; never
  // chased.
  networkInd: () => false,
};

// "NA" is an ANSWER (the rep said there is no deductible), not a blank. Only these
// count as unanswered.
const UNANSWERED = new Set(["", "TBD", "TBA", "UNKNOWN", "PENDING", "?"]);
const isAnswered = (val) => !UNANSWERED.has(String(val || "").trim().toUpperCase());

const sec = (v) => v.hasSec === "YES";

// Derived from the field classification rather than hand-listed, so "Still to ask"
// means exactly what the client's template says it means: the green fields, which
// are the ones the rep has to provide.
//
// Deliberately NOT here: the red `onFile` fields (patient name, DOB, payer ID,
// filing limits, claim address, payer phone). We already hold those, they are
// filled from our own records, and listing them as things to chase the rep for is
// how an operator ends up asking for something that was never theirs to give.
export const MANDATORY_FIELDS = [
  ...ASKED_FIELDS.map((key) => ({ key, label: HEAD[key] || key, cls: classOf(key), when: REQUIRED_WHEN[key] })),
  { key: "secName", label: "Secondary insurance name", cls: "unclassed", when: sec },
  { key: "secPolicy", label: "Secondary policy ID", cls: "unclassed", when: sec },
];

export function checkCompleteness(v, meta) {
  const required = MANDATORY_FIELDS.filter((f) => !f.when || f.when(v));
  const blank = required.filter((f) => !isAnswered(v[f.key]) && !isBypassed(meta, f.key));
  return {
    required: required.length,
    requiredKeys: required.map((f) => f.key),
    answered: required.length - blank.length,
    blank,
    bypassed: required.filter((f) => isBypassed(meta, f.key)).map((f) => f.key),
    incomplete: blank.length > 0,
  };
}

// Saved records: trust what was stored, recompute for rows predating the feature
// (collect() writes every form key onto the row, so recomputing is accurate).
const LEGACY_RECOMPUTE = true;

export function recordCompleteness(rec) {
  if (Array.isArray(rec._blank)) {
    return { blank: rec._blank, count: rec._blank.length, required: rec._required || 0, incomplete: rec._blank.length > 0 };
  }
  if (!LEGACY_RECOMPUTE) return { blank: [], count: 0, required: 0, incomplete: false };
  const c = checkCompleteness(rec, rec._meta);
  return { blank: c.blank.map((f) => f.label), count: c.blank.length, required: c.required, incomplete: c.incomplete };
}
