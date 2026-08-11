import test from "node:test";
import assert from "node:assert/strict";
import { buildPDF, measurePDF } from "./pdf.js";
import { sampleForm } from "../data/fields.js";

// The client's template is a one-page document. pdf.js keeps it that way with a
// font/leading scale ladder, which is exactly the kind of thing that regresses
// silently once someone adds a row — so it gets a test.
//
// It got the WRONG test for a long time. Every case below used to assert
// `getNumberOfPages() === 1`, which is true of every document this file can
// produce: nothing in it calls addPage(). Content that does not fit is drawn past
// the bottom edge and vanishes. Three rounds of new rows went in under a green
// suite that could not fail. measurePDF() reports the real numbers.

const fit = (v, meta) => measurePDF(v, meta || {});

test("PAGE the fit is measured, not assumed", () => {
  // The guard rail for the guard rail: if this ever reads 1 again, the test above
  // it is measuring nothing.
  const m = fit(sampleForm());
  assert.ok(m.avail > 500, "a letter page has room for a body");
  assert.equal(m.heights.length, 4, "one measurement per scale on the ladder");
});

test("PAGE a normal record fits at full size", () => {
  const m = fit(sampleForm());
  assert.ok(m.fits, `overflows by ${m.overflow}pt`);
  assert.equal(m.scale, 0, "a normal record should not need shrinking at all");
});

test("PAGE an empty form fits", () => {
  assert.ok(fit({}).fits);
});

test("PAGE a long claim address and a long note still fit", () => {
  const m = fit({
    ...sampleForm(),
    claimAddr: "ATTN CLAIMS DEPARTMENT, " + "PO BOX 981106 SUITE 400 ".repeat(6) + "EL PASO TX 79998-1106",
    note: "PATIENT IS RESPONSIBLE FOR THE FULL ALLOWED AMOUNT UNTIL THE DEDUCTIBLE IS SATISFIED. ".repeat(7),
    authHow: "Submit through the Holista provider portal, or fax to 800-555-0142 ".repeat(3),
  });
  assert.ok(m.fits, `overflows by ${m.overflow}pt`);
});

test("PAGE bypass reasons and carrier marks do not push it over", () => {
  const meta = {};
  for (const k of ["hra", "payerId", "claimAddr", "tfl", "tflCorr", "authDates", "authNum", "secDed"]) {
    meta[k] = { bypass: { reason: "NOT_ON_CALL", auto: false }, source: "carrier" };
  }
  assert.ok(fit(sampleForm(), meta).fits);
});

test("PAGE the worst record this form can hold still fits", () => {
  // Everything long at once, a secondary payer, and every optional field filled.
  // If this stops fitting, the ladder needs another rung or the template needs a
  // row removing — and the failure should say which by how far it is over.
  const m = fit({
    ...sampleForm(),
    insName: "CIGNA HEALTHCARE / AMERICAN SPECIALTY HEALTH",
    planType: "HMO MEDICARE ADVANTAGE DUAL SPECIAL NEEDS PLAN",
    planName: "AETNA MEDICARE DUAL CARE PLAN (HMO D-SNP) 2026",
    coverage: "IN NETWORK BENEFITS WITH PRIOR AUTHORIZATION REQUIRED FOR ALL SERVICES",
    claimAddr: "ATTN CLAIMS DEPARTMENT, " + "PO BOX 981106 SUITE 400 ".repeat(5) + "EL PASO TX 79998",
    authHow: "Submit through the Holista provider portal, or fax to 800-555-0142 ".repeat(3),
    note: "PATIENT IS RESPONSIBLE FOR THE FULL ALLOWED AMOUNT UNTIL THE DEDUCTIBLE IS SATISFIED. ".repeat(9),
    pat: "ACCOUNT 88213 — split billing, secondary to be added once the member confirms",
    hasSec: "YES", secName: "MEDICARE PART B", secPlan: "MEDICARE PART B SUPPLEMENT PLAN G",
    secPolicy: "1EG4TE5MK72", secEff: "2025-01-01", secDed: "$257.00",
    secVisit: "MEDICALLY NECESSARY", secUsed: "0",
  });
  assert.ok(m.fits, `overflows by ${m.overflow}pt at the smallest scale — ${m.rows} rows`);
});

test("PAGE it still produces a document", () => {
  assert.ok(buildPDF(sampleForm(), {}).output("datauristring").startsWith("data:application/pdf"));
});
