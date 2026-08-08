import test from "node:test";
import assert from "node:assert/strict";
import { checkTranscript } from "./verify.js";
import { parseTranscript } from "./transcriptParse.js";

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

const ASH_CALL = `ASH | Aug 4, 2026 08:37 AM
 If you are a member calling for assistance, please press 9 now.  If you are a provider, stay on the line for further options.  Calls may be monitored or recorded for training and quality purposes.  During your call with us, we may request personal information from you to verify your identity and assist you with the services. We provide to you.  If, you know your party's 4 digit extension, you may dial it at any time.  If your call is regarding patient eligibility, press 1.  if your  if your call is regarding a patient with Cigna coverage, press 1,  if your call is,  Ash offers a direct line for the sigma site of care, outpatient hospital, physical and occupational therapy program.  You can dial 833-695-1781 for faster, access to the sigma site of care provider service team.

ASH | Aug 4, 2026 08:38 AM
 If you are an ash participating, provider press 1.  If you.  At the end of today's call, you may receive a quick 3 question survey that takes less than a minute.  Your feedback, helps our agents improve their service.  Please remain on the line while we connect you with the next available agent.

ASH | Aug 4, 2026 08:38 AM
 My name is.

Savi Sharma | Aug 4, 2026 08:38 AM
Um, can you spell your name for me? 1 more time, please.

Savi Sharma | Aug 4, 2026 08:39 AM
 J e.  N e, c a like.

ASH | Aug 4, 2026 08:39 AM
 Yeah.  Can I have your name?

Savi Sharma | Aug 4, 2026 08:39 AM
 J. A  Yeah, my name is Tom t o m. Initially is M for Mike, I'm calling from the provider office. I want benefits and eligibility for physical therapy.  Can you assist me regarding this?

ASH | Aug 4, 2026 08:39 AM
 Sure, I could definitely take a look at the numbers beneficial. See the verify, some information. Can I have the tax ID?

Savi Sharma | Aug 4, 2026 08:39 AM
 1030 will be 92, 309 2814.

ASH | Aug 4, 2026 08:39 AM
 Taxation or name and address.

Savi Sharma | Aug 4, 2026 08:39 AM
 At uh the name of the provider will be the remaining kalal and the address will be 8526. Highway 6. North Houston Texas. 777095.

ASH | Aug 4, 2026 08:39 AM
What's the name of the practice?

Savi Sharma | Aug 4, 2026 08:40 AM
 Uh, the first the group name is Aura FY. Texas LLC.

ASH | Aug 4, 2026 08:40 AM
 All right. Can I have the member ID number?

Savi Sharma | Aug 4, 2026 08:40 AM
 Yes, sure. The number ID will be 106.  723 434.

ASH | Aug 4, 2026 08:40 AM
 Full name and date of birth.

Savi Sharma | Aug 4, 2026 08:40 AM
 Number name is carsten basin.  And the date of birth is.  October 7th 2010.

ASH | Aug 4, 2026 08:40 AM
 Can you verify the health plan?

Savi Sharma | Aug 4, 2026 08:40 AM
 Signage.

ASH | Aug 4, 2026 08:41 AM
 Hey, eligibility verification is not a guarantee of payment. Please review your client summary for acceptable, billing codes.  And I am showing the patient eligible for physical therapy occupational. Therapy benefits effective.  October 1st 2025.

ASH | Aug 4, 2026 08:41 AM
 Okay.  Number has a 20% Co insurance.  With.  20 calendar year visits.  Number has a family to deductible of dollars. Remaining 4, 7, 3. 7, 6.

Savi Sharma | Aug 4, 2026 08:42 AM
What is the individual deductible and individual out of pocket?

ASH | Aug 4, 2026 08:42 AM
 $3,000.

Savi Sharma | Aug 4, 2026 08:42 AM
 Okay.  What is the Met amount?

ASH | Aug 4, 2026 08:42 AM
 They showing zero dollars.

Savi Sharma | Aug 4, 2026 08:42 AM
 so, nothing has been

ASH | Aug 4, 2026 08:42 AM
 Out of pocket.

Savi Sharma | Aug 4, 2026 08:42 AM
 With it again. Uh, nothing else.

ASH | Aug 4, 2026 08:42 AM
 Well no, the the the deductible remaining is 473.76.

Savi Sharma | Aug 4, 2026 08:42 AM
 Okay, are you sure out of 3,000? The member has met 526.24, right?

ASH | Aug 4, 2026 08:42 AM
 The individual deductible is and remaining they have thousand dollars 473. 76 cents, remaining.

Savi Sharma | Aug 4, 2026 08:43 AM
Okay.  Uh, 2, 47377 and what is the out of pocket individual?

ASH | Aug 4, 2026 08:43 AM
 6, uh 6,500 and remaining is 5,473.76.

Savi Sharma | Aug 4, 2026 08:43 AM
 Okay, and the member has a 20% Point Insurance, right?

ASH | Aug 4, 2026 08:43 AM
 30%. Yes.

Savi Sharma | Aug 4, 2026 08:43 AM
 Okay. And can you just please provide me the group now, uh, the group ID.

ASH | Aug 4, 2026 08:43 AM
 00633.  434.

Savi Sharma | Aug 4, 2026 08:43 AM
 Okay.  And can you just tell me out of 20? Visit how many visit has been used?

ASH | Aug 4, 2026 08:43 AM
 They haven't used any visits.

Savi Sharma | Aug 4, 2026 08:43 AM
 They haven't used any visit.  Um, but in the portal I have seen that 1. Visit has been used, so can you just please reach out.

ASH | Aug 4, 2026 08:44 AM
 Oh, for physical therapy. Yes, for physical therapy. They have 19 business remaining.

Savi Sharma | Aug 4, 2026 08:44 AM
Okay, and it's a hard match of 20 visit, right?

ASH | Aug 4, 2026 08:44 AM
Yeah.

Savi Sharma | Aug 4, 2026 08:44 AM
 Okay. Uh, after how many visit the O will be required? The medical necessity review?

ASH | Aug 4, 2026 08:44 AM
 1 moment.

ASH | Aug 4, 2026 08:44 AM
 After the eighth visit?

Savi Sharma | Aug 4, 2026 08:44 AM
 after 8, visit  Okay, and so it will be required through Ash, right?

ASH | Aug 4, 2026 08:44 AM
 Yeah.

Savi Sharma | Aug 4, 2026 08:44 AM
 And um, can you just tell me that is the member having any secondary insurance?

ASH | Aug 4, 2026 08:45 AM
 No, we we wouldn't be able to see that on our end.

Savi Sharma | Aug 4, 2026 08:45 AM
 And you are the primary 1, right? Correct.

ASH | Aug 4, 2026 08:45 AM
 Yeah.

Savi Sharma | Aug 4, 2026 08:45 AM
Okay.  And can you just please provide me?  the timely filing limit, uh, timely filing days for initial claim And Timely reporting test for corrected claims,

ASH | Aug 4, 2026 08:45 AM
180 days from the data service for original submission for a claim.

Savi Sharma | Aug 4, 2026 08:45 AM
 Okay.

ASH | Aug 4, 2026 08:45 AM
 and,  To correct. You said resubmission.

Savi Sharma | Aug 4, 2026 08:45 AM
 I have, I have asked you for. What is the timely calling for fresh claim? And what is the timing calling days for corrected claims? So, for fresh claim, you have told that it 18 days, right?

ASH | Aug 4, 2026 08:45 AM
Yeah.

Savi Sharma | Aug 4, 2026 08:45 AM
 And and what is the time?

ASH | Aug 4, 2026 08:45 AM
 So if it's a if it's it's it's it's the correct practitioner error or to correct the ash error.

Savi Sharma | Aug 4, 2026 08:46 AM
 Correct. Ma'am. I'm asking you for the timely, following days, for corrected claims.

ASH | Aug 4, 2026 08:46 AM
 I heard what you said. I'm asking you is it to correct from the practitioner or from Ash because it's 2 different ones. So that's what I'm asking you is it to correct a practitioner error will be will be an error on your end or error on Ash's end.

Savi Sharma | Aug 4, 2026 08:46 AM
 Uh, practitioners from our side.

ASH | Aug 4, 2026 08:46 AM
 Oh, okay.  Um, so it's 180 days from the date of service or 60 calendar days from the ra. Um, elbe.

Savi Sharma | Aug 4, 2026 08:46 AM
 Okay, and what you have told your name. Can you spell your name 1 more time, please.

ASH | Aug 4, 2026 08:46 AM
 J a h. N e e v. A

Savi Sharma | Aug 4, 2026 08:46 AM
 Uh your name is j a h n e e z a right.

ASH | Aug 4, 2026 08:47 AM
 V as in Victor. A

Savi Sharma | Aug 4, 2026 08:47 AM
 Okay, your name is, Danielle jhn. Westvirginia, what's the initial?  Okay, please provide me the call options.

ASH | Aug 4, 2026 08:47 AM
20874738.

Savi Sharma | Aug 4, 2026 08:47 AM
 Uh, 2087.  4738. Right.

ASH | Aug 4, 2026 08:47 AM
 Correct.

Savi Sharma | Aug 4, 2026 08:47 AM
 Okay, thank you so much for the information. Have a nice day. Bye bye.

ASH | Aug 4, 2026 08:47 AM
 You're welcome. Thank you for calling America, social have a great day, please stay on the line to complete.

Savi Sharma | Aug 4, 2026 08:47 AM
 Bye.`;

