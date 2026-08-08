import test from "node:test";
import assert from "node:assert/strict";
import { patientKey, policyKey, serviceKey, caseKey, similarPolicy, looksSameName, editDistanceAtMost, findSimilarCases, isProvisional } from "./identity.js";
import { moneyVal, sameValue, diffVersions, changeSummary, historyTable } from "./history.js";
import { buildPrefillForm, referenceFrom, applyPrefill, clearPrefilled, carrierLearnings } from "./prefill.js";
import { migrateLegacy, toLegacyRow } from "./migrate.js";
import { tierOf, REFERENCE_FIELDS } from "./schema.js";

/* ---------------------------------------------------------------- identity */

test("patient keys ignore case and punctuation", () => {
  assert.equal(patientKey({ lastName: "O'Brien", firstName: "Mary-Jo", dob: "1957-12-31" }),
    patientKey({ lastName: "OBRIEN", firstName: "MARYJO", dob: "1957-12-31" }));
});

test("a patient with no DOB is provisional and never auto-merged", () => {
  // "SMITH|JOHN|" collides across genuinely different people.
  assert.ok(isProvisional({ lastName: "SMITH", firstName: "JOHN", dob: "" }));
  assert.ok(!isProvisional({ lastName: "SMITH", firstName: "JOHN", dob: "1970-01-01" }));
});

test("policy keys strip formatting", () => {
  assert.equal(policyKey("W-101 619 535700"), "W101619535700");
  assert.equal(policyKey("106723434-01"), "10672343401");
});

test("service keys order multi-discipline strings but keep PT distinct", () => {
  assert.equal(serviceKey("OT/PT"), serviceKey("PT/OT"));
  assert.notEqual(serviceKey("PT/OT"), serviceKey("PT"));
  assert.equal(serviceKey(""), "PT");
});

test("case keys are stable across input formatting", () => {
  assert.equal(caseKey("pat_1", "car_1", "106723434-01", "PT"),
    caseKey("pat_1", "car_1", "106723434 01", "pt"));
});

test("similarPolicy catches a typo but stays quiet on short or unrelated codes", () => {
  assert.ok(similarPolicy("106723434", "106723435"), "one digit off");
  assert.ok(similarPolicy("106723434", "10672343"), "a dropped digit");
  assert.ok(!similarPolicy("12345", "54321"), "too short to guess at");
  assert.ok(!similarPolicy("106723434", "999888777"), "unrelated");
  assert.ok(!similarPolicy("106723434", "106723434"), "identical is not a typo");
});

test("editDistanceAtMost bails out early rather than scoring the whole string", () => {
  assert.ok(editDistanceAtMost("abcdef", "abcxef", 1));
  assert.ok(!editDistanceAtMost("abcdef", "xxxxxx", 2));
  assert.ok(!editDistanceAtMost("abc", "abcdefgh", 2));
});

test("looksSameName joins TAJ to TAJUDEEN but not ROBERT to RICHARD", () => {
  assert.ok(looksSameName("TAJ", "TAJUDEEN"));
  assert.ok(looksSameName("Bob", "bob"));
  assert.ok(!looksSameName("ROBERT", "RICHARD"));
});

test("a re-verification for another discipline is offered as a related case", () => {
  const cases = [{ id: "c1", patientId: "p1", carrierId: "x1", policyKey: policyKey("999"), serviceKey: "PT" }];
  const hits = findSimilarCases(cases, { patientId: "p1", carrierId: "x1", policyId: "999", serviceType: "OT" });
  assert.equal(hits[0].reason, "other-service");
});

/* ----------------------------------------------------------------- history */

test("money is compared numerically, so typing style is not a change", () => {
  assert.equal(moneyVal("$1,500.00"), 1500);
  assert.equal(moneyVal("1500"), 1500);
  assert.equal(moneyVal("NA"), null);
  assert.ok(sameValue("dedInd", "$500.00", "500"));
  assert.ok(!sameValue("dedInd", "", "NA"), "blank and answered are not the same");
});

test("diffVersions reports the figures that moved, with the delta", () => {
  const a = { dedMet: "$0.00", dedRem: "$3000.00", today: "2026-03-04", callRef: "111" };
  const b = { dedMet: "$500.00", dedRem: "$2500.00", today: "2026-08-06", callRef: "222" };
  const d = diffVersions(a, b);
  assert.deepEqual(d.map((x) => x.key), ["dedMet", "dedRem"]);
  assert.equal(d[0].delta, 500);
  assert.equal(d[0].kind, "money");
  assert.equal(d[1].delta, -500);
});

