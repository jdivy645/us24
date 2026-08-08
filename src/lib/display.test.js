import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkTranscript } from "./verify.js";
import { ASH_CALL } from "./ash.fixture.js";

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

test("DISPLAY every verdict has a sentence telling the operator what was saved", () => {
  // The same defect one layer over: this chain had no ATTESTED branch, so the
  // operator finished signing off twenty-three values read from a call and was
  // told no transcript was attached. Nothing threw; the record itself was right.
  const src = read("../App.jsx");
  const at = src.indexOf("const SAVED = {");
  assert.ok(at >= 0, "the save message must be a table, not a chain — a chain hides the gap");
  const body = src.slice(at, src.indexOf("};", at) + 2);
  for (const vd of VERDICTS) {
    assert.ok(body.includes(JSON.stringify(vd)) || body.includes(vd + ":"),
      `the save message has no case for "${vd}"`);
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

// ---------------- a correct machine-read value never shows as an error ----------------

test("DISPLAY a machine-read value the matcher cannot re-place is not an error", () => {
  // The two engines reach a value by different routes. applyExtraction has already
  // confirmed nothing contradicts it before it was written, so "the anchors cannot
  // reach it" is a fact about the matcher, not the value. Rendering ✗ marks a
  // correct value as wrong with no action that clears it — the worst outcome
  // available, because the operator either retypes what is already right or stops
  // trusting the marks. On the reference call this hit three of twenty-three.
  const form = { dedRem: "$1250.00" };
  const meta = { dedRem: { source: "call", extract: { value: "$1250.00", quote: "…", score: 1 } } };
  const t = "Agent: What is the deductible?\nRep: One thousand two hundred fifty dollars is where they stand right now on that.\n";
  const c = checkTranscript(form, t, meta).checks.find((x) => x.key === "dedRem");
  assert.ok(c.status === "autofill" || c.status === "attested", `got ${c.status}`);
  assert.ok(c.unplaced, "and it says so, rather than pretending the match was clean");
  assert.ok(keysOf(read("../components/TranscriptView.jsx"), "TICK").has(c.status));
});

test("DISPLAY a machine-read value the rep contradicted still fails", () => {
  // The exclusion that makes the rule above safe to state.
  const form = { tfl: "90 DAYS" };
  const meta = { tfl: { source: "call", extract: { value: "90 DAYS", quote: "…", score: 1 } } };
  const c = checkTranscript(form, ASH_CALL, meta).checks.find((x) => x.key === "tfl");
  assert.equal(c.status, "mismatch");
});

test("DISPLAY editing a machine-read value hands it back to the ordinary grading", () => {
  // Once the box no longer holds what the machine wrote, it is the operator's value
  // and gets no protection from having been auto-filled once.
  const meta = { dedRem: { source: "call", extract: { value: "$1250.00", quote: "…", score: 1 } } };
  const t = "Agent: What is the deductible?\nRep: One thousand two hundred fifty dollars is where they stand right now on that.\n";
  const c = checkTranscript({ dedRem: "$9999.00" }, t, meta).checks.find((x) => x.key === "dedRem");
  assert.notEqual(c.status, "autofill");
});
