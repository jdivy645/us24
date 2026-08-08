import test from "node:test";
import assert from "node:assert/strict";
import { parseTranscript, assignRoles, roleAt } from "./transcriptParse.js";
import { checkTranscript } from "./verify.js";

// ---------------- format detection ----------------

test("a RingCentral export is parsed into speaker turns", () => {
  const r = parseTranscript(`ASH | Aug 4, 2026 08:38 AM
 Sure, I can look that up.

Savi Sharma | Aug 4, 2026 08:39 AM
 The member ID is 106723434.

ASH | Aug 4, 2026 08:40 AM
 Thank you.`);
  assert.equal(r.format, "ringcentral");
  assert.equal(r.turns.length, 3);
  assert.equal(r.turns[0].speaker, "ASH");
  assert.equal(r.turns[1].text, "The member ID is 106723434.");
  assert.equal(r.turns[0].at, "Aug 4, 2026 08:38 AM");
});

test("inline Speaker: labels are parsed, but only when they repeat", () => {
  const r = parseTranscript(`Agent: Good morning, can I have the member ID?
Rep: It is 12345678.
Agent: And the group?
Rep: Zero zero six three three.`);
  assert.equal(r.format, "labelled");
  assert.equal(r.turns.length, 4);
  assert.equal(r.turns[1].speaker, "Rep");

  // A single "Note:" line at the top of a plain file is not a speaker.
  const plain = parseTranscript("Note: this call was hard to hear.\nThe deductible is nine hundred dollars.");
  assert.equal(plain.format, "plain");
});

test("WebVTT and SRT cues are parsed and consecutive cues merged", () => {
  const vtt = parseTranscript(`WEBVTT

1
00:00:01.000 --> 00:00:04.000
<v Rep>The deductible is nine hundred dollars.

2
00:00:04.000 --> 00:00:07.000
<v Rep>And the co-pay is twenty five.`);
  assert.equal(vtt.format, "vtt");
  assert.equal(vtt.turns.length, 1, "same speaker, consecutive cues — one turn");
  assert.match(vtt.turns[0].text, /nine hundred dollars\. And the co-pay/);
  assert.ok(!vtt.text.includes("00:00:01"), "cue timings must not reach the matcher");
  assert.ok(!vtt.text.includes("<v"));

  const srt = parseTranscript(`1
00:00:01,000 --> 00:00:04,000
The deductible is nine hundred dollars.`);
  assert.equal(srt.format, "vtt");
  assert.equal(srt.turns[0].text, "The deductible is nine hundred dollars.");
});

test("plain text keeps its line structure so clause splitting still works", () => {
  const raw = "The deductible is nine hundred dollars.\nThe co-pay is twenty five dollars.";
  const r = parseTranscript(raw);
  assert.equal(r.format, "plain");
  assert.equal(r.text, raw);
  assert.equal(r.turns.length, 1);
});

// ---------------- noise removal ----------------

test("the phone menu is dropped from the front, but 'press 1' mid-call is not", () => {
  const r = parseTranscript(`IVR | Aug 4, 2026 08:00 AM
 If your call is regarding eligibility, press 1. Calls may be monitored or recorded.

Rep | Aug 4, 2026 08:02 AM
 To reach authorizations later you press 3 from the main menu.`);
  assert.equal(r.turns.length, 1);
  assert.match(r.turns[0].text, /press 3/);
  assert.match(r.warnings[0], /phone-menu/);
});

test("headers and timestamps never reach the clean text", () => {
  const r = parseTranscript(`Rep | Aug 4, 2026 08:38 AM
 Member ID 106723434.`);
  assert.equal(r.text, "Member ID 106723434.");
  assert.ok(!/Aug 4/.test(r.text));
  assert.ok(!/08:38/.test(r.text), "clock digits would pollute the digit stream");
});

// ---------------- roles ----------------

test("the carrier name in a speaker label identifies the rep", () => {
  const turns = [{ speaker: "ASH", text: "Sure." }, { speaker: "Savi Sharma", text: "Can I have the deductible?" }];
  const { speakers } = assignRoles(turns, { insName: "CIGNA ASH" });
  assert.equal(speakers.find((s) => s.name === "ASH").role, "rep");
  assert.equal(speakers.find((s) => s.name === "Savi Sharma").role, "agent", "naming one names the other");
});

test("with no name match, the one asking the questions is our agent", () => {
  const turns = [
    { speaker: "A", text: "Can I have the deductible?" },
    { speaker: "A", text: "And what is the out of pocket?" },
    { speaker: "B", text: "The deductible is nine hundred dollars." },
    { speaker: "B", text: "Out of pocket is three thousand." },
  ];
  const { speakers } = assignRoles(turns, {});
  assert.equal(speakers.find((s) => s.name === "A").role, "agent");
  assert.equal(speakers.find((s) => s.name === "B").role, "rep");
});

test("an unattributed transcript leaves everything unknown, and verifies as before", () => {
  const r = parseTranscript("The deductible is nine hundred dollars.");
  assert.equal(r.turns[0].role, "unknown");
  assert.equal(roleAt(r.ranges, 0), "unknown");
  // opts.ranges with no rep is ignored, so a plain transcript loses nothing
  const withRanges = checkTranscript({ dedInd: "$900.00" }, r.text, {}, { ranges: r.ranges });
  const without = checkTranscript({ dedInd: "$900.00" }, r.text);
  assert.equal(withRanges.checks[0].status, without.checks[0].status);
});