test("per-call fields are excluded from the summary but not from the record", () => {
  const d = diffVersions({ today: "a", repName: "X", note: "n" }, { today: "b", repName: "Y", note: "m" });
  assert.deepEqual(d, [], "these change every call and would bury the signal");
  assert.equal(diffVersions({ today: "a" }, { today: "b" }, { includePerCall: true }).length, 1);
});

test("changeSummary leads with money", () => {
  const d = diffVersions({ dedMet: "$0", network: "IN NETWORK" }, { dedMet: "$500", network: "OUT OF NETWORK" });
  assert.match(changeSummary(d), /^deductible met/i);
});

test("historyTable lists only the fields that ever moved", () => {
  const versions = [
    { seq: 1, verifiedOn: "2026-03-04", form: { dedMet: "$0.00", insName: "AETNA" } },
    { seq: 2, verifiedOn: "2026-08-06", form: { dedMet: "$500.00", insName: "AETNA" } },
  ];
  const t = historyTable(versions);
  assert.deepEqual(t.dates, ["2026-03-04", "2026-08-06"]);
  assert.deepEqual(t.rows.map((r) => r.key), ["dedMet"]);
  assert.deepEqual(t.rows[0].cells, ["$0.00", "$500.00"]);
});

/* ----------------------------------------------------------------- prefill */

test("carrier master beats a prior call for payer facts", () => {
  const { form, prov } = buildPrefillForm({
    carrier: { payerId: "60054", tfl: "120 DAYS FROM DOS" },
    priorVersion: { form: { payerId: "99999", tfl: "90 DAYS FROM DOS", network: "IN NETWORK" } },
  });
  assert.equal(form.payerId, "60054");
  assert.equal(prov.payerId, "carrier");
  assert.equal(form.network, "IN NETWORK");
  assert.equal(prov.network, "prior");
});

test("the numbers the call exists to establish are never prefilled", () => {
  const { form } = buildPrefillForm({
    priorVersion: { form: { dedMet: "$500.00", dedRem: "$2500.00", oopMet: "$100", oopRem: "$900", visitUsed: "3", repName: "CLARK", callRef: "111" } },
  });
  for (const k of [...REFERENCE_FIELDS, "repName", "callRef", "today", "note"]) {
    assert.equal(form[k], undefined, `${k} must not be prefilled`);
  }
});

test("prefilled values are all marked as coming from somewhere other than the operator", () => {
  const { form, prov } = buildPrefillForm({
    patient: { lastName: "YUSUFF", firstName: "TAJ", dob: "1957-12-31" },
    carrier: { payerId: "60054" },
  });
  for (const k of Object.keys(form)) {
    assert.ok(prov[k], `${k} has no provenance`);
    assert.notEqual(prov[k], "manual");
  }
});

test("last call's figures come back as reference, not as form values", () => {
  const ref = referenceFrom({ verifiedOn: "2026-03-04", form: { dedMet: "$500.00", oopMet: "$100.00", dedInd: "$3000" } });
  assert.equal(ref.on, "2026-03-04");
  assert.deepEqual(ref.items.map((i) => i.key), ["dedMet", "oopMet"]);
});

test("applying a prefill never overwrites what the operator typed", () => {
  const cur = { lastName: "TYPED", insName: "" };
  const { form, meta, filled } = applyPrefill(cur, {}, { form: { lastName: "STORED", insName: "AETNA" }, prov: { lastName: "patient", insName: "prior" } });
  assert.equal(form.lastName, "TYPED");
  assert.equal(form.insName, "AETNA");
  assert.deepEqual(filled, ["insName"]);
  assert.equal(meta.insName.source, "prior");
});

test("clearing prefilled values leaves manual ones alone", () => {
  const { form, meta } = clearPrefilled(
    { payerId: "60054", dedInd: "$3000" },
    { payerId: { source: "carrier" }, dedInd: { source: "manual" } });
  assert.equal(form.payerId, "");
  assert.equal(form.dedInd, "$3000");
  assert.equal(meta.payerId, undefined);
});

test("the carrier record only learns from values the operator typed AND the rep confirmed", () => {
  const v = { payerId: "60054", tfl: "120 DAYS FROM DOS", claimAddr: "PO BOX 1" };
  const meta = { payerId: { source: "manual" }, tfl: { source: "carrier" }, claimAddr: { source: "manual" } };
  const result = { checks: [
    { key: "payerId", status: "found" },
    { key: "tfl", status: "found" },
    { key: "claimAddr", status: "missing" },
  ] };
  // tfl came from the carrier record — learning it back would let a wrong value
  // re-confirm itself forever. claimAddr was never confirmed by the rep.
  assert.deepEqual(carrierLearnings(v, meta, result), { payerId: "60054" });
});

