// Proposing form values from the call, so the operator confirms what the rep said
// instead of transcribing it.
//
// This module owns no matching logic. verify.js already scores every number, date
// and ID in the transcript against every field's anchors, and the only
// value-dependent line in that loop throws away candidates which AGREE with the
// typed value. Take the typed value away and the same loop is an extractor;
// findBest() is that call. Everything here is policy: what may be proposed, how it
// is written in the form's own conventions, and how sure the UI is allowed to
// sound.
//
// One rule decides the rest: a wrong auto-filled value is worse than a blank one,
// because the operator will skim past it. When in doubt, skip and record why.
import { ANCHORS, KEYWORD_WINDOW } from "./anchors.js";
import { VERIFY_FIELDS, findBest, decideYesNo, matchEnum, saidByRep } from "./verify.js";
import { roleAt } from "./transcriptParse.js";
import { classOf, isStrict } from "./schema.js";

/* ------------------------------------------------------------- formatting */

const DUR_TOK = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, year: 365, years: 365 };
const plural = (w) => (w.endsWith("s") ? w : w + "s");

const hasPhrase = (words, p) => {
  for (let i = 0; i + p.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < p.length; k++) if (words[i + k] !== p[k]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
};

// The form stores "$3000.00" — no thousands separator, always two decimals.
const fmtMoney = (n) => "$" + Number(n).toFixed(2);
// "20%", and "22.5%" without the transcript's trailing zeros.
const fmtPercent = (n) => Number(n) + "%";
// A bare number. The parenthetical an operator adds — "20 (HARD MAX)" — is a
// judgement about the plan, not a figure the rep stated.
const fmtCount = (n) => String(Number(n));
// <input type="date"> accepts nothing but YYYY-MM-DD.
const fmtDate = (d) => `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
// Digits exactly as the run was spoken, leading zeros intact.
const fmtId = (digits) => digits;
const fmtPhone = (d) => (d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d);

// "180 DAYS FROM DOS" — but only when the rep actually said "from date of
// service". The real ASH call comes through as "180 days from the data service":
// speech-to-text has already broken the phrase, and appending the DOS qualifier on
// a guess, on the one field a practice bills against, is not a trade worth making.
const DOS_PHRASES = [["date", "of", "service"], ["dates", "of", "service"], ["service", "date"], ["dos"]];

function fmtDuration(prep, c) {
  const toks = prep.toks;
  const unitIx = DUR_TOK[(toks[c.ti + 1] || {}).t] ? c.ti + 1 : c.ti + 2;  // "60 calendar days"
  const unit = (toks[unitIx] || {}).t;
  if (!DUR_TOK[unit]) return null;
  const after = toks.slice(unitIx + 1, unitIx + 8).map((t) => t.t);
  const dos = DOS_PHRASES.some((p) => hasPhrase(after, p));
  // c.val is the number as spoken; c.norm has been normalised to days and would
  // turn "6 months" into "180 DAYS".
  return `${c.val} ${plural(unit).toUpperCase()}${dos ? " FROM DOS" : ""}`;
}

function valueOf(prep, m, c) {
  switch (m) {
    case "money": return fmtMoney(c.norm);
    case "percent": return fmtPercent(c.norm);
    case "count": return fmtCount(c.norm);
    case "duration": return fmtDuration(prep, c);
    // A date with no year is not a form value. The scorer already docks it 0.15;
    // inferring the year from the call date would be the wrong kind of helpful.
    case "date": return c.noYear ? null : fmtDate(c.norm);
    case "id": return fmtId(c.norm);
    case "phone": return fmtPhone(c.norm);
    default: return null;
  }
}

/* ------------------------------------------------------------------ policy */

// Presence matchers can tell you whether a name you already hold was spoken, never
// what the name was — there is nothing to reverse. The real call spells the rep's
// name "J a h. N e e v. A" and then "V as in Victor. A"; no algorithm here reaches
// JAHNEEVA.C. Guessing a plan type or a coverage phrase is worse: it reads as
// authoritative and is never checked again.
const PROSE = new Set(Object.keys(ANCHORS).filter((k) => ANCHORS[k].m === "none"));

// The provider supplies these and the call flows the other way — our agent reads
// them out and the rep looks the member up. They are already filled from the
// patient and carrier records. Extracting them retypes what is there at best, and
// at worst adopts a different member's details because the rep pulled up the wrong
// record, silently, into the fields the whole document identifies a person by.
const IDENTITY = new Set(VERIFY_FIELDS.filter((f) => f.identity).map((f) => f.key));

// Our clock, our staff, and a narrative generated from the other fields.
const INTERNAL = new Set(["today", "verifiedBy", "note"]);

export const NEVER_EXTRACT = new Set([...PROSE, ...IDENTITY, ...INTERNAL]);

const policyReason = (k) =>
  INTERNAL.has(k) ? "internal-bookkeeping"
    : IDENTITY.has(k) ? "identity-supplied-by-provider"
      : "prose-not-reversible";

// Who claims a shared number first. A qualified group member ("deductible
// REMAINING") carries named evidence of its own and must go before the base field
// ("deductible"), which is what a loose number lands on. Ungrouped fields sit
// between — they have no siblings to steal from.
const tier = (key) => {
  const s = ANCHORS[key] || {};
  if (s.g && !s.base) return 0;
  if (!s.g) return 1;
  return 2;
};

/* --------------------------------------------------------------- yes / no */

// network and networkInd are graded by matchEnum(), not by decideYesNo(), so the
// proposal is built by matchEnum() too. A value its own verifier would not
// recognise is worse than no value at all.
function networkFrom(prep, ranges, key) {
  const inn = matchEnum(prep, "IN NETWORK");
  const oon = matchEnum(prep, "OUT OF NETWORK");
  if (inn.found === oon.found) return null;               // both, or neither
  const r = inn.found ? inn : oon;
  const spans = ranges ? r.spans.filter((s) => saidByRep(ranges, [s])) : r.spans;
  if (!spans.length) return null;
  // The group's status and the rendering provider's are different questions, and
  // one "in network" cannot answer both.
  if (key === "networkInd" && !nearHead(prep, spans[0], ANCHORS.networkInd.heads)) return null;
  return { value: inn.found ? "IN NETWORK" : "OUT OF NETWORK", span: spans[0] };
}

function nearHead(prep, span, heads) {
  const ti = prep.toks.findIndex((t) => t.end > span.start);
  if (ti < 0) return false;
  const lo = Math.max(0, ti - KEYWORD_WINDOW), hi = Math.min(prep.toks.length, ti + KEYWORD_WINDOW);
  const words = prep.toks.slice(lo, hi).map((t) => t.t);
  return (heads || []).some((p) => hasPhrase(words, p));
}

/* ---------------------------------------------------------------- derived */

// If the rep says the deductible is $3,000 and $2,473.76 remains, then $526.24 has
// been met and nobody said it. Deriving that is arithmetic, not evidence — and the
// real ASH call records exactly what happens when the two are confused: our own
// agent computed $526.24 out loud, the rep never confirmed it, and the engine
// correctly reports the field as an echo.
//
// So: derive, hand it back separately, never auto-fill. bypass.js already counts
// "derived" as not-from-call, so an accepted derivation reads as calculated rather
// than as something the rep failed to say.
const DERIVATIONS = [
  { key: "dedMet", whole: "dedInd", part: "dedRem" },
  { key: "dedRem", whole: "dedInd", part: "dedMet" },
  { key: "oopMet", whole: "oop", part: "oopRem" },
  { key: "oopRem", whole: "oop", part: "oopMet" },
];

function deriveFrom(values) {
  const out = {};
  const amount = (k) => {
    const p = values[k];
    if (!p || p.confidence !== "high") return null;
    const n = Number(String(p.value).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  for (const d of DERIVATIONS) {
    if (values[d.key] || out[d.key]) continue;            // the rep said it
    const w = amount(d.whole), p = amount(d.part);
    if (w == null || p == null || w - p < 0) continue;    // both operands must be the rep's own words
    out[d.key] = {
      key: d.key, value: fmtMoney(w - p), source: "derived",
      confidence: "low", autoFill: false, from: [d.whole, d.part],
      why: `Nobody said this. It is ${fmtMoney(w)} minus ${fmtMoney(p)}, both of which the rep did state.`,
    };
  }
  return out;
}

/* ------------------------------------------------------------------ quote */

// Never crosses a turn boundary: a snippet running from the rep's answer into our
// own next question reads as though we said half of it.
function quoteAround(prep, ranges, span) {
  const turn = ranges && ranges.find((r) => span.start >= r.start && span.start < r.end);
  const from = turn ? turn.start : 0, to = turn ? turn.end : prep.text.length;
  const lo = Math.max(from, span.start - 70), hi = Math.min(to, span.end + 70);
  return (lo > from ? "…" : "") + prep.text.slice(lo, hi).replace(/\s+/g, " ").trim() + (hi < to ? "…" : "");
}

/* ------------------------------------------------------------------- main */

// A transcript this short is a fragment, not a call. The scorer already refuses
// one (MIN_TOKENS); the yes/no reader does not, because a short answer is a normal
// thing to find inside a long call. Applied here so both halves agree.
const MIN_TOKENS = 25;

export function extractFromTranscript(prep, { ranges = null, exclude = [] } = {}) {
  const values = {}, skipped = {};
  const claimed = [...exclude];
  const note = (key, reason) => { if (!(key in values)) skipped[key] = reason; };

  if (!prep || prep.toks.length < MIN_TOKENS) {
    for (const key of NEVER_EXTRACT) skipped[key] = policyReason(key);
    return { values, derived: {}, skipped, tooShort: true };
  }

  const propose = (key, value, hit, span, why) => ({
    key, value, cls: classOf(key), strict: isStrict(key),
    confidence: hit ? (hit.ambiguous || hit.score < 0.95 ? "low" : "high") : "high",
    autoFill: false,                                       // decided by autofill.js, never here
    score: hit ? Number(hit.score.toFixed(2)) : null,
    ambiguous: hit ? hit.ambiguous : false,
    span,
    speaker: ranges ? roleAt(ranges, span.start) : "unknown",
    quote: quoteAround(prep, ranges, span),
    anchorText: hit ? hit.anchorText : "",
    rivals: hit && hit.rival
      ? [{ text: prep.text.slice(hit.rival.s, hit.rival.e).trim(), score: Number(hit.rival.score.toFixed(2)) }]
      : [],
    why,
  });

  // ---- 1. yes / no ---------------------------------------------------------
  const yn = decideYesNo(prep);
  for (const f of VERIFY_FIELDS) {
    if (f.type !== "yesno" || NEVER_EXTRACT.has(f.key)) continue;
    const said = yn.get(f.key);
    if (!said) { note(f.key, "topic-never-came-up"); continue; }
    // decideYesNo is speaker-blind by design — it has to be, for a plain
    // transcript. Writing into the form, only the payer's voice counts.
    if (ranges && !saidByRep(ranges, [said.span])) { note(f.key, "said-by-us"); continue; }
    values[f.key] = propose(f.key, said.pol, null, said.span,
      `The rep's answer around this reads as ${said.pol}.`);
  }

  // ---- 2. network enums ----------------------------------------------------
  for (const key of ["network", "networkInd"]) {
    if (NEVER_EXTRACT.has(key)) continue;
    const n = networkFrom(prep, ranges, key);
    if (!n) { note(key, "topic-never-came-up"); continue; }
    values[key] = propose(key, n.value, null, n.span, `The rep said "${n.value.toLowerCase()}".`);
  }

  // ---- 3. numbers, dates, IDs ---------------------------------------------
  const measurable = (k) => {
    const m = ANCHORS[k] && ANCHORS[k].m;
    return !!m && m !== "none" && m !== "yesno" && m !== "enum2";
  };
  const pool = VERIFY_FIELDS.filter((f) => measurable(f.key) && !NEVER_EXTRACT.has(f.key));

  // Two passes. The first scores every field independently so the order can come
  // from the evidence rather than from the order of VERIFY_FIELDS; the second
  // re-runs each winner in tier order with the spans already taken excluded, so
  // one spoken number is never claimed by dedInd, dedMet and dedRem at once.
  // Re-running is nearly free — prep memoises the sites and candidates.
  const ranked = pool
    .map((f) => ({ f, first: findBest(prep, f, { ranges }) }))
    .filter((x) => { if (!x.first.hit) note(x.f.key, x.first.reason); return !!x.first.hit; })
    .sort((a, b) => tier(a.f.key) - tier(b.f.key) || b.first.hit.score - a.first.hit.score);

  for (const { f } of ranked) {
    const { hit, reason } = findBest(prep, f, { exclude: claimed, ranges });
    if (!hit) { note(f.key, reason === "no-candidate" ? "already-claimed" : reason); continue; }
    const value = valueOf(prep, hit.m, hit.cand);
    if (value == null) { note(f.key, "cannot-format"); continue; }
    claimed.push(hit.span);
    values[f.key] = propose(f.key, value, hit, hit.span,
      `Nearest figure to "${hit.anchorText}" in the rep's own words.`);
  }

  // Iterated directly rather than through VERIFY_FIELDS: `today`, `verifiedBy` and
  // `note` are not verifiable fields at all, which is precisely why they are here.
  for (const key of NEVER_EXTRACT) skipped[key] = policyReason(key);

  return { values, derived: deriveFrom(values), skipped };
}

// Values the rep stated that our side would otherwise never see, because
// extraction refuses agent turns. Silence is the dangerous outcome, so these are
// surfaced as suggestions rather than dropped.
export function agentOnlyObservations(prep, ranges) {
  if (!ranges) return {};
  const out = {};
  const measurable = (k) => {
    const m = ANCHORS[k] && ANCHORS[k].m;
    return !!m && m !== "none" && m !== "yesno" && m !== "enum2";
  };
  for (const f of VERIFY_FIELDS) {
    if (!measurable(f.key) || NEVER_EXTRACT.has(f.key)) continue;
    const withRep = findBest(prep, f, { ranges });
    if (withRep.hit) continue;                             // the rep did say it
    const blind = findBest(prep, f, { ranges: null });
    if (!blind.hit) continue;
    if (roleAt(ranges, blind.hit.span.start) !== "agent") continue;
    const value = valueOf(prep, blind.hit.m, blind.hit.cand);
    if (value == null) continue;
    out[f.key] = {
      key: f.key, value, span: blind.hit.span,
      quote: quoteAround(prep, ranges, blind.hit.span),
      why: "Only our side said this — the rep did not confirm it.",
    };
  }
  return out;
}