test("roleAt finds the speaker for any offset, and nothing outside the ranges", () => {
  const r = parseTranscript(`ASH | Aug 4, 2026 08:38 AM
 Nine hundred dollars.

Savi | Aug 4, 2026 08:39 AM
 Thank you.`, { insName: "ASH" });
  assert.equal(roleAt(r.ranges, 0), "rep");
  assert.equal(roleAt(r.ranges, r.text.indexOf("Thank")), "agent");
  assert.equal(roleAt(r.ranges, 99999), "unknown");
});

test("a transcript with no identifiable rep warns rather than guessing", () => {
  const r = parseTranscript(`Speaker 1 | Aug 4, 2026 08:38 AM
 Hello.`, {});
  assert.ok(r.warnings.some((w) => /which speaker is the insurance rep/.test(w)));
});

// ---------------- the formats that used to fall through to plain ----------------

// Every one of these produced `speakers: []`, which made auto-fill impossible and
// left the panel telling the operator to fix it with a control that only renders
// when speakers exist.

test("a name with an inline timestamp is a speaker", () => {
  const r = parseTranscript(`Savi Sharma (00:12): Can you confirm the deductible?
Kim (00:20): The individual deductible is three thousand dollars.
Savi Sharma (00:31): Thank you.`);
  assert.equal(r.format, "labelled");
  assert.equal(r.turns.length, 3);
  assert.equal(r.turns[0].speaker, "Savi Sharma");
  assert.equal(r.turns[1].text, "The individual deductible is three thousand dollars.");
  assert.ok(!r.text.includes("00:12"), "a clock beside a member ID is exactly the wrong kind of digit run");
});

test("a leading timestamp is a speaker too", () => {
  const r = parseTranscript(`[00:12] Savi Sharma: What is the co-insurance?
[00:20] Kim: Twenty percent.
[00:25] Savi Sharma: Understood.`);
  assert.equal(r.format, "labelled");
  assert.equal(r.turns[1].speaker, "Kim");
  assert.equal(r.turns[1].text, "Twenty percent.");
  assert.ok(!/00:20/.test(r.text));
});

test("bracketed seconds and bare clock prefixes both parse", () => {
  const a = parseTranscript(`Kim [00:12:04]: Twenty percent.\nSavi [00:12:30]: Thanks.\nKim [00:13:00]: Anything else?`);
  assert.equal(a.format, "labelled");
  assert.equal(a.turns[0].speaker, "Kim");

  const b = parseTranscript(`00:12:04 Kim: Twenty percent.\n00:12:30 Savi: Thanks.\n00:13:00 Kim: Anything else?`);
  assert.equal(b.format, "labelled");
  assert.equal(b.turns[0].speaker, "Kim");
});

test("a diarisation marker is stripped from the speaker name", () => {
  const r = parseTranscript(`>> Savi: What is the deductible?\n>> Kim: Three thousand dollars.\n>> Savi: Thanks.`);
  assert.equal(r.format, "labelled");
  assert.equal(r.turns[0].speaker, "Savi");
});

test("a speaker on its own line takes the words beneath it", () => {
  const r = parseTranscript(`Savi Sharma:
Can you confirm the deductible for this member?

Kim:
The individual deductible is three thousand dollars.

Savi Sharma:
Thank you very much.`);
  assert.equal(r.format, "labelled");
  assert.equal(r.turns.length, 3);
  assert.equal(r.turns[1].speaker, "Kim");
  assert.equal(r.turns[1].text, "The individual deductible is three thousand dollars.");
});

test("a stray Note: line is still not a speaker", () => {
  const r = parseTranscript("Note: this call was hard to hear.\nThe deductible is nine hundred dollars and the co-pay is twenty five.");
  assert.equal(r.format, "plain");
});

// ---------------- attribution ----------------

test("an unlabelled transcript reports that it is unattributed, and says why", () => {
  const r = parseTranscript("The deductible is nine hundred dollars and the co-pay is twenty five dollars per visit.");
  assert.equal(r.attributed, false);
  assert.match(r.warnings.join(" "), /No speakers in this transcript/);
});

test("a transcript with an identified rep is attributed", () => {
  const r = parseTranscript(`ASH | Aug 4, 2026 08:38 AM
 Nine hundred dollars.

Savi | Aug 4, 2026 08:39 AM
 Thank you.`, { insName: "CIGNA ASH" });
  assert.equal(r.attributed, true);
  assert.deepEqual(r.warnings, []);
});

test("naming only our own agent still leaves someone as the rep", () => {
  // Three speakers: the pairing rule needs exactly two and the question-ratio
  // fallback needs nothing known, so this used to leave the call with no rep.
  const turns = [
    { speaker: "Savi Sharma", text: "Can I have the deductible?" },
    { speaker: "Kim", text: "Three thousand dollars." },
    { speaker: "Supervisor", text: "That is correct." },
  ];
  const { speakers } = assignRoles(turns, { verifiedBy: "Savi Sharma" });
  assert.equal(speakers.find((s) => s.name === "Savi Sharma").role, "agent");
  assert.ok(speakers.filter((s) => s.role === "rep").length >= 1);
});

test("a carrier name matching two speakers identifies neither as the rep by name", () => {
  // Calling both the rep would promote our own agent's read-backs into the form —
  // the exact failure this module exists to prevent. Fall back to who is asking.
  const turns = [
    { speaker: "Cigna Agent", text: "Can I have the deductible please?" },
    { speaker: "Cigna Rep", text: "Three thousand dollars." },
  ];
  const { speakers } = assignRoles(turns, { insName: "CIGNA" });
  assert.equal(speakers.filter((s) => s.role === "rep").length, 1, "exactly one rep");
  assert.equal(speakers.find((s) => s.name === "Cigna Agent").role, "agent");
});
