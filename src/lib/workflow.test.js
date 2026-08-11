import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS, OPEN_STATUSES, PRIORITIES, TRANSITIONS,
  refusal, can, actionsFor, newWorkflow, applyTransition, topPriority, errorCount,
} from "./workflow.js";

const P1 = { priority: "P1", note: "wrong member id" };
const NONE = { priority: "NONE", note: "checked, nothing found" };

/* ---------------- the shape of the machine ---------------- */

test("every transition lands on a real status", () => {
  for (const [action, t] of Object.entries(TRANSITIONS)) {
    assert.ok(STATUS[t.to], `${action} goes to "${t.to}", which is not a status`);
    for (const f of t.from) assert.ok(STATUS[f], `${action} comes from "${f}", which is not a status`);
  }
});

test("finished is the only status nobody is waiting on", () => {
  for (const s of Object.keys(STATUS)) {
    assert.equal(OPEN_STATUSES.includes(s), s !== "finished", `"${s}" is on the wrong side of the open/closed line`);
  }
});

/* ---------------- who may do what ---------------- */

test("an operator cannot QA their own record", () => {
  // The whole reason this gate is separate from the pre-save review: the person who
  // made a mistake must not be the only person who ever looks for it.
  assert.ok(!can("pass", { status: "submitted", role: "agent" }));
  assert.ok(!can("return", { status: "submitted", role: "agent", errors: [P1] }));
  assert.ok(can("pass", { status: "submitted", role: "qa" }));
});

test("QA cannot send a record back with no reason recorded", () => {
  const none = refusal("return", { status: "in_qa", role: "qa", errors: [] });
  assert.match(none, /P1, P2 or P3/);
  // A clean pass is a finding too, but it is not a reason to return anything.
  assert.ok(refusal("return", { status: "in_qa", role: "qa", errors: [NONE] }));
  assert.equal(refusal("return", { status: "in_qa", role: "qa", errors: [P1] }), null);
});

test("a record with unresolved fields cannot be handed to QA", () => {
  assert.match(refusal("submit", { status: "draft", blocking: 3 }), /3 fields/);
  assert.match(refusal("submit", { status: "draft", incomplete: true }), /required field/);
  assert.equal(refusal("submit", { status: "draft" }), null);
});

test("a finished record can only be reopened, and only by an admin", () => {
  assert.deepEqual(actionsFor("finished", "qa"), []);
  assert.deepEqual(actionsFor("finished", "agent"), []);
  assert.deepEqual(actionsFor("finished", "admin"), ["reopen"]);
});

test("a returned record goes back to the operator, not to QA", () => {
  assert.deepEqual(actionsFor("returned", "agent"), ["submit"]);
  assert.deepEqual(actionsFor("returned", "qa"), []);
});

test("an unknown action is refused rather than silently ignored", () => {
  assert.match(refusal("delete", { status: "draft", role: "admin" }), /Unknown action/);
  assert.throws(() => applyTransition(newWorkflow(), "delete"), /Unknown action/);
});

/* ---------------- what a transition records ---------------- */

test("a transition never loses the trail behind it", () => {
  let w = newWorkflow({ status: "draft", username: "SP", at: "2026-08-10T09:00:00Z" });
  w = applyTransition(w, "submit", { by: "SP", at: "2026-08-10T10:00:00Z" });
  w = applyTransition(w, "pickUp", { by: "QA1", at: "2026-08-10T11:00:00Z" });
  w = applyTransition(w, "return", { by: "QA1", at: "2026-08-10T12:00:00Z", note: "policy id" });

  assert.equal(w.status, "returned");
  assert.equal(w.qaName, "QA1");
  assert.equal(w.username, "SP", "the operator is not overwritten by the checker");
  assert.deepEqual(w.history.map((h) => h.to), ["draft", "submitted", "in_qa", "returned"]);
  assert.equal(w.history.at(-1).note, "policy id");
});

test("a round trip does not move the timestamps of the first pass", () => {
  // "When did this first reach QA" is a question about the record's age, and a
  // return-and-resubmit must not reset it.
  let w = newWorkflow({ status: "draft", username: "SP", at: "2026-08-10T09:00:00Z" });
  w = applyTransition(w, "submit", { by: "SP", at: "2026-08-10T10:00:00Z" });
  w = applyTransition(w, "pickUp", { by: "QA1", at: "2026-08-10T11:00:00Z" });
  w = applyTransition(w, "return", { by: "QA1", at: "2026-08-10T12:00:00Z" });
  w = applyTransition(w, "submit", { by: "SP", at: "2026-08-11T09:00:00Z" });
  w = applyTransition(w, "pickUp", { by: "QA1", at: "2026-08-11T10:00:00Z" });

  assert.equal(w.submittedAt, "2026-08-10T10:00:00Z");
  assert.equal(w.qaAt, "2026-08-10T11:00:00Z");
  // The opening "draft" entry plus the five transitions above.
  assert.equal(w.history.length, 6);
  assert.deepEqual(w.history.map((h) => h.to),
    ["draft", "submitted", "in_qa", "returned", "submitted", "in_qa"]);
});

test("reopening a finished record clears the finish stamp", () => {
  // A dashboard counting finishedAt would otherwise count a record that is back in
  // the queue.
  let w = newWorkflow({ status: "submitted", username: "SP" });
  w = applyTransition(w, "pass", { by: "QA1", at: "2026-08-10T12:00:00Z" });
  assert.equal(w.finishedAt, "2026-08-10T12:00:00Z");
  w = applyTransition(w, "reopen", { by: "BOSS", at: "2026-08-12T09:00:00Z" });
  assert.equal(w.status, "in_qa");
  assert.equal(w.finishedAt, "");
});

test("applyTransition returns a new object rather than editing the old one", () => {
  const before = newWorkflow({ status: "draft", username: "SP" });
  const frozen = JSON.stringify(before);
  applyTransition(before, "submit", { by: "SP" });
  assert.equal(JSON.stringify(before), frozen);
});

/* ---------------- reading a pile of findings ---------------- */

test("the worst finding is what a queue is sorted by", () => {
  assert.equal(topPriority([{ priority: "P3" }, { priority: "P1" }, { priority: "P2" }]), "P1");
  assert.equal(topPriority([{ priority: "P3" }, { priority: "P2" }]), "P2");
});

test("checked-and-clean is told apart from never-checked", () => {
  // An empty list means nobody has looked. A NONE row means somebody looked and
  // found nothing — the two must never render the same.
  assert.equal(topPriority([]), "");
  assert.equal(topPriority([{ priority: "NONE" }]), "NONE");
  assert.equal(errorCount([{ priority: "NONE" }]), 0);
  assert.equal(errorCount([{ priority: "NONE" }, { priority: "P2" }]), 1);
});

test("every priority the UI offers is one topPriority can rank", () => {
  for (const p of PRIORITIES) {
    assert.equal(topPriority([{ priority: p }]), p, `topPriority cannot rank "${p}"`);
  }
});
