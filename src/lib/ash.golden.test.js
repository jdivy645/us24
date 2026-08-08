import test from "node:test";
import assert from "node:assert/strict";
import { checkTranscript } from "./verify.js";
import { parseTranscript } from "./transcriptParse.js";
import { ASH_CALL, FILLED, META } from "./ash.fixture.js";

// The real ASH/Cigna eligibility call and the VOB that was typed from it, both
// supplied by the client. Reproduced verbatim, speech-to-text noise and all —
// the noise is the point. Cross-checking the two surfaces exactly the failure
// modes this engine exists to catch:
//
//   * the rep says "20%" and then "30%" for the same coinsurance
//   * the call says the eighth visit; the VOB says the fifth
//   * the rep says 180-day timely filing; the VOB says 90 (from carrier data)
//   * $526.24 deductible-met was said by OUR agent, never confirmed by the rep
//   * $1026.24 OOP-met was said by nobody — it is 6500 - 5473.76
//   * payer ID, plan type, payer phone and claim address were never spoken at all
//
// If this file starts failing, the engine has regressed on real data.

const parsed = parseTranscript(ASH_CALL, { insName: FILLED.insName, verifiedBy: "Savi Sharma" });
const run = (form = FILLED, meta = META) =>
  checkTranscript(form, parsed.text, meta, { ranges: parsed.ranges });

const find = (r, key) => r.checks.find((c) => c.key === key) || {};
const st = (r, key) => find(r, key).status;

// ---------------- the transcript itself ----------------

test("GOLDEN the export parses as a RingCentral transcript with both speakers placed", () => {
  assert.equal(parsed.format, "ringcentral");
  const byName = Object.fromEntries(parsed.speakers.map((s) => [s.name, s.role]));
  assert.equal(byName["ASH"], "rep");
  assert.equal(byName["Savi Sharma"], "agent");
});

test("GOLDEN the phone menu is dropped, taking its numbers with it", () => {
  assert.ok(!parsed.text.includes("833-695-1781"), "the IVR's direct line must not become a candidate value");
  assert.ok(!/press 9/i.test(parsed.text));
  assert.ok(parsed.text.includes("20874738"), "real content survives");
});

test("GOLDEN speaker headers and timestamps never reach the matcher", () => {
  assert.ok(!parsed.text.includes("Aug 4, 2026"));
  assert.ok(!/ASH \|/.test(parsed.text));
  assert.ok(!/08:4\d/.test(parsed.text), "clock digits would pollute the digit stream");
});

// ---------------- the three data-entry defects ----------------

test("GOLDEN the rep's 20%-then-30% coinsurance is surfaced", () => {
  const r = run();
  const c = find(r, "coinsAmt");
  assert.equal(c.status, "found", "20% really was said");
  assert.ok(c.dispute, "the rep also said 30% — the verifier must pick a side");
  assert.match(String(c.dispute.heard), /30/);
  assert.ok(r.contested.includes("coinsAmt"));
});

test("GOLDEN the 5th-vs-8th visit auth threshold is caught", () => {
  const r = run();
  assert.equal(st(r, "authAfter"), "mismatch", "the call says the eighth visit, not the fifth");
  assert.match(String(find(r, "authAfter").heard), /eight/i);
  assert.ok(r.mismatched.includes("authAfter"));
});

test("GOLDEN correcting the auth threshold to what the call said clears it", () => {
  const r = run({ ...FILLED, authAfter: "8" });
  assert.equal(st(r, "authAfter"), "found");
});

test("GOLDEN the 90-vs-180 day TFL is caught even though TFL is carrier data", () => {
  const r = run();
  assert.equal(st(r, "tfl"), "mismatch", "provenance must never silence a contradiction");
  assert.match(String(find(r, "tfl").heard), /180/);
  assert.ok(r.mismatched.includes("tfl"));
});

test("GOLDEN a contradiction quotes the rep, never our own agent's garble", () => {
  // Our agent misreads it back as "18 days" two turns later. Quoting that instead
  // of the rep's "180 days" would send someone to argue against their own words.
  const r = run();
  assert.ok(!/\b18 days/.test(String(find(r, "tfl").heard)));
});

// ---------------- who said it ----------------

test("GOLDEN a figure only our own agent said is not treated as confirmed", () => {
  // The portal shows one visit used and Savi says so out loud; the rep says they
  // have used none. Our own side asserting a number is not the payer stating it.
  const r = run();
  assert.equal(st(r, "visitUsed"), "echo");
  assert.ok(r.echoed.includes("visitUsed"));
  assert.ok(!find(r, "visitUsed").found);
});

