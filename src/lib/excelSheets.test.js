import test from "node:test";
import assert from "node:assert/strict";
import { buildSheets, segmentText } from "./excelSheets.js";
import { HEAD } from "../data/fields.js";

const long = (chars) => "the deductible is nine hundred dollars and the co-pay is twenty five ".repeat(Math.ceil(chars / 68)).slice(0, chars);

// Looked up by name rather than by position: the workbook gained the client's
// per-section sheets, and an index would silently start reading a different one.
const sheet = (sheets, name) => sheets.find((s) => s.name === name);

test("a long transcript survives the export with no characters lost", () => {
  const text = long(150000);
  const t = sheet(buildSheets([{ _id: "r1", lastName: "MOUSE", firstName: "MICKIE", _transcript: text }]), "Transcripts");
  const joined = t.rows.map((r) => r.Text).join(" ");
  // Segmenting normalises runs of whitespace, so compare on words.
  assert.deepEqual(joined.split(/\s+/).filter(Boolean), text.split(/\s+/).filter(Boolean));
});

test("the main sheet keeps a readable excerpt and says where the rest is", () => {
  const text = long(150000);
  const [log] = buildSheets([{ _id: "r1", _transcript: text }]);
  const cell = log.rows[0][HEAD._transcript];
  assert.ok(cell.length < 5000, "an excerpt, not the whole call");
  assert.match(cell, /full text on the "Transcripts" sheet — 150,000 characters/);
});

test("no cell can exceed Excel's limit", () => {
  const sheets = buildSheets([{ _id: "r1", _transcript: long(150000), claimAddr: "X".repeat(60000) }]);
  for (const s of sheets) {
    for (const row of s.rows) {
      for (const [k, val] of Object.entries(row)) {
        assert.ok(String(val).length <= 32767, `${s.name}.${k} is ${String(val).length} chars`);
      }
    }
  }
});

test("the main sheet's header order still matches the field registry", () => {
  const [log] = buildSheets([{ _id: "r1" }]);
  assert.deepEqual(log.header, Object.keys(HEAD).map((k) => HEAD[k]));
});

test("array audit columns are flattened, not stringified as objects", () => {
  const [log] = buildSheets([{ _id: "r1", _bypassed: ["HSA/HRA", "Payer ID"], _missing: [] }]);
  assert.equal(log.rows[0][HEAD._bypassed], "HSA/HRA, Payer ID");
  assert.equal(log.rows[0][HEAD._missing], "");
});

test("records with no transcript produce no Transcripts sheet", () => {
  const sheets = buildSheets([{ _id: "r1", lastName: "MOUSE" }]);
  assert.equal(sheet(sheets, "Transcripts"), undefined);
});

test("records with no QA findings produce no Error Log sheet", () => {
  assert.equal(sheet(buildSheets([{ _id: "r1", lastName: "MOUSE" }]), "Error Log"), undefined);
});

test("the client's section sheets are all present and readable on their own", () => {
  const sheets = buildSheets([{
    _id: "r1", projectName: "EC MARVEL", lastName: "MOUSE", firstName: "MICKIE", dob: "1928-11-18",
    insName: "AETNA", policyId: "123456", authEval: "YES", repName: "CLARK", _authRequired: "YES",
  }]);
  for (const name of ["Patient", "Insurance", "Authorization", "Call Information"]) {
    const s = sheet(sheets, name);
    assert.ok(s, `${name} sheet is missing`);
    // Each section repeats who and which project, so a sheet pulled out on its own
    // still identifies its rows.
    for (const col of [HEAD.projectName, HEAD.lastName]) {
      assert.ok(s.header.includes(col), `${name} sheet does not carry "${col}"`);
    }
    assert.equal(s.header.length, s.widths.length, `${name} sheet has a width per column`);
  }
  assert.equal(sheet(sheets, "Authorization").rows[0][HEAD._authRequired], "YES");
  assert.equal(sheet(sheets, "Insurance").rows[0][HEAD.policyId], "123456");
});

test("QA findings get one row each so P1s can be counted", () => {
  const sheets = buildSheets([{
    _id: "r1", projectName: "EC MARVEL", lastName: "MOUSE", firstName: "MICKIE",
    _errors: [
      { priority: "P1", fieldKey: "policyId", note: "wrong member id", by: "QA1", at: "2026-08-11T09:00:00Z" },
      { priority: "P3", fieldKey: "", note: "typo in the note", by: "QA1", at: "2026-08-11T09:01:00Z" },
    ],
  }]);
  const log = sheet(sheets, "Error Log");
  assert.equal(log.rows.length, 2);
  assert.equal(log.rows[0].Priority, "P1");
  assert.equal(log.rows[0].Field, HEAD.policyId);
  assert.equal(log.rows[1].Field, "Whole record");
  // …and the main sheet still reads them, so one sheet tells the whole story.
  assert.match(sheet(sheets, "VOB Log").rows[0][HEAD._errors], /P1 Policy ID: wrong member id/);
});

test("segmentText splits on words and loses nothing", () => {
  const words = Array.from({ length: 450 }, (_, i) => `w${i}`).join(" ");
  const segs = segmentText(words);
  assert.equal(segs.length, 3);
  assert.equal(segs.join(" "), words);
});
