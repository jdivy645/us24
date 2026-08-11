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
// Named on the requirements call as required, but not `ask` fields — nobody rings a
// payer to find out which project a record belongs to. They are still required to
// save, so they live in the same list; `cls: "internal"` is what lets the UI keep
// them out of "Still to ask", which must go on meaning "ask the rep for this".
//
// insName is `onFile` rather than `ask` for the same reason as the patient's name,
// so it needs an explicit entry here the way secName and secPolicy do.
const RECORD_FIELDS = ["projectName", "requestMode", "requestDate", "username", "initialTx", "insName"];

export const MANDATORY_FIELDS = [
  ...ASKED_FIELDS.map((key) => ({ key, label: HEAD[key] || key, cls: classOf(key), when: REQUIRED_WHEN[key] })),
  ...RECORD_FIELDS.map((key) => ({ key, label: HEAD[key] || key, cls: classOf(key), when: REQUIRED_WHEN[key] })),
  { key: "secName", label: "Secondary insurance name", cls: "unclassed", when: sec },
  { key: "secPolicy", label: "Secondary policy ID", cls: "unclassed", when: sec },
];

// A request that was never a phone call cannot produce a rep name or a call
// reference. Exempting them is the same judgement as REQUIRED_WHEN: a checklist
// that asks for something unobtainable teaches people to ignore the checklist.
export const MODE_EXEMPT = {
  FAX: ["repName", "callRef"],
  WEBSITE: ["repName", "callRef"],
};

// `cfg` is the project's rule for this request mode: { add: [keys], exempt: [keys] }.
// It is optional and defaults to nothing, so every existing caller and every test
// that predates project configuration keeps its exact previous behaviour.
export function requiredFor(v, cfg = {}) {
  const exempt = new Set([...(cfg.exempt || []), ...(MODE_EXEMPT[up(v.requestMode)] || [])]);
  const known = new Set(MANDATORY_FIELDS.map((f) => f.key));
  const extra = (cfg.add || [])
    .filter((key) => !known.has(key))
    .map((key) => ({ key, label: HEAD[key] || key, cls: classOf(key), when: REQUIRED_WHEN[key] }));
  return [...MANDATORY_FIELDS, ...extra]
    .filter((f) => !exempt.has(f.key))
    .filter((f) => !f.when || f.when(v));
}

export function checkCompleteness(v, meta, cfg = {}) {
  const required = requiredFor(v, cfg);
  const blank = required.filter((f) => !isAnswered(v[f.key]) && !isBypassed(meta, f.key));
  return {
    required: required.length,
    requiredKeys: required.map((f) => f.key),
    answered: required.length - blank.length,
    blank,
    // What the rep still has to be asked for, which is not the same list as what is
    // missing: the project name and the request date are ours to supply.
    stillToAsk: blank.filter((f) => f.cls !== "internal" && f.cls !== "onFile"),
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