test("GOLDEN speaker attribution changes the outcome", () => {
  // Same transcript, no roles: our agent's own "$526.24" confirms the form, and a
  // wrong figure passes. With roles, the rep's "zero dollars" contradicts it.
  const blind = checkTranscript(FILLED, parsed.text, META);
  assert.equal(st(blind, "dedMet"), "found");
  assert.equal(st(run(), "dedMet"), "mismatch");
});

test("GOLDEN the rep's own met amount contradicts the figure our agent computed", () => {
  // "What is the Met amount?" / "They showing zero dollars." The rep answered it.
  // Savi later asserts $526.24 — arithmetic off the deductible, not something the
  // payer said — and that is what reached the VOB. A fourth defect in this record.
  const r = run();
  assert.equal(st(r, "dedMet"), "mismatch");
  assert.match(String(find(r, "dedMet").heard), /zero/i);
  assert.equal(FILLED.dedMet, "$526.24");
});

// ---------------- values that were never going to be spoken ----------------

test("GOLDEN never-spoken carrier fields produce no false failures", () => {
  const r = run();
  for (const k of ["payerId", "planType", "insPhone"]) {
    assert.equal(st(r, k), "carrier", `${k} should be marked as carrier data`);
    assert.ok(!r.missing.includes(k), `${k} must not count as missing from the call`);
  }
  assert.equal(st(r, "oopMet"), "carrier", "OOP met is 6500 - 5473.76, said by nobody");
  assert.equal(st(r, "termDate"), "bypassed");
  assert.ok(!r.missing.includes("termDate"));
});

test("GOLDEN the fields we already hold never sink the record, marker or not", () => {
  // The red class on the client's template. Payer ID, filing limits, claim
  // address and payer phone come from our own records; the rep is never asked to
  // read them out, so their silence is not a defect. This holds with no meta at
  // all — the operator should not have to mark anything for it to be true.
  const r = run(FILLED, {});
  for (const k of ["payerId", "insPhone"]) {
    assert.equal(st(r, k), "carrier", k);
    assert.ok(!r.missing.includes(k), `${k} must never count as missing from the call`);
  }
  // A green field the rep genuinely should have given still fails.
  assert.ok(r.missing.includes("planType"), "plan type is asked on the call, and it was not given");
  // And the class excuses silence, never a contradiction: the filing limit is red
  // too, and the rep saying 180 against our 90 still rejects the record.
  assert.equal(st(r, "tfl"), "mismatch");
  assert.ok(r.mismatched.includes("tfl"));
});

test("GOLDEN the patient's identity is still checked, even though we hold it too", () => {
  // A form that says ROBINSON when nobody in the call said ROBINSON is the worst
  // failure this product can have. It is red on the template and still fails.
  const r = run({ ...FILLED, lastName: "ROBINSON" }, META);
  assert.equal(st(r, "lastName"), "missing");
  assert.equal(r.verdict, "REJECTED");
});

// ---------------- what the call did establish ----------------

test("GOLDEN the details the rep did state are confirmed", () => {
  const r = run();
  for (const k of ["policyId", "groupId", "callRef", "effDate", "oopRem", "dob", "firstName", "visitLimit", "repName"]) {
    assert.equal(st(r, k), "found", `${k} was clearly stated on the call`);
  }
});

test("GOLDEN a bare 'no' correcting the previous turn is not read as a denial", () => {
  // "Well no, the the the deductible remaining is 473.76." corrects what was just
  // said and then gives a figure. Reading it as "the deductible does not apply"
  // rejected the record for a defect that was not there.
  const r = run();
  assert.notEqual(st(r, "dedApply"), "mismatch");
});

test("GOLDEN the record is rejected, and only for real defects", () => {
  const r = run();
  assert.equal(r.verdict, "REJECTED");
  const flagged = new Set([...r.missing, ...r.mismatched]);
  for (const k of ["policyId", "groupId", "callRef", "effDate", "oopRem", "payerId", "planType", "insPhone", "dedApply", "coins", "covPct"]) {
    assert.ok(!flagged.has(k), `${k} should not be flagged`);
  }
  assert.ok(flagged.has("tfl"), "the filing limit contradiction");
  assert.ok(flagged.has("authAfter"), "the auth threshold");
});

test("GOLDEN a corrected form still fails only on what is genuinely unconfirmed", () => {
  // Fix the three defects the call actually disproves. What remains is the
  // material a verifier must chase, not noise.
  const fixed = { ...FILLED, tfl: "180 DAYS FROM DOS", authAfter: "8", dedRem: "$473.76", dedMet: "$0.00" };
  const r = run(fixed);
  assert.deepEqual(r.mismatched, [], "nothing the rep said contradicts the form any more");
});
