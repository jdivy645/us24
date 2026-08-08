import test from "node:test";
import assert from "node:assert";
import { checkTranscript } from "./verify.js";
import { checkCompleteness, MANDATORY_FIELDS } from "./completeness.js";
import { buildTranscriptTxt } from "./transcriptFile.js";
import { sampleForm, initialForm } from "../data/fields.js";

const SAMPLE = {
  lastName: "YUSUFF", firstName: "TAJUDEEN", dob: "1957-12-31",
  insName: "AETNA", insPhone: "800-624-0756", policyId: "101619535700", groupId: "000003-TX",
  planType: "HMO AETNA MEDICARE DUAL CARE", network: "IN NETWORK", coverage: "INN BENEFITS WITH AUTH",
  effDate: "2026-03-01", termDate: "CURRENT", payerId: "60054", hra: "NA", copay: "NO", copayAmt: "$0.00",
  covPct: "100%", coins: "NO", coinsAmt: "0%", dedApply: "NO", dedInd: "NA", oop: "NA",
  visitLimit: "MN (medically necessary)", visitUsed: "3", authEval: "YES", authTx: "YES", referral: "NO", pcpRef: "NO",
  authHow: "Through Holista portal", authWindow: "14 DAYS",
  tfl: "120 DAYS FROM DOS", tflCorr: "180 DAYS FROM DOS",
  repName: "CLARK Y", callRef: "358428114", hasSec: "NO", serviceType: "PT",
};

const FULL_CALL = `Thank you for calling Aetna, my name is Clark. Can I get the member ID?
It's one zero one six one nine five three five seven zero zero.
Date of birth December thirty first nineteen fifty seven, last name Yusuff, first name Tajudeen.
Group number is zero zero zero zero zero three T X and the payer ID is six zero zero five four.
The plan is an HMO Aetna Medicare Dual Care plan, effective March first twenty twenty six.
Benefits are in network benefits with authorization. There is no copay and no coinsurance, covered at one hundred percent.
Visits are limited to medically necessary and they have used three visits so far.
Authorization is required for the initial evaluation and for treatment, and you must submit the auth
request within fourteen days. You obtain it through the Holista portal. No referral is required.
Timely filing is one hundred twenty days from date of service, corrected claims one hundred eighty days from date of service.
There is no secondary on file. Your reference number is three five eight four two eight one one four.`;

const st = (r, key) => (r.checks.find((c) => c.key === key) || {}).status;
const heard = (r, key) => (r.checks.find((c) => c.key === key) || {}).heard;

// ---------------- happy path ----------------

test("full call approves the sample record", () => {
  const r = checkTranscript(SAMPLE, FULL_CALL);
  const bad = r.checks.filter((c) => c.gate === "hard" && c.status !== "found").map((c) => `${c.label}=${c.value}`);
  assert.deepStrictEqual(bad, [], "unexpected unconfirmed hard fields");
  assert.strictEqual(r.verdict, "APPROVED");
});

test("sample form is complete", () => {
  const c = checkCompleteness(SAMPLE);
  assert.deepStrictEqual(c.blank.map((f) => f.label), []);
  assert.strictEqual(c.incomplete, false);
});

test("blank mandatory fields are reported, NA counts as answered", () => {
  const c = checkCompleteness({ ...SAMPLE, policyId: "", repName: "", dedInd: "NA" });
  assert.deepStrictEqual(c.blank.map((f) => f.key), ["policyId", "repName"]);
});

test("secondary fields only required when a secondary is on file", () => {
  assert.strictEqual(checkCompleteness({ ...SAMPLE, hasSec: "YES" }).blank.length, 2);
  assert.strictEqual(checkCompleteness({ ...SAMPLE, hasSec: "NO" }).blank.length, 0);
});

// ---------------- guardrails: these MUST keep failing ----------------

