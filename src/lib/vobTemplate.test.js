import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVobDoc, deriveAdditionalInfo, derivePatResp, dedState,
  todayWithInitials, initialsOf, effRange, coverageText, authTxText, ordinal,
} from "./vobTemplate.js";

// The two documents the client supplied as the format of record. These fixtures
// are transcribed from them field for field; the strings asserted below are what
// their own PDFs print.

// VOB_CARSTEN_ACT_CIGNA ASH_08.04.26 — deductible not met, 80/20 coinsurance.
const ASH = {
  lastName: "BAZAN", firstName: "CARSTEN", dob: "2010-10-07", today: "2026-08-04", verifiedBy: "SP",
  insName: "CIGNA ASH", insPhone: "800-972-4226", policyId: "106723434-01", groupId: "00633434",
  planType: "OPEN ACCESS PLUS", serviceType: "PT", network: "IN-NETWORK",
  coverage: "INN BENEFITS WITH AUTH", authAfter: "5",
  effDate: "2025-10-01", termDate: "", payerId: "ASHP1", hra: "NO",
  copay: "NO", copayAmt: "", covPct: "80%", coins: "YES", coinsAmt: "20%",
  dedApply: "YES", dedInd: "$3000.00", dedMet: "$526.24", dedRem: "$2473.76",
  oop: "$6500.00", oopMet: "$1026.24", oopRem: "$5473.76",
  visitLimit: "20 (HARD MAX)", visitUsed: "01",
  authEval: "NO", authTx: "YES", referral: "NO", pcpRef: "NO", authHow: "THROUGH ASH (800-972-4226)",
  tfl: "90 DAYS FROM DOS", tflCorr: "180 DAYS FROM DOS",
  repName: "JAHNEEVA.C", callRef: "20874738", primary: "CIGNA ASH", hasSec: "NO", note: "",
};

// VOB_SAMPLE — deductible met, flat $20 co-pay.
const UHC = {
  lastName: "MOUSE", firstName: "MICKIE", today: "2026-08-04",
  insName: "UHC", insPhone: "877-842-3210", policyId: "12345678", groupId: "00000",
  planType: "POS CHOICE PLUS", serviceType: "PT", network: "IN- NETWORK",
  effDate: "2026-01-01", termDate: "12/31/2026", hra: "NA",
  copay: "YES", copayAmt: "$20.00", coins: "NO", coinsAmt: "",
  dedApply: "YES", dedInd: "$500.00", dedMet: "$500.00", dedRem: "$0.00",
  oop: "$1000.00", oopMet: "$500.00", oopRem: "$500.00",
  visitLimit: "MN", visitUsed: "00", hasSec: "NO", note: "",
};

const labelsOf = (doc, id) =>
  doc.rows.find((r) => r.id === id).cells.flatMap((c) => c.lines.map((l) => l.label));
const lineFor = (doc, key) =>
  doc.rows.flatMap((r) => r.cells).flatMap((c) => c.lines).find((l) => l.key === key);

// ---------------- the generated narrative ----------------

test("Additional Info reproduces the CIGNA ASH sample verbatim", () => {
  assert.equal(
    deriveAdditionalInfo(ASH),
    "PAT IS 100% RESPONSIBLE, AS DED NOT MET. AFTER DED MET CIGNA ASH COVER 80% AND 20% WILL BE PAT RESPONSIBILITY. AFTER OOP MET PAT WILL BE 100% COVERED BY CIGNA ASH."
  );
});

test("Additional Info reproduces the UHC co-pay sample verbatim", () => {
  assert.equal(
    deriveAdditionalInfo(UHC),
    "PATIENT IS RESPONSIBLE FOR $20.00 CO-PAY REST WILL BE COVERED BY UHC AS DED MET. AFTER OOP MET PATIENT WILL BE 100% COVERED BY UHC."
  );
});

test("a typed note always overrides the generated narrative", () => {
  const doc = buildVobDoc({ ...ASH, note: "PLAN TERMINATED — DO NOT BILL." }, {});
  assert.equal(lineFor(doc, "note").value, "PLAN TERMINATED — DO NOT BILL.");
});

test("the PAT box mirrors the narrative", () => {
  assert.equal(derivePatResp(ASH), "PAT: 100% RESPONSIBLE");
  assert.equal(derivePatResp(UHC), "PAT: $20.00 (CO-PAY)");
});

test("deductible state drives both, and reads remaining before met/individual", () => {
  assert.equal(dedState(ASH), "open");
  assert.equal(dedState(UHC), "met");
  assert.equal(dedState({ ...ASH, dedApply: "NO" }), "none");
  assert.equal(dedState({ dedInd: "$500", dedMet: "$500" }), "met");
  assert.equal(dedState({ dedInd: "$500", dedMet: "$200" }), "open");
  assert.equal(dedState({ dedApply: "YES" }), "unknown");
});

// ---------------- document structure ----------------

