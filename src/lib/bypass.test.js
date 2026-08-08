import test from "node:test";
import assert from "node:assert/strict";
import { checkTranscript } from "./verify.js";
import { checkCompleteness } from "./completeness.js";
import { isNegative, normalizeMeta, setBypass, clearBypass, bypassSummary } from "./bypass.js";
import { initialForm, clearedForm } from "../data/fields.js";

const SAMPLE = {
  lastName: "YUSUFF", firstName: "TAJUDEEN", dob: "1957-12-31",
  insName: "AETNA", insPhone: "800-624-0756", policyId: "101619535700", groupId: "000003-TX",
  planType: "HMO AETNA MEDICARE DUAL CARE", network: "IN NETWORK", coverage: "INN BENEFITS WITH AUTH",
  effDate: "2026-03-01", termDate: "CURRENT", payerId: "60054", hra: "NA", copay: "NO", copayAmt: "$0.00",
  covPct: "100%", coins: "NO", coinsAmt: "0%", dedApply: "NO", dedInd: "NA", oop: "NA",
  visitLimit: "MN (medically necessary)", authEval: "YES", authTx: "YES", referral: "NO", pcpRef: "NO",
  authHow: "Through Holista portal", tfl: "120 DAYS FROM DOS", tflCorr: "180 DAYS FROM DOS",
  repName: "CLARK Y", callRef: "358428114", hasSec: "NO",
};

const FULL_CALL = `Thank you for calling Aetna, my name is Clark. Can I get the member ID?
It's one zero one six one nine five three five seven zero zero.
Date of birth December thirty first nineteen fifty seven, last name Yusuff, first name Tajudeen.
Group number is zero zero zero zero zero three T X and the payer ID is six zero zero five four.
The plan is an HMO Aetna Medicare Dual Care plan, effective March first twenty twenty six.
Benefits are in network benefits with authorization. There is no copay and no coinsurance, covered at one hundred percent.
Visits are limited to medically necessary. Authorization is required for the initial evaluation and for treatment,
you obtain it through the Holista portal. No referral is required.
Timely filing is one hundred twenty days from date of service, corrected claims one hundred eighty days from date of service.
There is no secondary on file. Your reference number is three five eight four two eight one one four.`;

const st = (r, key) => (r.checks.find((c) => c.key === key) || {}).status;

// ---------------- the asymmetry that this module exists to fix ----------------

test("verify and completeness agree on a bypassed field", () => {
  const v = { ...SAMPLE, dedInd: "" };
  const meta = { dedInd: { bypass: { reason: "NOT_AVAILABLE" } } };
  // completeness: answered, because the operator recorded WHY it is blank
  assert.equal(checkCompleteness(v, meta).blank.find((f) => f.key === "dedInd"), undefined);
  assert.ok(checkCompleteness(v, {}).blank.some((f) => f.key === "dedInd"), "still blank without the bypass");
  // verify: on the checklist with its reason, rather than silently absent
  assert.equal(st(checkTranscript(v, FULL_CALL, meta), "dedInd"), "bypassed");
});

test("a bypassed field never counts toward the verdict", () => {
  const meta = { tfl: { bypass: { reason: "CARRIER_DATA" } } };
  const r = checkTranscript(SAMPLE, FULL_CALL, meta);
  assert.ok(!r.missing.includes("tfl"));
  assert.ok(!r.mismatched.includes("tfl"));
  assert.deepEqual(r.bypassed, ["tfl"]);
  assert.equal(r.verdict, "APPROVED");
});

test("a bypass carries its reason through to the checklist", () => {
  const meta = setBypass({}, "oop", "NOT_ON_CALL", "rep put me on hold and dropped", "SP");
  const c = checkTranscript(SAMPLE, FULL_CALL, meta).checks.find((x) => x.key === "oop");
  assert.equal(c.bypass.reason, "NOT_ON_CALL");
  assert.equal(c.bypass.by, "SP");
  assert.match(c.bypass.note, /dropped/);
  assert.match(bypassSummary(meta, { oop: "Out of pocket max" })[0], /Out of pocket max \(Not discussed on the call, SP\)/);
  assert.deepEqual(clearBypass(meta, "oop"), {});
});

