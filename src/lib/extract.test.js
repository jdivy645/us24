import test from "node:test";
import assert from "node:assert/strict";
import { extractFromTranscript, agentOnlyObservations, NEVER_EXTRACT } from "./extract.js";
import { checkTranscript, getPrep } from "./verify.js";
import { parseTranscript, roleAt } from "./transcriptParse.js";
import { ASH_CALL, FILLED, TRUTH } from "./ash.fixture.js";

// The real ASH/Cigna call, run in the direction the form is FILLED rather than the
// direction it is checked.
//
// The honest measure of this module is not how much it finds. It is that
// everything it finds is right, that everything it misses is missed for a reason
// worth writing down, and that nothing it proposes was said by us rather than by
// the payer.

const parsed = parseTranscript(ASH_CALL, { insName: FILLED.insName, verifiedBy: "Savi Sharma" });
const prep = getPrep(parsed.text);
const x = extractFromTranscript(prep, { ranges: parsed.ranges });
const got = Object.fromEntries(Object.entries(x.values).map(([k, p]) => [k, p.value]));

// ---------------- what it proposes, exactly ----------------

test("EXTRACT the real call yields exactly what the rep actually stated", () => {
  // Pinned in both directions on purpose: adding a field here should be a
  // decision, and losing one should be a failure.
  assert.deepEqual(got, {
    coins: "YES",
    dedApply: "YES",
    coinsAmt: "20%",
    dedRem: "$473.76",
    dedMet: "$0.00",
    effDate: "2025-10-01",
    groupId: "00633434",
    authAfter: "8",
    tfl: "180 DAYS",   // no "FROM DOS": the rep's phrase came through as "data service"
    serviceType: "PT", // from our own opening turn — see the exception below
    dob: "2010-10-07", // read from our own turn too, for the same reason
  });
});

test("EXTRACT every proposal agrees with the corrected VOB", () => {
  const same = (a, b) => String(b).toUpperCase().startsWith(String(a).toUpperCase());
  for (const [k, v] of Object.entries(got)) {
    assert.ok(same(v, TRUTH[k]), `${k}: proposed ${v}, truth ${TRUTH[k]}`);
  }
});

// ---------------- the three defects ----------------

test("EXTRACT would have prevented every data-entry defect in this record", () => {
  assert.equal(got.dedRem, "$473.76");   assert.equal(FILLED.dedRem, "$2473.76");
  assert.equal(got.authAfter, "8");      assert.equal(FILLED.authAfter, "5");
  assert.match(got.tfl, /^180 /);        assert.match(FILLED.tfl, /^90 /);
  assert.equal(got.dedMet, "$0.00");     assert.equal(FILLED.dedMet, "$526.24");
});

// ---------------- the safety property ----------------

test("EXTRACT nothing our own agent said is ever proposed", () => {
  // Two exceptions, both argued below: the discipline the call was placed about,
  // and the date of birth. Everything else must come from the payer's mouth.
  const OURS = new Set(["serviceType", "dob"]);
  for (const [k, p] of Object.entries(x.values)) {
    if (OURS.has(k)) continue;
    assert.notEqual(roleAt(parsed.ranges, p.span.start), "agent", `${k} was proposed from our own turn`);
  }
  // "The member has met 526.24, right?" is Savi's arithmetic. The rep answered the
  // met amount with "zero dollars", and that is what extraction takes — never the
  // figure our own side computed.
  assert.equal(x.values.dedMet.value, "$0.00");
  for (const k of ["dedMet", "dedRem"]) {
    assert.ok(!parsed.text.slice(x.values[k].span.start, x.values[k].span.end).includes("526"), k);
  }
});

test("EXTRACT the date of birth may come from our own voice, because we are the ones who read it", () => {
  // The call flows the other way for the identity fields: our agent reads the DOB
  // out and the rep looks the member up. Filtering our voice out of extraction —
  // right for every value the payer supplies — left the DOB unreadable on every
  // real call, which is half of why the top of the form arrived empty.
  //
  // A date can be trusted this way because it has a shape nothing else shares. The
  // member ID cannot, and is deliberately not extended the same exception: an
  // identifier is a digit run and so is a dollar amount, and on this very call a
  // bare "3,000" beside the word "member" was proposed as the member ID.
  assert.equal(x.values.dob.value, "2010-10-07");
  assert.equal(roleAt(parsed.ranges, x.values.dob.span.start), "agent");
  assert.ok(!("policyId" in x.values), "the member ID must not be taken from our own voice");
});