test("GUARD a spoken copay contradicts a NO copay", () => {
  const r = checkTranscript({ ...SAMPLE, copay: "NO", copayAmt: "" },
    FULL_CALL.replace("There is no copay and no coinsurance", "The copay is twenty dollars per visit and there is no coinsurance"));
  assert.strictEqual(st(r, "copay"), "mismatch");
  assert.strictEqual(r.verdict, "REJECTED");
});

test("GUARD a different timely filing is not accepted", () => {
  const r = checkTranscript(SAMPLE, FULL_CALL.replace("one hundred twenty days from date of service", "ninety days from date of service"));
  assert.notStrictEqual(st(r, "tfl"), "found");
  assert.strictEqual(r.verdict, "REJECTED");
});

test("GUARD a wrong surname is not accepted", () => {
  const r = checkTranscript({ ...SAMPLE, lastName: "ROBINSON" }, FULL_CALL);
  assert.strictEqual(st(r, "lastName"), "missing");
  assert.strictEqual(r.verdict, "REJECTED");
});

test("GUARD a policy ID misread by one digit is not accepted", () => {
  const r = checkTranscript({ ...SAMPLE, policyId: "101619535800" }, FULL_CALL);
  assert.notStrictEqual(st(r, "policyId"), "found");
  assert.strictEqual(r.verdict, "REJECTED");
});

test("GUARD a lone number elsewhere does not satisfy a filing limit", () => {
  const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", tfl: "120 DAYS FROM DOS" },
    "Thanks for calling. The specialist copay on this plan is one hundred twenty dollars and we have Smith Jo with Aetna on file today for the review of benefits.");
  assert.notStrictEqual(st(r, "tfl"), "found");
});

// ---------------- mismatch detection ----------------

test("a different co-pay amount is reported as a mismatch with what was heard", () => {
  const r = checkTranscript({ ...SAMPLE, copay: "YES", copayAmt: "$60" },
    FULL_CALL.replace("There is no copay and no coinsurance", "The copay is forty dollars and there is no coinsurance"));
  assert.strictEqual(st(r, "copayAmt"), "mismatch");
  assert.match(heard(r, "copayAmt"), /forty/);
  assert.strictEqual(r.verdict, "REJECTED");
});

test("deductible met / remaining / individual are told apart", () => {
  const t = `Thanks for calling Aetna, this is Clark speaking with the benefits for this member today.
    The individual deductible is fifteen hundred dollars, the deductible met is two hundred fifty dollars,
    and the deductible remaining is one thousand two hundred fifty dollars for this calendar year.`;
  const v = { lastName: "SMITH", firstName: "JO", insName: "AETNA", dedInd: "$1,500", dedMet: "$250", dedRem: "$1,250" };
  const r = checkTranscript(v, t);
  assert.strictEqual(st(r, "dedInd"), "found");
  assert.strictEqual(st(r, "dedMet"), "found");
  assert.strictEqual(st(r, "dedRem"), "found");
});

test("a family deductible is not claimed as the individual one", () => {
  const t = `Thank you for calling Aetna benefits department, my name is Clark and I can help with that today.
    The family deductible is three thousand dollars for this plan year and nothing else applies here.`;
  const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", dedInd: "$1,500" }, t);
  assert.strictEqual(st(r, "dedInd"), "missing", "family amount must not be reported as a mismatch");
});

test("an uncertain amount is not treated as a contradiction", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I am looking at the benefits for this member now.
    I'm not sure about the deductible, maybe five hundred, let me check on that for you before we continue.`;
  const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", dedInd: "$1,500" }, t);
  assert.strictEqual(st(r, "dedInd"), "missing");
});

// ---------------- yes/no reasoning ----------------

test("auth required for treatment but not the eval", () => {
  const t = `Thanks for calling Aetna, this is Clark. Prior authorization is required for treatment but not for the initial evaluation,
    and you can submit it through the portal whenever you are ready to start care for this member.`;
  const yes = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", authEval: "YES", authTx: "YES" }, t);
  assert.strictEqual(st(yes, "authEval"), "mismatch");
  assert.strictEqual(yes.verdict, "REJECTED");
  const ok = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", authEval: "NO", authTx: "YES" }, t);
  assert.strictEqual(st(ok, "authEval"), "found");
  assert.strictEqual(st(ok, "authTx"), "found");
});

