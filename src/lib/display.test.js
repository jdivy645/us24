import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// A perfect nine-field auto-fill once displayed as nine failures, because four
// separate lookup tables had no entry for the `autofill` status and fell through
// to a red ✗. Nothing failed; nothing caught it; the operator was simply told the
// feature did not work.
//
// This file exists so that cannot happen again. It reads the tables straight out
// of the source rather than importing the components, so it needs no DOM and no
// test framework beyond node:test.

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

// Everything checkTranscript can put on a check. Keep in step with the header
// comment in verify.js.
const STATUSES = ["found", "mismatch", "missing", "elsewhere", "quiet", "bypassed", "carrier", "echo", "autofill", "attested"];

// Everything it can return as a verdict.
const VERDICTS = ["APPROVED", "ATTESTED", "REJECTED", "UNVERIFIED", "NO TRANSCRIPT"];

const keysOf = (src, name) => {
  const at = src.indexOf(`const ${name} =`);
  assert.ok(at >= 0, `${name} not found`);
  const body = src.slice(at, src.indexOf("};", at) + 2);
  return new Set([...body.matchAll(/(?:^|[{,\s])["']?([A-Za-z ]+)["']?\s*:/g)].map((m) => m[1].trim()));
};

test("DISPLAY every check status has a glyph in the transcript checklist", () => {
  const src = read("../components/TranscriptView.jsx");
  const tick = keysOf(src, "TICK");
  for (const s of STATUSES) assert.ok(tick.has(s), `TICK has no entry for "${s}" — it would render as a red ✗`);
});

test("DISPLAY every check status has a row style", () => {
  const row = keysOf(read("../components/TranscriptView.jsx"), "ROW");
  for (const s of STATUSES) assert.ok(row.has(s), `ROW has no entry for "${s}"`);
});

test("DISPLAY every check status has a sort rank", () => {
  // A missing key yields NaN, and the comparator then orders arbitrarily — for
  // exactly the rows the operator most needs to find.
  const order = keysOf(read("../components/VerifyPanel.jsx"), "ORDER");
  for (const s of STATUSES) assert.ok(order.has(s), `ORDER has no rank for "${s}"`);
});

test("DISPLAY every verdict has a colour, in both places a verdict is shown", () => {
  const pill = keysOf(read("../App.jsx"), "VERDICT_PILL");
  for (const vd of ["APPROVED", "ATTESTED", "REJECTED"]) {
    assert.ok(pill.has(vd), `VERDICT_PILL has no colour for "${vd}"`);
  }
  // The log builds its class with a conditional rather than a table.
  const log = read("../components/LogTable.jsx");
  for (const vd of VERDICTS.filter((x) => x !== "UNVERIFIED" && x !== "NO TRANSCRIPT")) {
    assert.ok(log.includes(`"${vd}"`), `LogTable's verdictClass never mentions "${vd}" — it would render grey, like an unverified record`);
  }
});

test("DISPLAY every field-state kind has a label", async () => {
  const { KIND_LABEL } = await import("./fieldState.js");
  const src = read("./fieldState.js");
  // Pull the kinds fieldStates() can actually produce.
  const kinds = new Set([...src.matchAll(/kind:\s*"([a-z]+)"/g)].map((m) => m[1]));
  for (const k of kinds) assert.ok(k in KIND_LABEL, `KIND_LABEL has no entry for "${k}"`);
});

test("DISPLAY the statuses this test knows about are the ones the engine emits", () => {
  // If someone adds a status to verify.js, this fails until they add it here —
  // and adding it here fails until every table above has an entry.
  const src = read("./verify.js");
  const emitted = new Set([...src.matchAll(/status:\s*"([a-z]+)"/g)].map((m) => m[1]));
  for (const s of emitted) assert.ok(STATUSES.includes(s), `verify.js emits "${s}", which this test does not cover`);
});
