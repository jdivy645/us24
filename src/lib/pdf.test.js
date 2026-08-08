import test from "node:test";
import assert from "node:assert/strict";
import { buildPDF } from "./pdf.js";
import { sampleForm } from "../data/fields.js";

// The client's template is a one-page document. pdf.js keeps it that way with a
// font/leading scale ladder, which is exactly the kind of thing that regresses
// silently once someone adds a row — so it gets a test.

const pages = (doc) => doc.internal.getNumberOfPages();

test("a normal record fits on one page", () => {
  assert.equal(pages(buildPDF(sampleForm(), {})), 1);
});

test("an empty form still renders one page", () => {
  assert.equal(pages(buildPDF({}, {})), 1);
});

test("a long claim address and a long note still fit on one page", () => {
  const v = {
    ...sampleForm(),
    claimAddr: "ATTN CLAIMS DEPARTMENT, " + "PO BOX 981106 SUITE 400 ".repeat(6) + "EL PASO TX 79998-1106",
    note: "PATIENT IS RESPONSIBLE FOR THE FULL ALLOWED AMOUNT UNTIL THE DEDUCTIBLE IS SATISFIED. ".repeat(7),
    authHow: "Submit through the Holista provider portal, or fax to 800-555-0142 ".repeat(3),
  };
  assert.equal(pages(buildPDF(v, {})), 1);
});

test("bypass reasons and carrier marks do not push it to a second page", () => {
  const meta = {};
  for (const k of ["hra", "payerId", "claimAddr", "tfl", "tflCorr", "authDates", "authNum", "secDed"]) {
    meta[k] = { bypass: { reason: "NOT_ON_CALL", auto: false }, source: "carrier" };
  }
  assert.equal(pages(buildPDF(sampleForm(), meta)), 1);
});
