// What may actually be written into the form, and what only gets offered.
//
// Deliberately separate from extract.js. That module answers "what did the rep
// say?"; this one answers "are we willing to type it for them?" — a different
// question with a different failure cost, and one that has to be arguable on its
// own terms.
//
// The governing asymmetry: a field left blank costs a few seconds. A field filled
// with a plausible wrong number costs a claim denial or a course of treatment
// delivered without cover, and the operator will skim past it because it looks
// answered. So every rule here is biased toward suggesting rather than filling.
import { ANCHORS, OWN_Q } from "./anchors.js";
import { checkTranscript, getPrep } from "./verify.js";
import { isStrict } from "./schema.js";
import { F } from "../data/fields.js";

// 0.75 is the line verify.js already draws between "Call says" and "Call may say".
// Filling is a stronger act than reporting, because the operator may never look at
// it, so the bar is higher. Measured against the client's own call: every proposal
// that matches the corrected VOB scores >= 0.97, and the only wrong proposal any
// experiment produced scored 0.92.
export const FILL_MIN = 0.85;
export const FILL_MIN_STRICT = 0.92;   // the money and authorization fields
export const SUGGEST_MIN = 0.60;

// Never written whatever the score.
//   termDate  blank means coverage is current, and a date spoken near "end" or
//             "through" is usually the plan year. A wrong termination date tells a
//             practice to stop treating a covered patient.
//   authNum   an auth number read out mid-call is often the previous episode's.
//             Only the operator knows which.
export const NEVER_AUTO = new Set(["termDate", "authNum"]);

// Plausibility bands. A garbled "18 days" where the rep said "180" is caught here
// without consulting the machine's opinion of itself.
const BANDS = {
  tfl: [15, 730], tflCorr: [15, 730], authWindow: [1, 365],
  authAfter: [1, 60], visitLimit: [1, 365], visitUsed: [0, 365],
  coinsAmt: [0, 100], covPct: [0, 100],
};

