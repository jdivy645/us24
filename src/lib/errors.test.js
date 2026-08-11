import test from "node:test";
import assert from "node:assert/strict";
import { fieldStates, reviewGroups, blockingCount, KIND_LABEL } from "./fieldState.js";
import { checkCompleteness } from "./completeness.js";
import { checkTranscript } from "./verify.js";
import { needsAuthWork, authObtained, recordFlags } from "./flags.js";
import { setBypass } from "./bypass.js";
import { ERROR_CATEGORIES } from "./workflow.js";
import { buildSheets } from "./excelSheets.js";
import { sampleForm, HEAD } from "../data/fields.js";

// The state a form is in while an operator is correcting a returned record.
const statesFor = (v, errors, meta = {}) =>
  fieldStates(v, meta, checkTranscript(v, "", meta), checkCompleteness(v, meta), { errors });

const finding = (over = {}) => ({
  id: "e1", priority: "P2", category: "WRONG_DATA", fieldKey: "policyId",
  note: "member id is one digit out", by: "QA1", at: "2026-08-11T09:00:00Z", resolvedAt: "", ...over,
});

/* ---------------- QA's finding lands on the field ---------------- */

test("a finding against a field puts the note on that field", () => {
  const s = statesFor(sampleForm(), [finding()]).get("policyId");
  assert.equal(s.kind, "flagged");
  assert.equal(s.detail, "member id is one digit out");
  assert.equal(s.priority, "P2");
  assert.equal(s.raisedBy, "QA1");
  assert.ok(s.blocking, "a flagged field must stop the record going back to QA untouched");
});

test("a flagged field outranks whatever the engine thinks of it", () => {
  // The checker has looked at this exact box and said it is wrong. Nothing the
  // matcher has to say about it is more important than that.
  const v = { ...sampleForm(), policyId: "" };
  const s = statesFor(v, [finding()]).get("policyId");
  assert.equal(s.kind, "flagged", "not 'required', even though it is also blank");
});

test("a finding about the record as a whole does not land on any field", () => {
  // No fieldKey means "wrong patient", "wrong project" — it belongs on the review
  // panel, and hanging it on an arbitrary box would be a lie about where to look.
  const states = statesFor(sampleForm(), [finding({ fieldKey: "" })]);
  assert.equal([...states.values()].filter((s) => s.kind === "flagged").length, 0);
});

test("a fixed finding stops flagging its field", () => {
  const fixed = finding({ resolvedAt: "2026-08-11T10:00:00Z" });
  assert.notEqual(statesFor(sampleForm(), [fixed]).get("policyId").kind, "flagged");
});

test("a clean-pass row never flags anything", () => {
  const none = finding({ priority: "NONE", fieldKey: "policyId", note: "checked" });
  assert.notEqual(statesFor(sampleForm(), [none]).get("policyId").kind, "flagged");
});

test("no findings behaves exactly as it did before the correction loop existed", () => {
  const v = sampleForm();
  const withArg = fieldStates(v, {}, checkTranscript(v, "", {}), checkCompleteness(v, {}), { errors: [] });
  const without = fieldStates(v, {}, checkTranscript(v, "", {}), checkCompleteness(v, {}));
  assert.deepEqual([...withArg.values()].map((s) => s.kind), [...without.values()].map((s) => s.kind));
});

/* ---------------- the review gate leads with them ---------------- */

test("what QA sent back is the first thing the review gate shows", () => {
  const groups = reviewGroups(statesFor({ ...sampleForm(), policyId: "" }, [finding()]));
  assert.equal(groups[0].id, "flagged");
  assert.equal(groups[0].items.length, 1);
  // …and it is not counted twice by also appearing under "must fix".
  const fix = groups.find((g) => g.id === "fix");
  assert.ok(!fix || !fix.items.some((s) => s.key === "policyId"));
});

test("an open finding is counted as blocking, a fixed one is not", () => {
  const v = sampleForm();
  assert.equal(blockingCount(statesFor(v, [finding()])), 1);
  assert.equal(blockingCount(statesFor(v, [finding({ resolvedAt: "2026-08-11T10:00:00Z" })])), 0);
});

test("the new state has a sentence, like every other one", () => {
  assert.ok(KIND_LABEL.flagged, "a state with no label renders as an empty strip");
});

/* ---------------- the authorization routing predicate ---------------- */

test("a record needs authorization work only while the answer is outstanding", () => {
  const needs = { authEval: "YES", authTx: "NO" };
  assert.ok(recordFlags(needs).authRequired);
  assert.ok(needsAuthWork(needs, {}));

  // Any of these is an answer, and an answered record must not go round again.
  assert.ok(!needsAuthWork({ ...needs, authStatus: "APPROVED" }, {}));
  assert.ok(!needsAuthWork({ ...needs, authStatus: "DENIED" }, {}));
  assert.ok(!needsAuthWork({ ...needs, authNum: "A12345" }, {}));
  // …still outstanding while the payer has not come back.
  assert.ok(needsAuthWork({ ...needs, authStatus: "PENDING" }, {}));
});

test("a record that never needed an authorization never enters that queue", () => {
  assert.ok(!needsAuthWork({ authEval: "NO", authTx: "NO" }, {}));
  assert.ok(!needsAuthWork({}, {}));
});

test("marking the authorization number N/A is an answer too", () => {
  // The operator saying "there is nothing to chase here" has to be able to release
  // the record, or a mis-set auth flag strands it in the queue.
  const v = { authEval: "YES" };
  assert.ok(needsAuthWork(v, {}));
  const meta = setBypass({}, "authNum", "NOT_APPLICABLE", "no auth needed after all", "SP");
  assert.ok(authObtained(v, meta));
  assert.ok(!needsAuthWork(v, meta));
});

/* ---------------- the export carries it ---------------- */

test("the error log exports one countable row per finding, with points and category", () => {
  const sheets = buildSheets([{
    _id: "v1", projectName: "EC MARVEL", lastName: "MOUSE", firstName: "MICKIE", username: "SP",
    _errors: [finding({ priority: "P1", category: "MISSING", against: "SP" })],
  }]);
  const row = sheets.find((s) => s.name === "Error Log").rows[0];
  assert.equal(row.Priority, "P1");
  assert.equal(row.Points, 25);
  assert.equal(row.Category, ERROR_CATEGORIES.MISSING);
  assert.equal(row.Field, HEAD.policyId);
  assert.equal(row["Raised Against"], "SP");
});

test("the authorization sheet carries the outcome, not just whether one was needed", () => {
  const sheets = buildSheets([{ _id: "v1", lastName: "MOUSE", _authRequired: "YES", authStatus: "DENIED" }]);
  const row = sheets.find((s) => s.name === "Authorization").rows[0];
  assert.equal(row[HEAD._authRequired], "YES");
  assert.equal(row[HEAD.authStatus], "DENIED");
});