test("EXTRACT the discipline is the one exception to that, and only that", () => {
  // Which discipline this verification is FOR is a fact our own side owns — it is
  // the reason for the call, stated in its first turn. The rep only confirms it,
  // and on this call answers by listing everything the plan covers ("physical
  // therapy occupational therapy benefits"), which is a different fact. The VOB
  // says PT because PT is what Savi asked about.
  assert.equal(x.values.serviceType.value, "PT");
  assert.equal(roleAt(parsed.ranges, x.values.serviceType.span.start), "agent");
  assert.match(x.values.serviceType.why, /the call was placed about/);

  // And the exceptions are genuinely only these two: no other field may take a
  // value from our own turn.
  const fromUs = Object.keys(x.values).filter((k) => roleAt(parsed.ranges, x.values[k].span.start) === "agent");
  assert.deepEqual(fromUs.sort(), ["dob", "serviceType"]);
});

test("EXTRACT a discipline mentioned in passing is not what the call is about", () => {
  // The request words are what separate "benefits for physical therapy" from a
  // discipline that merely comes up. Without them our own side's small talk would
  // set the field.
  const t = [
    "Agent: Hi, this is Tom. The patient had physical therapy last year somewhere else.",
    "Rep: Okay, let me pull up the member for you now.",
    "Agent: I need eligibility please.",
    "Rep: Sure, one moment for you there.",
  ].join("\n");
  const q = parseTranscript(t, { insName: "AETNA", verifiedBy: "Tom" });
  const y = extractFromTranscript(getPrep(q.text), { ranges: q.ranges });
  assert.ok(!("serviceType" in y.values));
});

test("EXTRACT is refused entirely on a transcript with no rep turn", () => {
  // Verification degrades safely without speaker labels because the operator typed
  // the values. Extraction does not — there is no independent human statement to
  // fall back on, and our own agent's read-backs would be promoted into the form.
  const blind = extractFromTranscript(prep, { ranges: null });
  const extra = Object.keys(blind.values).filter((k) => !(k in x.values));
  assert.ok(extra.length >= 3, `roles suppress ${extra.length} agent-sourced proposals`);
  // "it's a hard match of 20 visit, right?" is Savi's. Without roles it becomes the
  // visit limit; with them, nothing.
  assert.ok(extra.includes("visitLimit"));
  // …which is exactly why the caller must not run it that way. See autofill.js.
});

test("EXTRACT surfaces what only our side said, rather than dropping it silently", () => {
  const seen = agentOnlyObservations(prep, parsed.ranges);
  assert.ok("visitLimit" in seen, "the operator has to know our side asserted the visit limit");
  assert.match(seen.visitLimit.why, /rep did not confirm/);
  assert.ok(!("visitLimit" in x.values), "and that it was not filled in");
});

test("EXTRACT prose and bookkeeping fields are refused with a reason", () => {
  // The insurance name is refused because speech mangles prose past recovery, not
  // because the provider supplied it — the reason shown should say which.
  assert.equal(x.skipped.insName, "prose-not-reversible");
  // The names are readable now, but only where the call labelled them. This call
  // never says "the last name is…", so nothing is read and the reason is that the
  // topic was never named — not that it was forbidden.
  for (const k of ["lastName", "firstName"]) {
    assert.equal(x.skipped[k], "topic-never-named", k);
    assert.ok(!(k in x.values), k);
  }
  // The DOB and the member ID are no longer refused outright. The DOB was read
  // from this call; the member ID simply was not found on it.
  assert.ok(!("dob" in x.skipped), "the DOB is readable now");
  assert.equal(x.skipped.policyId, "no-candidate");
  for (const k of ["repName", "planType", "coverage", "authHow", "claimAddr", "primary"]) {
    assert.equal(x.skipped[k], "prose-not-reversible", k);
  }
  for (const k of ["today", "verifiedBy", "note"]) {
    assert.equal(x.skipped[k], "internal-bookkeeping", k);
  }
  for (const k of NEVER_EXTRACT) assert.ok(!(k in x.values), `${k} must never be proposed`);
});

