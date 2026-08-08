import test from "node:test";
import assert from "node:assert/strict";
import {
  decide, applyExtraction, useSuggestion, acceptFields, rejectField,
  unreviewedKeys, clearAutofilled, FILL_MIN, FILL_MIN_STRICT, NEVER_AUTO,
} from "./autofill.js";
import { extractFromTranscript } from "./extract.js";
import { checkTranscript, getPrep } from "./verify.js";
import { parseTranscript } from "./transcriptParse.js";
import { ASH_CALL, FILLED } from "./ash.fixture.js";

// extract.js answers "what did the rep say?". This answers "are we willing to type
// it for them?" — a different question with a much higher cost of being wrong,
// because a plausible wrong number gets skimmed past.

const parsed = parseTranscript(ASH_CALL, { insName: FILLED.insName, verifiedBy: "Savi Sharma" });
const prep = getPrep(parsed.text);
const x = extractFromTranscript(prep, { ranges: parsed.ranges });
const d = decide(x, prep);

// A hand-built extraction, so each guard can be aimed at directly.
const P = (key, value, over = {}) => ({
  key, value, score: 1.2, confidence: "high", ambiguous: false, rivals: [],
  span: { start: 0, end: 1 }, quote: "…", why: "", cls: "ask", strict: false, ...over,
});
const only = (...ps) => ({ values: Object.fromEntries(ps.map((p) => [p.key, p])), derived: {}, skipped: {} });

// A prep whose tokens carry no qualifier, so hasOwnQualifier() fails for any
// grouped non-base field unless a test supplies one.
const bare = getPrep("the rep read out a long list of numbers for this member today and then moved on to the next question entirely");

// ---------------- the real call ----------------

test("AUTOFILL the real call fills only what is safe to fill", () => {
  assert.ok(d.counts.fill > 0, "something must be worth filling");
  for (const [k, p] of Object.entries(d.fill)) {
    assert.ok(p.score == null || p.score >= FILL_MIN, `${k} @${p.score}`);
    assert.ok(!NEVER_AUTO.has(k), `${k} must never be auto-filled`);
  }
});

test("AUTOFILL what it writes survives the engine that grades it", () => {
  // A proposal that cannot come back `found` is not a proposal — it is a defect the
  // operator would have to clear before saving. The matcher has never seen the
  // extractor's reasoning, so this is a genuine second reader.
  const out = applyExtraction({}, {}, d, { transcript: parsed.text, ranges: parsed.ranges });
  assert.ok(out.filled.length > 0);
  assert.deepEqual(out.rejected, [], "nothing written should fail its own verification");

  const r = checkTranscript(out.form, parsed.text, out.meta, { ranges: parsed.ranges });
  for (const k of out.filled) {
    const c = r.checks.find((x2) => x2.key === k);
    assert.equal(c.status, "autofill", `${k} should read as machine-read and unchecked`);
  }
  assert.equal(r.verdict, "ATTESTED", "not APPROVED — a machine read these");
});

test("AUTOFILL filling the coinsurance is what makes the rep's second answer findable", () => {
  // The rep says "20%" and, two turns later, "30%". Only the first is anchored, so
  // extraction proposes 20% — and writing it is what lets checkTranscript's
  // contested pass go looking and find the 30%. An empty field produces no dispute
  // at all, so the operator would never learn the rep gave two answers.
  assert.ok("coinsAmt" in d.fill);
  const out = applyExtraction({}, {}, d, { transcript: parsed.text, ranges: parsed.ranges });
  const r = checkTranscript(out.form, parsed.text, out.meta, { ranges: parsed.ranges });
  assert.ok(r.contested.includes("coinsAmt"));
  assert.match(String(r.checks.find((c) => c.key === "coinsAmt").dispute.heard), /30/);
});

test("AUTOFILL a rival the extractor itself saw is never written", () => {
  // Where findBest reports the ambiguity directly, the operator picks. Extraction
  // may not resolve a question they would have had to resolve by hand.
  const g = decide(only(P("dedRem", "$500.00", {
    strict: true, ambiguous: true, rivals: [{ text: "$900.00", score: 1.1 }],
  })), bare);
  assert.ok(!("dedRem" in g.fill));
  assert.match(g.contested.dedRem.why, /and also/);
});

// ---------------- the guards ----------------

test("AUTOFILL a grouped figure without its own qualifier is suggested, never filled", () => {
  // "dedRem" with no "remaining"/"left"/"balance" in reach is a guess about which
  // sibling you heard. In the client's own call that span carries "family".
  const g = decide(only(P("dedRem", "$473.76", { strict: true })), bare);
  assert.ok(!("dedRem" in g.fill));
  assert.match(g.suggest.dedRem.why, /did not name which figure/);
});