const numOf = (s) => {
  const m = String(s == null ? "" : s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/* ------------------------------------------------------------------ guards */

// A grouped field that is not the base one must show its OWN qualifier near the
// value. "dedRem" without "remaining"/"left"/"balance" in reach is a guess about
// which sibling you heard — and in the client's call the deductible span carries
// "family", which is precisely the wrong sibling.
function hasOwnQualifier(prep, key, span) {
  const spec = ANCHORS[key];
  if (!spec || !spec.g || spec.base) return true;
  const own = OWN_Q.get(key);
  if (!own || !own.size) return true;
  const ti = prep.toks.findIndex((t) => t.end > span.start);
  if (ti < 0) return false;
  const lo = Math.max(0, ti - 8), hi = Math.min(prep.toks.length, ti + 8);
  for (let k = lo; k < hi; k++) if (own.has(prep.toks[k].t)) return true;
  return false;
}

// Two fields in one anchor group cannot both be a single spoken number. $3,000
// cannot be the individual deductible AND the individual out-of-pocket.
function siblingCollisions(values) {
  const byGroupValue = new Map();
  for (const [key, p] of Object.entries(values)) {
    const g = (ANCHORS[key] || {}).g;
    if (!g) continue;
    const n = numOf(p.value);
    if (n == null) continue;
    const id = `${g}|${n}`;
    if (!byGroupValue.has(id)) byGroupValue.set(id, []);
    byGroupValue.get(id).push(key);
  }
  const out = new Set();
  for (const keys of byGroupValue.values()) if (keys.length > 1) for (const k of keys) out.add(k);
  return out;
}

// The only genuinely independent reader left once the operator stops typing.
// Neither engine nor confidence has any say in whether 500 + 2500 is 3000.
const IDENTITIES = [
  { parts: ["dedMet", "dedRem"], whole: "dedInd", label: "deductible" },
  { parts: ["oopMet", "oopRem"], whole: "oop", label: "out of pocket" },
];

function identityFailures(values) {
  const bad = new Map();
  const val = (k) => (values[k] ? numOf(values[k].value) : null);

  for (const id of IDENTITIES) {
    const a = val(id.parts[0]), b = val(id.parts[1]), w = val(id.whole);
    if (a == null || b == null || w == null) continue;
    if (Math.abs(a + b - w) < 0.01) continue;
    for (const k of [...id.parts, id.whole]) {
      bad.set(k, `${id.label}: ${a} + ${b} does not make ${w} — all three need checking`);
    }
  }

  const cov = val("covPct"), coins = val("coinsAmt");
  if (cov != null && coins != null && Math.abs(cov + coins - 100) > 0.01) {
    for (const k of ["covPct", "coinsAmt"]) bad.set(k, `coverage ${cov}% and co-insurance ${coins}% do not make 100%`);
  }
  return bad;
}

/* ------------------------------------------------------------------ decide */

// Sorts every proposal into fill / suggest / contested / blocked, with the reason
// attached to each. Nothing is written by this function — it only decides.
export function decide(extraction, prep, { form = {}, meta = {} } = {}) {
  const values = extraction.values || {};
  const collided = siblingCollisions(values);
  const failedIdentity = identityFailures(values);

  const fill = {}, suggest = {}, contested = {}, blocked = {};

  for (const [key, p] of Object.entries(values)) {
    const strict = isStrict(key);
    const bar = strict ? FILL_MIN_STRICT : FILL_MIN;
    const score = p.score;                       // null for yes/no and enum
    const reasons = [];

    // Only a rival within AMBIG_GAP counts — that is the rep genuinely answering
    // twice, and the operator has to pick. A rival the scorer already beat
    // decisively is usually the same figure read a second way ("473.76" against a
    // bare "473"), and holding the field back for it would lose the answer.
    if (p.ambiguous) {
      contested[key] = { ...p, why: `The rep said "${p.value}" and also "${p.rivals[0]?.text ?? "something else"}".` };
      continue;
    }
    if (failedIdentity.has(key)) { blocked[key] = { ...p, why: failedIdentity.get(key) }; continue; }
    if (collided.has(key)) { blocked[key] = { ...p, why: "the same figure would answer two fields in this group" }; continue; }

    const band = BANDS[key], n = numOf(p.value);
    if (band && n != null && (n < band[0] || n > band[1])) {
      blocked[key] = { ...p, why: `${n} is outside the range this field can plausibly take` };
      continue;
    }

    if (score != null && score < SUGGEST_MIN) { blocked[key] = { ...p, why: "too weak to act on" }; continue; }

    // Ordered by how much the operator learns from it. The first is what shows.
    if (String(form[key] || "").trim()) reasons.push("you have already entered a value");
    if (NEVER_AUTO.has(key)) reasons.push("this field is never filled automatically");
    if (score != null && score < bar) reasons.push(strict ? "below the bar for a money field" : "below the bar for auto-fill");
    if (!hasOwnQualifier(prep, key, p.span)) reasons.push("the rep did not name which figure this was");

    if (reasons.length) suggest[key] = { ...p, why: reasons[0], reasons };
    else fill[key] = p;
  }

  return {
    fill, suggest, contested, blocked,
    derived: extraction.derived || {},
    skipped: extraction.skipped || {},
    counts: {
      fill: Object.keys(fill).length,
      suggest: Object.keys(suggest).length,
      contested: Object.keys(contested).length,
      blocked: Object.keys(blocked).length,
    },
  };
}

/* ------------------------------------------------------------------- apply */

const ENGINE = "extract@1";

// Writes the fills into the form and marks them.
//
// The load-bearing safety rule: a value this writes must come back `found` from
// checkTranscript, or it is not written at all. That costs one extra verify pass
// and kills an entire class of extractor bug, because the matcher has never seen
// the extractor's reasoning. Anything that fails is demoted to a suggestion.
export function applyExtraction(form, meta, decided, { transcript, ranges, by = "" } = {}) {
  const candidate = { ...form };
  const keys = Object.keys(decided.fill).filter((k) => !String(form[k] || "").trim());
  for (const k of keys) candidate[k] = decided.fill[k].value;

  // No transcript, no fill. Skipping the check would write every proposal with
  // nothing having verified it, which is the one thing this function exists to
  // prevent.
  if (!transcript) return { form, meta, filled: [], rejected: keys };

  // Extends the real meta rather than replacing it. Discarding the bypasses and
  // provenance marks on OTHER fields changes which values count as confirmed,
  // which feeds the cross-field dedup pass, which could then demote a perfectly
  // good new fill — non-deterministically, depending on how much was prefilled.
  const probeMeta = { ...meta, ...Object.fromEntries(keys.map((k) => [k, { ...meta[k], source: "call" }])) };
  const r = keys.length ? checkTranscript(candidate, transcript, probeMeta, { ranges }) : { checks: [] };

  // The check is that the matcher does not CONTRADICT the value — not that it
  // independently rediscovers it. The two reach a value by different routes, and
  // the matcher has blind spots the extractor was written to cover: it cannot see
  // a bare "No, it is not." answering a question asked a turn earlier, so it
  // reports `quiet` where the extractor correctly read a NO. Demanding `found`
  // threw away one proposal in six — all of them right.
  //
  //   mismatch  the rep said something else. Never write it.
  //   echo      the matcher places this in our own agent's mouth, and the
  //             extractor placed it in the rep's. They disagree about who spoke;
  //             that is exactly the disagreement worth deferring to.
  const refused = new Set(r.checks.filter((c) => c.status === "mismatch" || c.status === "echo").map((c) => c.key));
  const survived = new Set(keys.filter((k) => !refused.has(k)));

  const nextForm = { ...form }, nextMeta = { ...meta };
  const filled = [], rejected = [];
  const at = new Date().toISOString();

  for (const k of keys) {
    const p = decided.fill[k];
    if (!survived.has(k)) { rejected.push(k); continue; }
    nextForm[k] = p.value;
    nextMeta[k] = {
      ...nextMeta[k],
      source: "call",
      extract: {
        value: p.value, score: p.score, confidence: p.confidence,
        quote: p.quote, span: p.span, engine: ENGINE, at, review: null,
      },
    };
    filled.push(k);
  }
  return { form: nextForm, meta: nextMeta, filled, rejected };
}

// Accepting a suggestion is the operator choosing it against a visible quote, so
// it lands already attested rather than needing a second look.
export function useSuggestion(form, meta, proposal, by = "") {
  const at = new Date().toISOString();
  return {
    form: { ...form, [proposal.key]: proposal.value },
    meta: {
      ...meta,
      [proposal.key]: {
        ...meta[proposal.key],
        source: "call",
        extract: {
          value: proposal.value, score: proposal.score ?? null, confidence: proposal.confidence ?? "low",
          quote: proposal.quote, span: proposal.span, engine: ENGINE, at,
          review: { action: "used-suggestion", by, at },
        },
      },
    },
  };
}

export function acceptFields(meta, keys, by = "") {
  const at = new Date().toISOString();
  const next = { ...meta };
  for (const k of keys) {
    if (!next[k]?.extract) continue;
    next[k] = { ...next[k], extract: { ...next[k].extract, review: { action: "accepted", by, at } } };
  }
  return next;
}

// Clearing a machine-read value that the operator does not trust.
export function rejectField(form, meta, key, by = "") {
  const at = new Date().toISOString();
  const next = { ...meta };
  if (next[key]?.extract) {
    next[key] = { ...next[key], source: "manual", extract: { ...next[key].extract, review: { action: "rejected", by, at } } };
  }
  return { form: { ...form, [key]: "" }, meta: next };
}

// Everything the machine wrote and nobody has looked at yet.
export const unreviewedKeys = (meta) =>
  F.filter((k) => meta?.[k]?.extract && !meta[k].extract.review);

// Drop every value that came from the call and was never accepted.
export function clearAutofilled(form, meta) {
  const nextForm = { ...form }, nextMeta = { ...meta };
  for (const k of unreviewedKeys(meta)) {
    nextForm[k] = "";
    const { source, extract, ...rest } = nextMeta[k];
    if (Object.keys(rest).length) nextMeta[k] = rest; else delete nextMeta[k];
  }
  return { form: nextForm, meta: nextMeta };
}

// Convenience for callers that hold a transcript rather than a prep.
export const prepFor = (text) => (text ? getPrep(text) : null);
