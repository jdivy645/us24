import test from "node:test";
import assert from "node:assert/strict";
import { getPrep } from "./verify.js";
import { extractFromTranscript } from "./extract.js";
import { decide, applyExtraction } from "./autofill.js";
import { parseTranscript } from "./transcriptParse.js";
import { ASH_CALL, TRUTH } from "./ash.fixture.js";
import { CLEAN_CALL, CLEAN_TRUTH } from "./clean.fixture.js";

// How much of the form the call fills, on two transcripts that fail in opposite
// directions: one real and badly transcribed, one conducted the ordinary way.
//
// The numbers below are floors, not targets. They exist so that a change which
// quietly loses coverage fails here rather than being discovered by an operator
// typing something the machine used to know — and so that the ratio of right to
// wrong stays where it is. Raise them when the work earns it.

const fillFor = (call, insName, agent) => {
  const p = parseTranscript(call, { insName, verifiedBy: agent });
  const prep = getPrep(p.text);
  const d = decide(extractFromTranscript(prep, { ranges: p.ranges }), prep, { form: {} });
  return Object.fromEntries(Object.entries(d.fill).map(([k, x]) => [k, x.value]));
};

const grade = (got, truth) => {
  const agrees = (a, b) => String(b).toUpperCase().startsWith(String(a).toUpperCase());
  const right = [], wrong = [];
  for (const [k, val] of Object.entries(got)) {
    if (!(k in truth)) continue;              // proposing beyond the graded set is not an error
    (agrees(val, truth[k]) ? right : wrong).push(k in truth ? `${k}: ${val} vs ${truth[k]}` : k);
  }
  return { right, wrong };
};

const ASH = fillFor(ASH_CALL, "CIGNA ASH", "Savi Sharma");
const CLEAN = fillFor(CLEAN_CALL, "AETNA", "Agent");

test("COVERAGE a well-conducted call fills most of the form", () => {
  const { right, wrong } = grade(CLEAN, CLEAN_TRUTH);
  assert.deepEqual(wrong, [], "nothing filled may disagree with what the rep said");
  assert.ok(right.length >= 22, `expected at least 22 of ${Object.keys(CLEAN_TRUTH).length}, got ${right.length}: ${right.join(", ")}`);
});

test("COVERAGE the yes/no answers come from the rep's replies", () => {
  // "Is authorization required for the initial evaluation?" / "Yes." — the answer
  // carries no topic of its own, so the clause reader cannot see it. On a normal
  // call this is how most of these are established.
  for (const k of ["authEval", "authTx", "referral", "pcpRef"]) {
    assert.equal(CLEAN[k], CLEAN_TRUTH[k], k);
  }
});

test("COVERAGE an elliptical follow-up is placed by its qualifier", () => {
  // "And for treatment?" names no topic — the question before it did.
  assert.equal(CLEAN.authTx, "YES");
});

test("COVERAGE the deductible and out-of-pocket trios both fill", () => {
  for (const k of ["dedInd", "dedMet", "dedRem", "oop", "oopMet", "oopRem"]) {
    assert.equal(CLEAN[k], CLEAN_TRUTH[k], k);
  }
});

test("COVERAGE a real, badly transcribed call fills less — but nothing wrong", () => {
  const { right, wrong } = grade(ASH, TRUTH);
  assert.deepEqual(wrong, [], "a wrong value is worse than a blank one");
  assert.ok(right.length >= 10, `expected at least 10, got ${right.length}`);
});

test("COVERAGE the messy call still catches all four data-entry defects", () => {
  assert.equal(ASH.tfl, "180 DAYS");
  assert.equal(ASH.authAfter, "8");
  assert.equal(ASH.dedRem, "$473.76");
  assert.equal(ASH.dedMet, "$0.00");
});

test("COVERAGE a rep who cannot answer is not recorded as having said no", () => {
  // "Is the member having any secondary insurance?" / "No, we wouldn't be able to
  // see that on our end." That is the rep declining to answer. Writing NO would
  // put a fact on the record that nobody established.
  assert.equal(ASH.hasSec, undefined);
});

test("COVERAGE a value answer never decides a yes/no field", () => {
  // The reply "180 days from the date of service" once answered a question about
  // authorization, because a figure counted as a YES and the word "initial"
  // appeared in a question about initial claims.
  assert.equal(ASH.authEval, undefined);
});

test("COVERAGE the discipline comes from whoever named it unambiguously", () => {
  // The one field where our own side is the authority. On the clean call only the
  // agent names it; on the real one the rep lists two and the agent named one.
  assert.equal(CLEAN.serviceType, "PT");
  assert.equal(ASH.serviceType, "PT");
});

test("COVERAGE everything decided fillable actually survives being written", () => {
  // decide() and applyExtraction() disagree by design — the second re-verifies the
  // first against an engine that has not seen its reasoning. When that gap opens,
  // proposals vanish silently and the operator types them by hand. It was one in
  // six before the round trip was narrowed to active contradiction only.
  for (const [nm, call, ins, ag] of [["clean", CLEAN_CALL, "AETNA", "Agent"], ["real", ASH_CALL, "CIGNA ASH", "Savi Sharma"]]) {
    const p = parseTranscript(call, { insName: ins, verifiedBy: ag });
    const prep = getPrep(p.text);
    const d = decide(extractFromTranscript(prep, { ranges: p.ranges }), prep, { form: {} });
    const out = applyExtraction({}, {}, d, { transcript: p.text, ranges: p.ranges });
    assert.deepEqual(out.rejected, [], `${nm}: written off after being decided fillable`);
    assert.equal(out.filled.length, Object.keys(d.fill).length, nm);
  }
});