// The VOB as it was actually filled in, errors included.
const FILLED = {
  lastName: "BAZAN", firstName: "CARSTEN", dob: "2010-10-07", today: "2026-08-04", verifiedBy: "SP",
  insName: "CIGNA ASH", insPhone: "800-972-4226", policyId: "106723434-01", groupId: "00633434",
  planType: "OPEN ACCESS PLUS", serviceType: "PT", network: "IN NETWORK",
  coverage: "INN BENEFITS WITH AUTH", authAfter: "5",
  effDate: "2025-10-01", termDate: "", payerId: "ASHP1", hra: "NO",
  copay: "NO", copayAmt: "", covPct: "80%", coins: "YES", coinsAmt: "20%",
  dedApply: "YES", dedInd: "$3000.00", dedMet: "$526.24", dedRem: "$2473.76",
  oop: "$6500.00", oopMet: "$1026.24", oopRem: "$5473.76",
  visitLimit: "20 (HARD MAX)", visitUsed: "01",
  authEval: "NO", authTx: "YES", referral: "NO", pcpRef: "NO",
  authHow: "THROUGH ASH (800-972-4226)", claimAddr: "",
  tfl: "90 DAYS FROM DOS", tflCorr: "180 DAYS FROM DOS",
  repName: "JAHNEEVA.C", callRef: "20874738", primary: "CIGNA ASH", hasSec: "NO",
};