test("the prefill tier table covers every field it claims to", () => {
  assert.equal(tierOf("payerId"), "carrier");
  assert.equal(tierOf("dedMet"), "reference");
  assert.equal(tierOf("today"), "none");
});

/* --------------------------------------------------------------- migration */

const ROW = (over) => ({
  lastName: "YUSUFF", firstName: "TAJUDEEN", dob: "1957-12-31", insName: "AETNA",
  policyId: "101619535700", serviceType: "PT", today: "2026-03-04",
  payerId: "60054", tfl: "120 DAYS FROM DOS", insPhone: "800-624-0756",
  _savedAt: "3/4/2026, 10:00:00 AM", _verdict: "APPROVED", ...over,
});

test("a migrated row keeps its id, so anything keyed to it stays reachable", () => {
  const out = migrateLegacy([ROW({ _id: "abc-123" })]);
  assert.equal(out.versions[0].id, "abc-123");
  const minted = migrateLegacy([ROW({})]);
  assert.ok(minted.versions[0].id.startsWith("ver_"));
});

test("three calls for the same patient and policy become one case with three versions", () => {
  const out = migrateLegacy([
    ROW({ _id: "v3", today: "2026-08-06", dedMet: "$900.00" }),
    ROW({ _id: "v2", today: "2026-05-05", dedMet: "$500.00" }),
    ROW({ _id: "v1", today: "2026-03-04", dedMet: "$0.00" }),
  ]);
  assert.equal(out.cases.length, 1);
  assert.equal(out.versions.length, 3);
  // The log is newest-first; seq must still ascend with time.
  assert.deepEqual(out.versions.map((v) => v.id), ["v1", "v2", "v3"]);
  assert.deepEqual(out.versions.map((v) => v.seq), [1, 2, 3]);
  assert.deepEqual(out.versions[1].changed, ["dedMet"]);
  assert.equal(out.cases[0].versionCount, 3);
  assert.equal(out.cases[0].latestVersionId, "v3");
});

test("PT and OT for one patient are separate cases, so their histories stay clean", () => {
  const out = migrateLegacy([ROW({ _id: "a", serviceType: "PT" }), ROW({ _id: "b", serviceType: "OT" })]);
  assert.equal(out.patients.length, 1);
  assert.equal(out.cases.length, 2);
});

test("two payers for one patient are two cases and two carriers", () => {
  const out = migrateLegacy([ROW({ _id: "a" }), ROW({ _id: "b", insName: "UHC", policyId: "555" })]);
  assert.equal(out.patients.length, 1);
  assert.equal(out.carriers.length, 2);
  assert.equal(out.cases.length, 2);
});

test("the carrier master is seeded from history, so it works on day one", () => {
  const c = migrateLegacy([ROW({ _id: "a" })]).carriers[0];
  assert.equal(c.payerId, "60054");
  assert.equal(c.tfl, "120 DAYS FROM DOS");
  assert.equal(c.insPhone, "800-624-0756");
});

test("transcripts move to their own store and leave the version", () => {
  const out = migrateLegacy([ROW({ _id: "a", _transcript: "hello there" })]);
  assert.deepEqual(out.transcripts, [{ id: "a", text: "hello there" }]);
  assert.equal(out.versions[0].form._transcript, undefined);
  assert.equal(out.versions[0]._transcript, undefined);
  assert.equal(out.versions[0].hasTranscript, true);
});

test("migrating twice produces the same graph rather than duplicates", () => {
  const rows = [ROW({ _id: "a" }), ROW({ _id: "b", today: "2026-05-05" })];
  const a = migrateLegacy(rows), b = migrateLegacy(rows);
  assert.deepEqual(a.patients.map((p) => p.id), b.patients.map((p) => p.id));
  assert.deepEqual(a.cases.map((c) => c.id), b.cases.map((c) => c.id));
});

test("a row missing a name migrates without throwing", () => {
  const out = migrateLegacy([{ insName: "AETNA", _savedAt: "bad date" }]);
  assert.equal(out.versions.length, 1);
  assert.equal(out.patients.length, 1);
});

test("a version converts back to the flat row the Excel export understands", () => {
  const out = migrateLegacy([ROW({ _id: "a", _transcript: "x" })]);
  const row = toLegacyRow(out.versions[0], out.cases[0], "x");
  assert.equal(row.lastName, "YUSUFF");
  assert.equal(row._id, "a");
  assert.equal(row._verdict, "APPROVED");
  assert.equal(row._transcript, "x");
});
