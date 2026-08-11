import test from "node:test";
import assert from "node:assert/strict";
import { parseTranscript } from "./transcriptParse.js";
import { getPrep } from "./verify.js";
import { extractFromTranscript } from "./extract.js";
import { decide } from "./autofill.js";
import { CLEAN_CALL, CLEAN_TRUTH } from "./clean.fixture.js";

// Microsoft Teams is what this team actually exports, and it was the one shape the
// parser could not read. It fell through to unattributed plain text, which is not
// merely a lost feature — the speaker clocks stayed in the matched text.

const asTeams = (turns, { chrome = true } = {}) =>
  (chrome
    ? "Call with payer-20260810_165833-Meeting Recording\nAugust 10, 2026, 11:28AM\n32m 13s\nHost started transcription\n\n"
    : "")
  + turns.map(([who, text], i) => `${who}   ${i}:00\n${text}\n`).join("\n")
  + (chrome ? "\nHost stopped transcription" : "");

const CALL = [
  ["Clark", "Thank you for calling, my name is Clark, how can I help you today?"],
  ["Savi Sharma", "I need physical therapy benefits for a member of yours please."],
  ["Clark", "Of course. There is no copay on this plan at all for those services."],
  ["Savi Sharma", "And what is the timely filing limit for claims on this one?"],
  ["Clark", "Timely filing is one hundred eighty days from date of service."],
];

test("FORMAT a Teams export is recognised as one", () => {
  const p = parseTranscript(asTeams(CALL), { verifiedBy: "Savi Sharma" });
  assert.equal(p.format, "teams");
  assert.deepEqual(p.speakers.map((s) => s.name).sort(), ["Clark", "Savi Sharma"]);
  assert.ok(p.attributed, "the payer has to be identifiable, or nothing confirms anything");
});

test("FORMAT the export chrome never reaches the matcher", () => {
  // "August 10, 2026, 11:28AM" is a run of digits, and prepTranscript concatenates
  // digits into a stream a member ID is matched across. A date sitting in that
  // stream can glue onto a real value.
  const p = parseTranscript(asTeams(CALL), { verifiedBy: "Savi Sharma" });
  for (const junk of ["Meeting Recording", "32m 13s", "transcription", "August 10, 2026"]) {
    assert.ok(!p.text.includes(junk), `"${junk}" is still in the text`);
  }
});

test("FORMAT a speaker clock never becomes a value", () => {
  // The regression this whole format exists to prevent: a "9:00" header beside the
  // word copay was measured filling $9.00 into the co-pay amount, on a call where
  // the rep said there was no copay.
  const p = parseTranscript(asTeams([
    ["Clark", "Thank you for calling, my name is Clark speaking with you today."],
    ["Savi Sharma", "Is there a copay on this plan for physical therapy at all?"],
    ["Clark", "There is no copay whatsoever on this particular plan for that."],
  ]), { verifiedBy: "Savi Sharma" });
  const prep = getPrep(p.text);
  const d = decide(extractFromTranscript(prep, { ranges: p.ranges }), prep, { form: {} });
  assert.ok(!("copayAmt" in d.fill), `copay amount was invented: ${d.fill.copayAmt?.value}`);
  assert.equal(d.fill.copay?.value, "NO");
});

test("FORMAT the same call reads the same whichever way it was exported", () => {
  const original = parseTranscript(CLEAN_CALL, { insName: CLEAN_TRUTH.insName, verifiedBy: "Savi" });
  const teams = parseTranscript(
    asTeams(original.turns.map((t) => [t.speaker, t.text])),
    { insName: CLEAN_TRUTH.insName, verifiedBy: "Savi" });

  assert.equal(teams.format, "teams");
  assert.equal(teams.turns.length, original.turns.length);

  const read = (p) => {
    const prep = getPrep(p.text);
    return decide(extractFromTranscript(prep, { ranges: p.ranges }), prep, { form: {} }).fill;
  };
  const a = read(original), b = read(teams);
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), "the export format must not change what is read");
  for (const k of Object.keys(a)) assert.equal(b[k].value, a[k].value, k);
});

test("FORMAT prose that happens to end in a time is not a speaker", () => {
  // "call me back at 4:30" looks exactly like a Teams header if nothing else is
  // asked of it. A header must also look like a name, and must repeat.
  const p = parseTranscript([
    "The rep asked us to call back at 4:30",
    "We agreed and the member was told about it at 5:15",
    "Nothing else was discussed on the call that day",
  ].join("\n"), {});
  assert.equal(p.format, "plain");
});

test("FORMAT a Teams file whose speakers cannot be read still loses its chrome", () => {
  // The belt-and-braces path: if the header shape ever changes, the date line must
  // still not reach the matcher.
  const p = parseTranscript(
    "Call with payer-20260810_165833-Meeting Recording\nAugust 10, 2026, 11:28AM\n32m 13s\nThe deductible is three thousand dollars.",
    {});
  assert.equal(p.format, "plain");
  assert.ok(!p.text.includes("August 10, 2026"));
  assert.ok(p.text.includes("deductible"));
});

test("FORMAT one answer split over several breaths is one turn", () => {
  // Teams starts a new block on every pause. Three fragments of one answer look
  // like three separate answers to the question-and-answer projection.
  const p = parseTranscript(asTeams([
    ["Savi Sharma", "What is the timely filing limit for claims on this plan?"],
    ["Clark", "Let me have a look at that for you now, one moment please."],
    ["Clark", "Timely filing is one hundred eighty days from date of service."],
  ], { chrome: false }), { verifiedBy: "Savi Sharma" });
  assert.equal(p.turns.length, 2);
  assert.match(p.turns[1].text, /one moment please\. Timely filing/);
});