// What the operator marked as coming from somewhere other than the call.
const META = {
  payerId: { source: "carrier" },
  planType: { source: "portal" },
  insPhone: { source: "carrier" },
  claimAddr: { source: "carrier" },
  tfl: { source: "carrier" },
  oopMet: { source: "derived" },
  termDate: { bypass: { reason: "NOT_ON_CALL", auto: false } },
};

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
  // "The member has met 526.24, right?" is Savi's arithmetic. The rep answers with
  // the deductible REMAINING and never confirms the met amount.
  const r = run();
  assert.equal(st(r, "dedMet"), "echo");
  assert.ok(!r.matched || !find(r, "dedMet").found);
});

test("GOLDEN speaker attribution changes the outcome", () => {
  // Same transcript, no roles: the agent's own words now "confirm" the form.
  const blind = checkTranscript(FILLED, parsed.text, META);
  assert.equal(st(blind, "dedMet"), "found");
  assert.equal(st(run(), "dedMet"), "echo");
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

test("GOLDEN without provenance those same fields would sink the record", () => {
  const r = run(FILLED, {});
  for (const k of ["payerId", "planType"]) {
    assert.ok(r.missing.includes(k), `${k} is unheard, and without provenance that is a failure`);
  }
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
  const fixed = { ...FILLED, tfl: "180 DAYS FROM DOS", authAfter: "8", dedRem: "$473.76" };
  const r = run(fixed);
  assert.deepEqual(r.mismatched, [], "nothing the rep said contradicts the form any more");
});
