import test from "node:test";
import assert from "node:assert/strict";
import { buildSheets, segmentText } from "./excelSheets.js";
import { HEAD } from "../data/fields.js";

const long = (chars) => "the deductible is nine hundred dollars and the co-pay is twenty five ".repeat(Math.ceil(chars / 68)).slice(0, chars);

test("a long transcript survives the export with no characters lost", () => {
  const text = long(150000);
  const [, t] = buildSheets([{ _id: "r1", lastName: "MOUSE", firstName: "MICKIE", _transcript: text }]);
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
  assert.equal(sheets.length, 1);
});

test("segmentText splits on words and loses nothing", () => {
  const words = Array.from({ length: 450 }, (_, i) => `w${i}`).join(" ");
  const segs = segmentText(words);
  assert.equal(segs.length, 3);
  assert.equal(segs.join(" "), words);
});