// ---------------- the round trip ----------------

test("EXTRACT everything it proposes verifies as found against the same call", () => {
  // If a proposal cannot survive the engine that grades it, it is not a proposal —
  // it is a defect the operator would have to clear before saving.
  const meta = Object.fromEntries(Object.keys(got).map((k) => [k, { source: "rep" }]));
  const r = checkTranscript(got, parsed.text, meta, { ranges: parsed.ranges });
  // serviceType excepted: it has no number or date to anchor, so the matcher has
  // nothing to grade it against. It is read off a closed word set instead.
  for (const c of r.checks) {
    if (c.key === "serviceType") continue;
    assert.equal(c.status, "found", `${c.key} = ${c.value}`);
  }
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.mismatched, []);
  assert.equal(r.verdict, "APPROVED");
});

test("EXTRACT the 20%-then-30% contention survives into verification", () => {
  const meta = Object.fromEntries(Object.keys(got).map((k) => [k, { source: "rep" }]));
  const r = checkTranscript(got, parsed.text, meta, { ranges: parsed.ranges });
  assert.ok(r.contested.includes("coinsAmt"), "filling 20% is what makes 30% findable");
  assert.match(String(r.checks.find((c) => c.key === "coinsAmt").dispute.heard), /30/);
});

// ---------------- the honest misses ----------------

test("EXTRACT refuses the $3,000 that answered a two-topic question", () => {
  // "What is the individual deductible and individual out of pocket?" names two
  // subjects, and a single "$3,000." belongs to one of them. Filling either field
  // would be a coin toss wearing a tick.
  assert.ok(!("dedInd" in x.values));
  assert.equal(x.skipped.dedInd, "no-candidate");
});

test("EXTRACT does not guess the out-of-pocket figures", () => {
  // "6, uh 6,500 and remaining is 5,473.76" also answers a two-topic question, and
  // the stutter "6" outscores the real figure.
  for (const k of ["oop", "oopMet", "oopRem"]) assert.ok(!(k in x.values), k);
});

test("EXTRACT does not take the visit limit from the coinsurance sentence", () => {
  // "a 20% Co insurance. With. 20 calendar year visits" — the nearest same-family
  // anchor to the second 20 is "co insurance", one token away, not "visits" three
  // away. The rule that stops a false contradiction also stops a false fill.
  assert.ok(!("visitLimit" in x.values));
  assert.ok(!("visitUsed" in x.values));
});

test("EXTRACT finds no call reference, because the call never names one", () => {
  // "please provide me the call options" — speech-to-text lost "reference", so no
  // anchor site exists and 20874738 belongs to nothing.
  assert.ok(!("callRef" in x.values));
  assert.equal(x.skipped.callRef, "topic-never-named");
});

// ---------------- confidence and derivation ----------------

test("EXTRACT every proposal carries its evidence", () => {
  for (const [k, p] of Object.entries(x.values)) {
    assert.ok(p.quote && p.quote.length > 3, `${k} has no quote`);
    assert.ok(p.why, `${k} has no explanation`);
    assert.ok(["high", "low"].includes(p.confidence), k);
    assert.equal(p.autoFill, false, "extract.js proposes; autofill.js decides what is written");
    assert.ok(p.cls, `${k} has no field class`);
  }
  assert.equal(x.values.dedRem.strict, true, "deductible remaining is a strict field");
  assert.equal(x.values.groupId.strict, false);
});

test("EXTRACT derives nothing on this call, because no operand pair is safe", () => {
  assert.deepEqual(x.derived, {});
});

test("EXTRACT derives a met amount only when the rep stated both operands", () => {
  const t = `Thanks for calling Aetna, this is Clark with the benefits for this member today.
    The individual deductible is three thousand dollars and the deductible remaining is five hundred dollars.`;
  const d = extractFromTranscript(getPrep(t), {}).derived;
  assert.equal(d.dedMet.value, "$2500.00");
  assert.equal(d.dedMet.source, "derived");
  assert.equal(d.dedMet.autoFill, false);
  assert.match(d.dedMet.why, /Nobody said this/);
});

test("EXTRACT a transcript too short to judge proposes nothing", () => {
  const e = extractFromTranscript(getPrep("Deductible is three thousand dollars."), {});
  assert.deepEqual(e.values, {});
});