test("a bare 'that's right' answers the question it follows", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I have the member record open in front of me right now.
    So no referral is needed for this plan? That's right.`;
  const ok = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", referral: "NO" }, t);
  assert.strictEqual(st(ok, "referral"), "found");
  const bad = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", referral: "YES" }, t);
  assert.strictEqual(st(bad, "referral"), "mismatch");
});

test("a topic never mentioned stays quiet and does not fail the record", () => {
  const r = checkTranscript(SAMPLE, FULL_CALL);
  assert.strictEqual(st(r, "pcpRef"), "quiet");
  assert.strictEqual(r.verdict, "APPROVED");
  assert.ok(!r.checks.filter((c) => c.status === "quiet").some((c) => r.missing.includes(c.key)));
});

test("'the deductible has been met' decides nothing on its own", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I am pulling up the benefits for this member today.
    The deductible has been met for the year, so nothing further is outstanding on the account at this time.`;
  const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", dedApply: "NO" }, t);
  assert.strictEqual(st(r, "dedApply"), "quiet");
});

// ---------------- matcher robustness ----------------

test("money with commas, spoken as words", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I can read those benefits out for you now.
    The individual deductible is one thousand five hundred dollars for this plan year.`;
  const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", dedInd: "$1,500" }, t);
  assert.strictEqual(st(r, "dedInd"), "found");
});

test("an eighty twenty split matches 80% coverage and 20% co-insurance", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I have the plan benefits open here for you today.
    It's an eighty twenty split, so the plan pays eighty percent and the member coinsurance is twenty percent.`;
  const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", covPct: "80%", coinsAmt: "20%" }, t);
  assert.strictEqual(st(r, "covPct"), "found");
  assert.strictEqual(st(r, "coinsAmt"), "found");
});

test("'one twenty from DOS' matches 120 DAYS FROM DOS", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I can give you the claims information for this plan.
    Timely filing is one twenty days from DOS for this payer.`;
  const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", tfl: "120 DAYS FROM DOS" }, t);
  assert.strictEqual(st(r, "tfl"), "found");
});

test("a zero co-pay is confirmed by 'there is no copay'", () => {
  const r = checkTranscript({ ...SAMPLE, copayAmt: "$0.00" }, FULL_CALL);
  assert.strictEqual(st(r, "copayAmt"), "found");
});

test("a name spelled out letter by letter is matched", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I have the member record open for you right now.
    The last name is spelled Y U S U F F and the first name is Tajudeen on this policy.`;
  const r = checkTranscript({ lastName: "YUSUFF", firstName: "TAJUDEEN", insName: "AETNA" }, t);
  assert.strictEqual(st(r, "lastName"), "found");
});