test("AUTOFILL money fields clear a higher bar than the rest", () => {
  // effDate and dedInd are both anchored without needing a sibling qualifier, so
  // the only thing separating them here is the bar.
  const mid = (FILL_MIN + FILL_MIN_STRICT) / 2;
  const g = decide(only(
    P("effDate", "2025-10-01", { score: mid }),
    P("dedInd", "$3000.00", { score: mid, strict: true }),
  ), bare);
  assert.ok("effDate" in g.fill, "an ordinary field passes at this score");
  assert.ok("dedInd" in g.suggest, "a money field does not");
  assert.match(g.suggest.dedInd.why, /money field/);
});

test("AUTOFILL one figure cannot answer two fields in the same group", () => {
  // $3,000 cannot be both the deductible and the amount remaining on it.
  const g = decide(only(
    P("dedInd", "$3000.00", { strict: true }),
    P("dedRem", "$3000.00", { strict: true }),
  ), getPrep("the individual deductible remaining on this plan for the member is the figure we are discussing today at some length"));
  assert.ok(!("dedInd" in g.fill) && !("dedRem" in g.fill));
  assert.match(g.blocked.dedInd.why, /two fields/);
});

test("AUTOFILL a trio that does not add up blocks all three", () => {
  // The only genuinely independent reader left once the operator stops typing.
  // Neither engine nor confidence has any say in whether 500 + 2500 is 3000.
  const g = decide(only(
    P("dedInd", "$3000.00", { strict: true }),
    P("dedMet", "$500.00", { strict: true }),
    P("dedRem", "$900.00", { strict: true }),
  ), bare);
  for (const k of ["dedInd", "dedMet", "dedRem"]) {
    assert.ok(k in g.blocked, `${k} should be held back`);
    assert.match(g.blocked[k].why, /does not make/);
  }
});

test("AUTOFILL a trio that does add up is not blocked by the identity", () => {
  const g = decide(only(
    P("dedInd", "$3000.00", { strict: true }),
    P("dedMet", "$500.00", { strict: true }),
    P("dedRem", "$2500.00", { strict: true }),
  ), bare);
  for (const k of ["dedInd", "dedMet", "dedRem"]) assert.ok(!(k in g.blocked), k);
});

test("AUTOFILL coverage and co-insurance must make 100%", () => {
  const bad = decide(only(P("covPct", "80%", { strict: true }), P("coinsAmt", "30%", { strict: true })), bare);
  assert.ok("covPct" in bad.blocked && "coinsAmt" in bad.blocked);
  const good = decide(only(P("covPct", "80%", { strict: true }), P("coinsAmt", "20%", { strict: true })), bare);
  assert.ok(!("covPct" in good.blocked) && !("coinsAmt" in good.blocked));
});

test("AUTOFILL an implausible figure is refused whatever the score", () => {
  // A garbled "18 days" where the rep said "180" is caught here without consulting
  // the machine's opinion of itself.
  const g = decide(only(P("tfl", "5 DAYS"), P("authAfter", "400")), bare);
  assert.match(g.blocked.tfl.why, /outside the range/);
  assert.match(g.blocked.authAfter.why, /outside the range/);
});

test("AUTOFILL the termination date and auth number are never written", () => {
  // A wrong termination date tells a practice to stop treating a covered patient;
  // an auth number read out mid-call is often the previous episode's.
  const g = decide(only(P("termDate", "2026-12-31"), P("authNum", "556677")), bare);
  for (const k of ["termDate", "authNum"]) {
    assert.ok(!(k in g.fill), k);
    assert.match(g.suggest[k].why, /never filled automatically/);
  }
});

test("AUTOFILL a value the operator already typed is never overwritten", () => {
  const g = decide(only(P("groupId", "00633434")), bare, { form: { groupId: "TYPED" } });
  assert.ok(!("groupId" in g.fill));
  assert.match(g.suggest.groupId.why, /already entered/);

  const out = applyExtraction({ groupId: "TYPED" }, {}, decide(only(P("groupId", "00633434")), bare));
  assert.equal(out.form.groupId, "TYPED");
});

// ---------------- the audit trail ----------------

test("AUTOFILL a written value carries its evidence and waits for a human", () => {
  const out = applyExtraction({}, {}, d, { transcript: parsed.text, ranges: parsed.ranges });
  const k = out.filled[0];
  const ex = out.meta[k].extract;
  assert.equal(out.meta[k].source, "call");
  assert.equal(ex.review, null, "nobody has looked yet");
  assert.ok(ex.quote && ex.engine && ex.at);
  assert.deepEqual(unreviewedKeys(out.meta).sort(), [...out.filled].sort());
});

