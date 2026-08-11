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
import { ANCHORS, OWN_Q, KEYWORD_WINDOW, SERVICE_WORDS } from "./anchors.js";
import { VERIFY_FIELDS, findBest, decideYesNo, matchEnum, saidByRep, yesNoTopicsIn, polarityIn } from "./verify.js";
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

// Our clock, our staff, our own scheduling, the work-tracking fields, and a
// narrative generated from the other fields. Nothing here is the payer's to say.
const INTERNAL = new Set(["today", "verifiedBy", "note", "pat",
  "projectName", "category", "requestMode", "requestDate", "verifType", "username", "initialTx"]);

export const NEVER_EXTRACT = new Set([...PROSE, ...IDENTITY, ...INTERNAL]);

// serviceType is prose by measurement — there is no number or date to anchor — but
// it is the one prose field drawn from a closed set of four disciplines, so it can
// be read off the words directly rather than guessed at. See serviceTypeFrom.
NEVER_EXTRACT.delete("serviceType");

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

const YESNO_KEYS = VERIFY_FIELDS.filter((f) => f.type === "yesno").map((f) => f.key);

// The one yes/no field whose own qualifier this stretch of text uses. Returns
// null when none or more than one match — a word shared by two fields places
// neither.
function onlyQualifierMatch(prep, start, end) {
  const words = new Set(prep.toks.filter((t) => t.start >= start && t.end <= end).map((t) => t.t));
  const hits = YESNO_KEYS.filter((k) => {
    const own = OWN_Q.get(k);
    if (!own || !own.size) return false;
    for (const w of own) if (words.has(w)) return true;
    return false;
  });
  return hits.length === 1 ? hits[0] : null;
}

// An actual yes or no, in words. Without this the "an amount is itself an answer"
// rule inside the polarity reader makes any figure count as a YES — and a reply of
// "180 days from the date of service" then answers a question it was never asked.
const RE_EXPLICIT = /\b(?:yes|yeah|yep|yup|correct|right|affirmative|no|nope|nah|not|never|none)\b/i;