test("a slightly misheard surname still matches", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I can confirm the details on this member policy today.
    The member is Yusuf Tajudeen and the plan is active with us right now.`;
  const r = checkTranscript({ lastName: "YUSUFF", firstName: "TAJUDEEN", insName: "AETNA" }, t);
  assert.strictEqual(st(r, "lastName"), "found");
});

test("dates spoken several ways all match", () => {
  for (const said of ["effective the first of March twenty twenty six", "effective March first twenty twenty six", "effective oh three oh one twenty twenty six"]) {
    const t = `Thank you for calling Aetna, my name is Clark and I am reading the plan record for this member now.
      The policy is ${said} and remains active today with no termination on file.`;
    const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", effDate: "2026-03-01" }, t);
    assert.strictEqual(st(r, "effDate"), "found", said);
  }
});

// ---------------- verdict edges ----------------

test("no transcript is NO TRANSCRIPT with a pending checklist", () => {
  const r = checkTranscript(SAMPLE, "");
  assert.strictEqual(r.verdict, "NO TRANSCRIPT");
  assert.ok(r.checks.length > 10, "checklist should still list what must be confirmed");
});

test("nothing checkable is UNVERIFIED, never APPROVED", () => {
  const r = checkTranscript({ lastName: "NA", firstName: "NA", insName: "NA" }, "some spoken words here about nothing in particular");
  assert.strictEqual(r.verdict, "UNVERIFIED");
});

// ---------------- one occurrence cannot confirm many fields ----------------

test("GUARD a value must be spoken ABOUT its field, not just somewhere in the call", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I can help with the benefits today.
    The patient is Jacqueline and her plan is an HMO Medicare product that is active right now.`;
  // "Jacqueline" is the patient's name — typing it into Plan type must not pass
  const r = checkTranscript({ lastName: "Jacqueline", firstName: "SMITH", insName: "AETNA", planType: "Jacqueline" }, t);
  assert.strictEqual(st(r, "lastName"), "found", "said next to 'patient' — legitimate");
  assert.strictEqual(st(r, "planType"), "elsewhere", "never said about the plan");
  assert.strictEqual(r.verdict, "REJECTED");
});

test("GUARD one spoken word does not confirm four different fields", () => {
  const t = `Thank you for calling, my name is Clark and I am looking at the record for Jacqueline right now,
    the plan is active and I can go through the benefits with you today whenever you are ready to start.`;
  const v = { lastName: "Jacqueline", firstName: "Jacqueline", insName: "Jacqueline", planType: "Jacqueline" };
  const r = checkTranscript(v, t);
  const found = r.checks.filter((c) => c.status === "found").length;
  assert.strictEqual(found, 1, "only one field may claim the single occurrence");
  assert.strictEqual(r.verdict, "REJECTED");
});

test("the same value said about two different fields confirms both", () => {
  const t = `Thank you for calling, my name is Clark. The insurance on file is Aetna for this member,
    and the secondary insurance is Aetna as well, so both carriers read the same on this record today.`;
  const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", secName: "AETNA" }, t);
  assert.strictEqual(r.checks.filter((c) => c.key === "insName")[0].status, "found");
  assert.strictEqual(r.checks.filter((c) => c.key === "secName")[0].status, "found");
});

test("fields with different values are unaffected by the rule", () => {
  const t = `Thank you for calling Aetna, my name is Clark and I have the claims information here for you.
    Timely filing is one hundred twenty days from date of service and corrected claims are one hundred eighty days from date of service.`;
  const r = checkTranscript({ lastName: "SMITH", firstName: "JO", insName: "AETNA", tfl: "120 DAYS FROM DOS", tflCorr: "180 DAYS FROM DOS" }, t);
  assert.strictEqual(st(r, "tfl"), "found");
  assert.strictEqual(st(r, "tflCorr"), "found");
});

// ---------------- app-level wiring ----------------

test("the shipped sample record is a complete form", () => {
  assert.deepStrictEqual(checkCompleteness(sampleForm()).blank.map((f) => f.label), []);
});

test("a fresh form flags every required field, with no pre-picked answers", () => {
  const fresh = initialForm();
  const c = checkCompleteness(fresh);
  assert.ok(c.required >= 18, `expected the full required set, got ${c.required}`);
  // Everything required is blank except the service type, which is the practice's
  // own context rather than one of the rep's answers — they tell the rep which
  // discipline they are calling about, not the other way round.
  assert.deepStrictEqual(
    c.blank.length === c.required ? [] : MANDATORY_FIELDS.filter((f) => fresh[f.key]).map((f) => f.key),
    ["serviceType"]);
  // No answer-bearing select is pre-picked: a default would count as answered and
  // would then be verified against a call nobody had yet made.
  for (const k of ["copay", "coins", "dedApply", "authEval", "authTx", "referral", "pcpRef", "hasSec", "network", "networkInd", "termDate"]) {
    assert.strictEqual(fresh[k], "", `${k} must start blank`);
  }
});