// ---------------- typed negatives become auditable ----------------

test("a typed NA becomes an explicit, auditable bypass at save", () => {
  const m = normalizeMeta({ hra: "NA", dedInd: "$3000.00" }, {}, "SP");
  assert.equal(m.hra.bypass.reason, "NOT_APPLICABLE");
  assert.equal(m.hra.bypass.auto, true);
  assert.equal(m.hra.bypass.by, "SP");
  assert.match(m.hra.bypass.note, /typed "NA"/);
  assert.equal(m.dedInd, undefined, "a real value is not a bypass");
});

test("normalizeMeta never touches a yes/no answer", () => {
  // "NO" here is the answer, not a way of saying "not applicable". Auto-bypassing
  // these would silently drop every yes/no field out of verification.
  const v = { copay: "NO", coins: "NO", dedApply: "NO", authEval: "NO", authTx: "NO", referral: "NO", pcpRef: "NO", hasSec: "NO" };
  assert.deepEqual(normalizeMeta(v, {}, "SP"), {});
});

test("CURRENT and PENDING are not negatives", () => {
  assert.deepEqual(normalizeMeta({ termDate: "CURRENT", authNum: "PENDING", authDates: "TBD" }, {}, "SP"), {});
  assert.equal(isNegative("N/A"), true);
  assert.equal(isNegative("n.a."), true);
  assert.equal(isNegative("NONE"), true);
  assert.equal(isNegative("0"), true);
  assert.equal(isNegative("CURRENT"), false);
  assert.equal(isNegative("$0.00"), false, "a zero-dollar amount is a real answer");
});

test("an existing bypass is never overwritten by the auto pass", () => {
  const meta = setBypass({}, "hra", "NOT_AVAILABLE", "", "SP");
  const m = normalizeMeta({ hra: "NA" }, meta, "SP");
  assert.equal(m.hra.bypass.reason, "NOT_AVAILABLE");
  assert.equal(m.hra.bypass.auto, false);
});

// ---------------- the form no longer steers people into the hole ----------------

test("a fresh form no longer pre-fills termDate with a skip token", () => {
  assert.equal(initialForm().termDate, "");
  assert.equal(clearedForm().termDate, "");
});

// ---------------- provenance ----------------

test("provenance silences 'not heard' but never a contradiction", () => {
  const meta = { tfl: { source: "carrier" } };
  const quiet = checkTranscript({ ...SAMPLE, tfl: "45 DAYS FROM DOS" }, FULL_CALL.replace(/Timely filing[^.]*\./, ""), meta);
  assert.equal(st(quiet, "tfl"), "carrier", "never spoken, and it was not going to be — not a failure");
  assert.ok(!quiet.missing.includes("tfl"));

  const loud = checkTranscript({ ...SAMPLE, tfl: "45 DAYS FROM DOS" }, FULL_CALL, meta);
  assert.equal(st(loud, "tfl"), "mismatch", "the call disproved the carrier record — must still fail");
  assert.ok(loud.mismatched.includes("tfl"));
});

test("a carrier value the rep does state still earns its tick", () => {
  const r = checkTranscript(SAMPLE, FULL_CALL, { payerId: { source: "carrier" } });
  assert.equal(st(r, "payerId"), "found");
});

// ---------------- backwards compatibility ----------------

test("records saved before _meta still verify, with no bypasses of their own", () => {
  const before = checkTranscript(SAMPLE, FULL_CALL);
  assert.equal(before.verdict, "APPROVED");
  // "NA" still leaves the checklist entirely on the legacy path
  assert.equal(before.checks.find((c) => c.key === "hra"), undefined);
  assert.deepEqual(before.bypassed, []);
  // The fields we already hold are excused from silence by their class, without
  // anyone having had to mark them — so a legacy record shows them as carrier
  // rather than reporting material the call was never going to supply.
  for (const k of before.carrier) {
    assert.ok(["payerId", "insPhone", "claimAddr", "tfl", "tflCorr"].includes(k), `unexpected carrier field ${k}`);
  }
});