// "We wouldn't be able to see that on our end" is not a no. It is the rep saying
// they cannot tell you, which is the one answer the form must not record as fact.
const RE_NON_ANSWER = /\b(?:not able|wouldn'?t be able|would not be able|can'?t see|cannot see|can'?t tell|don'?t have|do not have|unable|no access|not showing|wouldn'?t know|check with)\b/i;

// A polar question — one that can be answered yes or no. A "what is…" question
// takes a value, and reading its answer as a polarity is how a deductible figure
// came to decide whether authorization was required.
const RE_WH = /\b(?:what|when|where|which|who|why|how)\b/i;
const RE_AUX = /\b(?:is|are|was|were|do|does|did|can|could|will|would|should|has|have|had|any)\b/i;

function isPolarQuestion(text) {
  if (RE_WH.test(text)) return false;
  if (RE_AUX.test(text)) return true;
  // An elliptical follow-up — "And for treatment?" — carries no auxiliary because
  // the previous question supplied it.
  return text.trim().split(/\s+/).length <= 6;
}

// "Is authorization required for the initial evaluation?" / "Yes."
//
// The answer carries no topic of its own, so decideYesNo — which needs an anchor
// in the same clause — cannot see it at all. On a normally conducted call that is
// how most of the yes/no fields are established, which is why four of them came
// back blank on a transcript where the rep answered every one of them plainly.
function yesNoFromAnswers(prep, ranges) {
  const out = {};
  if (!ranges) return out;

  for (let t = 1; t < ranges.length; t++) {
    if (ranges[t].role !== "rep") continue;
    // Walk back over the rep's own filler ("One moment.") to the question.
    let q = t - 1;
    while (q >= 0 && ranges[q].role !== "agent" && t - q <= 2) q--;
    if (q < 0 || ranges[q].role !== "agent") continue;

    // A short, direct reply. A long one has moved on to another subject and its
    // own anchors will be found the ordinary way.
    if (ranges[t].end - ranges[t].start > 120) continue;
    const answer = prep.text.slice(ranges[t].start, ranges[t].end);
    const question = prep.text.slice(ranges[q].start, ranges[q].end);
    if (!isPolarQuestion(question)) continue;
    if (!RE_EXPLICIT.test(answer) || RE_NON_ANSWER.test(answer)) continue;
    const said = polarityIn(prep, ranges[t].start, ranges[t].end);
    if (!said) continue;

    // Which topic was asked. Fields sharing a head are separated by whichever
    // one's own qualifier the question actually used; a tie names neither.
    const topics = yesNoTopicsIn(prep, ranges[q].start, ranges[q].end);
    let key = null;
    if (topics.size) {
      const best = Math.max(...topics.values());
      const winners = [...topics].filter(([, hits]) => hits === best).map(([k]) => k);
      if (winners.length !== 1) continue;
      key = winners[0];
    } else {
      // An elliptical follow-up — "And for treatment?" — carries no head of its
      // own; the subject was established by the question before it. A qualifier
      // that belongs to exactly one yes/no field is enough to place it, and a
      // word shared by two is not.
      key = onlyQualifierMatch(prep, ranges[q].start, ranges[q].end);
      if (!key) continue;
    }
    if (out[key]) continue;                      // the first answer stands
    out[key] = { pol: said.pol, span: said.span, qSpan: { start: ranges[q].start, end: ranges[q].end } };
  }
  return out;
}

function nearHead(prep, span, heads) {
  const ti = prep.toks.findIndex((t) => t.end > span.start);
  if (ti < 0) return false;
  const lo = Math.max(0, ti - KEYWORD_WINDOW), hi = Math.min(prep.toks.length, ti + KEYWORD_WINDOW);
  const words = prep.toks.slice(lo, hi).map((t) => t.t);
  return (heads || []).some((p) => hasPhrase(words, p));
}

/* ----------------------------------------------------------- service type */

// The words that mark our own agent stating the purpose of the call: "benefits
// for physical therapy", "calling about chiropractic". Not any mention — a
// discipline named in passing is not what this verification is for.
const REQUEST_HEADS = [
  ["benefits", "for"], ["eligibility", "for"], ["coverage", "for"], ["verify"],
  ["verification", "for"], ["calling", "about"], ["calling", "for"], ["regarding"],
  ["need"], ["want"], ["checking", "on"], ["check", "on"],
];

function findAll(prep, phrase) {
  const out = [];
  for (let i = 0; i + phrase.length <= prep.toks.length; i++) {
    let ok = true;
    for (let k = 0; k < phrase.length; k++) if (prep.toks[i + k].t !== phrase[k]) { ok = false; break; }
    if (ok) out.push({ i, span: { start: prep.toks[i].start, end: prep.toks[i + phrase.length - 1].end } });
  }
  return out;
}

// True if one of REQUEST_HEADS sits just before this discipline. The window is
// short on purpose: "benefits for physical therapy" qualifies, "benefits … and by
// the way the patient also had physical therapy last year" does not.
const isRequested = (prep, i) => {
  const words = prep.toks.slice(Math.max(0, i - 4), i).map((t) => t.t);
  return REQUEST_HEADS.some((h) => hasPhrase(words, h));
};

// serviceType is the one field where our own agent is the authority. They are the
// ones who know which discipline this verification is for — it is the reason for
// the call, stated in its opening line. The rep only ever confirms it, and often
// answers by reading out every discipline the plan covers, which is a different
// fact. So:
//
//   one discipline from the rep          -> that one
//   several from the rep, one requested  -> the requested one; the rep was listing
//                                           what the plan covers, our agent was
//                                           saying which one we are billing
//   none from the rep, one requested     -> the requested one, marked as ours
//
// The real ASH call is the argument for the middle rule: the rep says "physical
// therapy occupational therapy benefits", and the VOB says PT, because PT is what
// the agent asked about in the first turn.
function serviceTypeFrom(prep, ranges) {
  const rep = [], asked = [];
  for (const s of SERVICE_WORDS) {
    let repHit = null, askedHit = null;
    for (const h of findAll(prep, s.phrase)) {
      const byRep = !ranges || saidByRep(ranges, [h.span]);
      if (byRep && !repHit) repHit = { value: s.value, span: h.span };
      if (!byRep && !askedHit && isRequested(prep, h.i)) askedHit = { value: s.value, span: h.span };
    }
    if (repHit) rep.push(repHit);
    if (askedHit) asked.push(askedHit);
  }

  if (rep.length === 1) return { ...rep[0], by: "rep" };
  if (asked.length === 1) {
    const a = asked[0];
    // Only where the rep either said nothing or included it in their list. A rep
    // naming a different discipline entirely is a disagreement, not a detail.
    if (!rep.length || rep.some((r) => r.value === a.value)) return { ...a, by: "agent" };
  }
  return null;
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
  const answered = yesNoFromAnswers(prep, ranges);
  for (const f of VERIFY_FIELDS) {
    if (f.type !== "yesno" || NEVER_EXTRACT.has(f.key)) continue;

    // A bare "Yes." answering a question that named the topic. Preferred over the
    // clause reader: the rep answering the question they were just asked is the
    // most direct evidence there is.
    if (answered[f.key]) {
      const a = answered[f.key];
      values[f.key] = propose(f.key, a.pol, null, a.span,
        `The rep answered ${a.pol} to a question about this.`);
      continue;
    }

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

  // ---- 2b. service type ----------------------------------------------------
  {
    const svc = serviceTypeFrom(prep, ranges);
    if (svc) {
      values.serviceType = propose("serviceType", svc.value, null, svc.span,
        svc.by === "rep" ? "The rep named this discipline."
          : "This is the discipline the call was placed about.");
    } else note("serviceType", "topic-never-came-up");
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