test("AUTOFILL accepting records who signed and when", () => {
  const out = applyExtraction({}, {}, d, { transcript: parsed.text, ranges: parsed.ranges });
  const meta = acceptFields(out.meta, out.filled, "SP");
  for (const k of out.filled) {
    assert.equal(meta[k].extract.review.action, "accepted");
    assert.equal(meta[k].extract.review.by, "SP");
  }
  assert.deepEqual(unreviewedKeys(meta), []);
  const r = checkTranscript(out.form, parsed.text, meta, { ranges: parsed.ranges });
  for (const k of out.filled) {
    assert.equal(r.checks.find((c) => c.key === k).status, "attested");
  }
});

test("AUTOFILL accepting a suggestion lands already signed", () => {
  // The operator chose it against a visible quote — that IS the act we are asking
  // for, so it does not need a second look.
  const p = P("termDate", "2026-12-31");
  const { form, meta } = useSuggestion({}, {}, p, "SP");
  assert.equal(form.termDate, "2026-12-31");
  assert.equal(meta.termDate.extract.review.action, "used-suggestion");
  assert.deepEqual(unreviewedKeys(meta), []);
});

test("AUTOFILL rejecting clears the value and records that it was rejected", () => {
  const out = applyExtraction({}, {}, d, { transcript: parsed.text, ranges: parsed.ranges });
  const k = out.filled[0];
  const after = rejectField(out.form, out.meta, k, "SP");
  assert.equal(after.form[k], "");
  assert.equal(after.meta[k].extract.review.action, "rejected");
  assert.equal(after.meta[k].source, "manual");
});

test("AUTOFILL clearing drops what the machine wrote and keeps what the operator typed", () => {
  const out = applyExtraction({ policyId: "TYPED" }, {}, d, { transcript: parsed.text, ranges: parsed.ranges });
  const cleared = clearAutofilled(out.form, out.meta);
  assert.equal(cleared.form.policyId, "TYPED");
  for (const k of out.filled) assert.equal(cleared.form[k], "");
  assert.deepEqual(unreviewedKeys(cleared.meta), []);
});

test("AUTOFILL an accepted value survives a clear", () => {
  const out = applyExtraction({}, {}, d, { transcript: parsed.text, ranges: parsed.ranges });
  const k = out.filled[0];
  const meta = acceptFields(out.meta, [k], "SP");
  const cleared = clearAutofilled(out.form, meta);
  assert.equal(cleared.form[k], out.form[k], "a signed value is not swept away");
});

// ---------------- the round trip refuses contradiction, not silence ----------------

// A decision object holding exactly these proposals, so applyExtraction can be
// aimed at directly without decide()'s guards standing in the way.
const fillOnly = (obj) => ({ fill: obj, suggest: {}, contested: {}, blocked: {}, derived: {}, skipped: {},
  counts: { fill: Object.keys(obj).length, suggest: 0, contested: 0, blocked: 0 } });

test("AUTOFILL a value the matcher contradicts is never written", () => {
  // The safety property that matters: two routes to the same value, and if the
  // second says the rep said something else, the first one loses.
  const g = fillOnly({ tfl: { ...d.fill.tfl, value: "90 DAYS" } });
  const out = applyExtraction({}, {}, g, { transcript: parsed.text, ranges: parsed.ranges });
  assert.deepEqual(out.filled, [], "the rep said 180 days");
  assert.deepEqual(out.rejected, ["tfl"]);
});

test("AUTOFILL a value the matcher merely cannot re-find is still written", () => {
  // The two engines reach a value by different routes, and the matcher has blind
  // spots the extractor exists to cover — it cannot see a bare "No, it is not."
  // answering a question asked a turn earlier. Demanding it independently
  // rediscover every proposal threw away one in six, all of them correct.
  const out = applyExtraction({}, {}, d, { transcript: parsed.text, ranges: parsed.ranges });
  assert.deepEqual(out.rejected, []);
  assert.equal(out.filled.length, Object.keys(d.fill).length);
});

test("AUTOFILL nothing is written without a transcript to check against", () => {
  // Skipping the check would write every proposal with nothing having verified it,
  // which is the one thing this function exists to prevent.
  const g = fillOnly({ groupId: d.fill.groupId });
  const out = applyExtraction({}, {}, g, { transcript: "", ranges: null });
  assert.deepEqual(out.filled, []);
  assert.deepEqual(out.rejected, ["groupId"]);
});