test("row order matches the client template exactly", () => {
  // `project` was added ahead of the client's own first row on request: the
  // document has to say which project it belongs to before it says anything else.
  // Everything below it is untouched and still in the template's order.
  assert.deepEqual(buildVobDoc(ASH, {}).rows.map((r) => r.id), [
    "project", "patient", "dates", "payer", "plan", "copay", "coins", "visits",
    "auth", "authnum", "parties", "claims", "sec1", "sec2", "sec3", "sec4",
  ]);
});

test("the project block carries what the record is filed under", () => {
  const rows = buildVobDoc({ ...ASH, projectName: "EC Marvel", category: "VOB", requestMode: "FAX", requestDate: "2026-08-03" }, {}).rows;
  const text = JSON.stringify(rows.find((r) => r.id === "project"));
  for (const bit of ["EC MARVEL", "VOB", "FAX", "08/03/2026"]) {
    assert.ok(text.includes(bit), `the project row does not show "${bit}"`);
  }
});

test("the secondary block prints even with no secondary insurance", () => {
  const rows = buildVobDoc({ ...ASH, hasSec: "NO" }, {}).rows;
  for (const id of ["sec1", "sec2", "sec3", "sec4"]) assert.ok(rows.some((r) => r.id === id), id);
});

test("the claim block spans the full width", () => {
  const claims = buildVobDoc(ASH, {}).rows.find((r) => r.id === "claims");
  assert.equal(claims.cells.length, 1);
});

test("network splits into two lines only when the individual status is filled", () => {
  const one = labelsOf(buildVobDoc(ASH, {}), "plan");
  assert.ok(one.includes("Network Status:"));
  assert.ok(!one.includes("Network Status Ind Prov:"));

  const two = labelsOf(buildVobDoc({ ...ASH, networkInd: "IN-NETWORK" }, {}), "plan");
  assert.ok(two.includes("Network Status Group:"));
  assert.ok(two.includes("Network Status Ind Prov:"));
});

test("the deductible label carries the service type", () => {
  assert.ok(labelsOf(buildVobDoc(ASH, {}), "copay").includes("Is Deductible Applied for PT Services:"));
  assert.ok(labelsOf(buildVobDoc({ ...ASH, serviceType: "OT" }, {}), "copay").includes("Is Deductible Applied for OT Services:"));
});

// ---------------- value formatting ----------------

test("Today's Date carries the verifier initials suffix", () => {
  assert.equal(todayWithInitials({ today: "2026-08-04", verifiedBy: "SP" }), "08/04/2026-SP");
  assert.equal(todayWithInitials({ today: "2026-08-04", verifiedBy: "Sarah Patel" }), "08/04/2026-SP");
  assert.equal(todayWithInitials({ today: "2026-08-04", verifiedBy: "" }), "08/04/2026");
  assert.equal(initialsOf("jahneeva c"), "JC");
});

test("the effective date prints as a range, open-ended when not terminated", () => {
  assert.equal(effRange(ASH), "10/01/2025 TO CURRENT");
  assert.equal(effRange({ ...ASH, termDate: "NO" }), "10/01/2025 TO CURRENT");
  assert.equal(effRange({ ...ASH, termDate: "12/31/2026" }), "10/01/2025 TO 12/31/2026");
  assert.equal(effRange({ ...ASH, effDate: "" }), "");
});

test("the auth threshold prints inline where the template shows it", () => {
  assert.equal(coverageText(ASH), "INN BENEFITS WITH AUTH (AFTER 5TH VISIT)");
  assert.equal(authTxText(ASH), "YES (AFTER 5TH VISIT)");
  // No threshold, no parenthetical.
  assert.equal(authTxText({ ...ASH, authAfter: "" }), "YES");
  // Never appended to coverage that carries no auth requirement.
  assert.equal(coverageText({ ...ASH, coverage: "INN BENEFITS WITHOUT AUTH" }), "INN BENEFITS WITHOUT AUTH");
  assert.equal(ordinal("8"), "8TH");
  assert.equal(ordinal("1"), "1ST");
  assert.equal(ordinal("22"), "22ND");
});

test("a blank termination date prints NO, as the sample does", () => {
  assert.equal(lineFor(buildVobDoc(ASH, {}), "termDate").value, "NO");
});

// ---------------- bypass and provenance on the artifact ----------------

test("a deliberately bypassed field prints its reason, not a blank and not a fake NA", () => {
  const doc = buildVobDoc(ASH, { hra: { bypass: { reason: "NOT_AVAILABLE", auto: false } } });
  const line = lineFor(doc, "hra");
  assert.ok(line.muted);
  assert.match(line.value, /Rep could not provide it/);
});

test("an auto bypass keeps printing its typed value — the template shows a bare NO", () => {
  const doc = buildVobDoc(ASH, { hra: { bypass: { reason: "NOT_APPLICABLE", auto: true } } });
  const line = lineFor(doc, "hra");
  assert.equal(line.value, "NO");
  assert.ok(!line.muted);
});

test("carrier-sourced values are marked and footnoted", () => {
  const doc = buildVobDoc(ASH, { payerId: { source: "carrier" } });
  assert.equal(lineFor(doc, "payerId").mark, "†");
  assert.equal(doc.footnotes.length, 1);
  assert.equal(buildVobDoc(ASH, {}).footnotes.length, 0);
});