test("a field is only required once another answer makes it a question", () => {
  // Chasing a deductible-met figure on a plan with no deductible is how a
  // checklist teaches people to ignore it.
  const noDed = checkCompleteness({ ...SAMPLE, dedApply: "NO", dedInd: "NA" });
  assert.ok(!noDed.blank.some((f) => f.key === "dedMet" || f.key === "dedRem"));

  const hasDed = checkCompleteness({ ...SAMPLE, dedApply: "YES", dedInd: "$3000.00", dedMet: "", dedRem: "" });
  assert.deepStrictEqual(hasDed.blank.map((f) => f.key).sort(), ["dedMet", "dedRem"]);

  const noCoins = checkCompleteness({ ...SAMPLE, coins: "NO", coinsAmt: "", covPct: "" });
  assert.ok(!noCoins.blank.some((f) => f.key === "coinsAmt" || f.key === "covPct"));
});

test("the red 'already on file' fields are never chased on the call", () => {
  // Patient name, DOB, payer ID, filing limits and the claim address come from our
  // own records. Listing them as things to ask the rep for is how an operator ends
  // up asking for something that was never theirs to give.
  const c = checkCompleteness({});
  const asked = new Set(c.blank.map((f) => f.key));
  for (const k of ["lastName", "firstName", "dob", "insName", "insPhone", "payerId", "tfl", "tflCorr", "claimAddr"]) {
    assert.ok(!asked.has(k), `${k} is on file — it must not appear in "still to ask"`);
  }
  // …and the green ones are.
  for (const k of ["policyId", "groupId", "coverage", "effDate", "visitLimit", "repName", "callRef"]) {
    assert.ok(asked.has(k), `${k} must be asked on the call`);
  }
});

test("the .txt report names contradictions, blanks and the verdict", () => {
  const v = { ...sampleForm(), lastName: "YUSUFF", firstName: "TAJUDEEN", copay: "YES", copayAmt: "$60", repName: "" };
  const t = FULL_CALL.replace("There is no copay and no coinsurance", "The copay is forty dollars and there is no coinsurance");
  const res = checkTranscript(v, t);
  const txt = buildTranscriptTxt(v, t, res);
  assert.match(txt, /VERDICT.*REJECTED/);
  assert.match(txt, /‹‹forty dollars››/, "the contradicted words should be marked in the body");
  assert.match(txt, /MISMATCH — call says "forty dollars"/);
  assert.match(txt, /MISSING FROM FORM/);
  assert.match(txt, /Insurance Rep/, "the blank required field should be listed");
});

// ---------------- long transcripts ----------------

// MAX_HITS used to stop the contradiction scan after the first 8 mentions of a
// topic, so on a long call a figure restated differently near the end was
// invisible and the record read APPROVED. That is a wrong verdict, not thin
// coverage, and it is exactly the shape of a two-hour benefits call.
test("a contradiction stated only at the twentieth mention is still caught", () => {
  const filler = "The deductible has been discussed already. ";
  const call = FULL_CALL + "\n" + filler.repeat(20) +
    "\nJust to correct myself, the individual deductible is two thousand five hundred dollars.";
  const r = checkTranscript({ ...SAMPLE, dedInd: "$900.00", dedApply: "YES" }, call);
  assert.strictEqual(st(r, "dedInd"), "mismatch");
  assert.match(String(heard(r, "dedInd")), /two thousand five hundred|2,?500/);
});

test("a long transcript still verifies quickly", () => {
  // ~150k characters, the size of a two-hour call.
  const call = (FULL_CALL + "\n").repeat(Math.ceil(150000 / (FULL_CALL.length + 1)));
  assert.ok(call.length >= 150000, `fixture is ${call.length} chars`);
  const t0 = Date.now();
  const r = checkTranscript(SAMPLE, call);
  const ms = Date.now() - t0;
  assert.ok(r.checks.length > 10);
  assert.ok(ms < 3000, `checkTranscript took ${ms}ms on a ${call.length}-char transcript`);
});
