import test from "node:test";
import assert from "node:assert/strict";
import { parseTranscript } from "./transcriptParse.js";
import { getPrep, checkTranscript } from "./verify.js";
import { extractFromTranscript } from "./extract.js";
import { decide } from "./autofill.js";
import { splitName } from "./importMap.js";
import { patientKey } from "./identity.js";
import { fullName } from "./vobTemplate.js";

// American order — last name then first — is what these calls use, what the
// client's sheets are written in, and what the form prints. This file pins it at
// every point a name enters or leaves the app.

const call = (...lines) => {
  const t = lines.join("\n");
  const p = parseTranscript(t, { verifiedBy: "Agent" });
  const prep = getPrep(p.text);
  return decide(extractFromTranscript(prep, { ranges: p.ranges }), prep, { form: {} }).fill;
};

const OPENING = "Agent: Good morning, I need physical therapy benefits for a member please.";
const REPLY = "Rep: Certainly, let me pull that member record up for you right now.";

/* ---------------- reading a name off the call ---------------- */

test("NAME a labelled last and first name land in the right boxes", () => {
  const f = call(OPENING, REPLY,
    "Agent: The last name is Yusuff and the first name is Tajudeen for this one.",
    "Rep: Thank you, I have that member here in front of me now.");
  assert.equal(f.lastName?.value, "YUSUFF");
  assert.equal(f.firstName?.value, "TAJUDEEN");
});

test("NAME the label may sit straight against the name", () => {
  const f = call(OPENING, REPLY,
    "Agent: Last name Robinson, first name Mary, and that is the member.",
    "Rep: Got it, thank you very much for all of that information.");
  assert.equal(f.lastName?.value, "ROBINSON");
  assert.equal(f.firstName?.value, "MARY");
});

test("NAME surname and given name are read the same way", () => {
  const f = call(OPENING, REPLY,
    "Agent: Surname Okonkwo, given name Adaeze, for the member on this policy.",
    "Rep: Thank you, that member is showing as active with us today.");
  assert.equal(f.lastName?.value, "OKONKWO");
  assert.equal(f.firstName?.value, "ADAEZE");
});

test("NAME the rep reading the name back is read too", () => {
  const f = call(OPENING,
    "Agent: I have a member I need to check the benefits for today please.",
    "Rep: Sure thing. I show the last name is Bazan on this policy here.",
    "Agent: That is correct, thank you very much for confirming it.");
  assert.equal(f.lastName?.value, "BAZAN");
});

/* ---------------- and, far more important, when NOT to ---------------- */

test("NAME GUARD an unlabelled name is never guessed at", () => {
  // "Presence matchers can tell you whether a name you already hold was spoken,
  // never what the name was." Only a name the speaker labelled is read.
  const f = call(
    "Agent: Good morning, I am calling about Tajudeen Yusuff for therapy benefits.",
    "Rep: Okay, let me have a look at that member record for you now please.");
  assert.ok(!f.lastName, `invented a surname: ${f.lastName?.value}`);
  assert.ok(!f.firstName, `invented a forename: ${f.firstName?.value}`);
});

test("NAME GUARD a question asking for the name does not answer itself", () => {
  // "What is the surname on the policy?" once produced a patient called POLICY,
  // because the reader walked past "on the" looking for a word.
  const f = call(
    "Rep: Good morning, what is the surname on the policy for you today?",
    "Agent: Sorry, I will have to call you back about that member later.",
    "Rep: No problem at all, speak to you then, have a very good day.");
  assert.ok(!f.lastName, `read a surname out of a question: ${f.lastName?.value}`);
});

test("NAME GUARD a label with no name after it reads nothing", () => {
  const f = call(OPENING,
    "Rep: I will need the last name before I can look anything up here.",
    "Agent: Understood, let me find that for you and call you straight back.");
  assert.ok(!f.lastName, `read "${f.lastName?.value}" where no name was given`);
});

/* ---------------- grading a name against the call ---------------- */

test("NAME a wrong surname still fails the record", () => {
  // The guard the whole product rests on: a form that says ROBINSON when nobody
  // said ROBINSON is the worst failure available, and it has to keep failing.
  const t = "Rep: Thank you for calling, the last name is Yusuff, first name Tajudeen, and the plan is active.";
  assert.equal(checkTranscript({ lastName: "ROBINSON", firstName: "TAJUDEEN" }, t)
    .checks.find((c) => c.key === "lastName").status, "missing");
  assert.equal(checkTranscript({ lastName: "YUSUFF", firstName: "TAJUDEEN" }, t)
    .checks.find((c) => c.key === "lastName").status, "found");
});

test("NAME spoken order does not decide which field is which", () => {
  // Reps say it both ways. Grading matches the VALUE, so "Tajudeen Yusuff" and
  // "Yusuff, Tajudeen" confirm the same two fields — the position in the sentence
  // decides nothing. (A name still has to be spoken about the patient: "member"
  // is what tells the engine this sentence is about who the member is.)
  const t = "Rep: I have the member Tajudeen Yusuff on file and the coverage is active.";
  const r = checkTranscript({ lastName: "YUSUFF", firstName: "TAJUDEEN" }, t);
  assert.equal(r.checks.find((c) => c.key === "lastName").status, "found");
  assert.equal(r.checks.find((c) => c.key === "firstName").status, "found");
});

/* ---------------- a name arriving from a spreadsheet ---------------- */

test("NAME a comma in a sheet is authoritative", () => {
  assert.deepEqual(splitName("MOUSE, MICKIE"), { lastName: "MOUSE", firstName: "MICKIE", guessed: false });
  assert.deepEqual(splitName("Okonkwo,Adaeze"), { lastName: "OKONKWO", firstName: "ADAEZE", guessed: false });
});

test("NAME a sheet with no comma is read Last First, and says it guessed", () => {
  const n = splitName("MOUSE MICKIE");
  assert.deepEqual(n, { lastName: "MOUSE", firstName: "MICKIE", guessed: true });
  // The flag is the whole point — nothing else can tell the operator that the
  // sheet, not the app, was ambiguous.
  assert.ok(n.guessed);
});

test("NAME one word in a sheet is a surname", () => {
  assert.deepEqual(splitName("MOUSE"), { lastName: "MOUSE", firstName: "", guessed: true });
});

/* ---------------- and back out again ---------------- */

test("NAME everything downstream reads Last, First", () => {
  const v = { lastName: "Yusuff", firstName: "Tajudeen" };
  assert.equal(fullName(v), "YUSUFF, TAJUDEEN");
  // No trailing comma when half of it is missing.
  assert.equal(fullName({ lastName: "Yusuff", firstName: "" }), "YUSUFF");
  // Identity is keyed in the same order, so the key and the label agree.
  assert.match(patientKey({ ...v, dob: "1957-12-31" }), /^YUSUFF\|TAJUDEEN\|/);
});
