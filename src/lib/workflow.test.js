import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS, OPEN_STATUSES, PRIORITIES, TRANSITIONS,
  refusal, can, actionsFor, newWorkflow, applyTransition, topPriority, errorCount,
  targetOf, unresolved, pointsOf, recordScore, ERROR_POINTS, ERROR_CATEGORIES,
} from "./workflow.js";

const P1 = { priority: "P1", note: "wrong member id" };
const NONE = { priority: "NONE", note: "checked, nothing found" };

/* ---------------- the shape of the machine ---------------- */

test("every transition lands on a real status, on every route it can take", () => {
  for (const [action, t] of Object.entries(TRANSITIONS)) {
    for (const ctx of [{ needsAuthWork: true }, { needsAuthWork: false }]) {
      const to = targetOf(action, ctx);
      assert.ok(STATUS[to], `${action} goes to "${to}", which is not a status`);
    }
    for (const f of t.from) assert.ok(STATUS[f], `${action} comes from "${f}", which is not a status`);
  }
});

test("finished is the only status nobody is waiting on", () => {
  for (const s of Object.keys(STATUS)) {
    assert.equal(OPEN_STATUSES.includes(s), s !== "finished", `"${s}" is on the wrong side of the open/closed line`);
  }
});

/* ---------------- the authorization fork ---------------- */

test("the pipeline forks on the authorization answer", () => {
  // The client's own starting question: "authorization required — yes or no?"
  assert.equal(targetOf("submit", { needsAuthWork: true }), "auth_pending");
  assert.equal(targetOf("submit", { needsAuthWork: false }), "submitted");
});

test("a record whose authorization is already in hand does not go round again", () => {
  // The failure this prevents: QA returns a record for an unrelated typo, the
  // operator fixes it, and the app sends it back to the authorization queue for an
  // authorization that was obtained last week.
  let w = newWorkflow({ status: "returned", username: "SP" });
  w = applyTransition(w, "submit", { by: "SP", needsAuthWork: false });
  assert.equal(w.status, "submitted");
});

test("the authorization stage will not release a record with nothing to show for it", () => {
  const ctx = { status: "auth_pending", role: "agent" };
  assert.match(refusal("authDone", { ...ctx, authOutcome: "" }), /what the payer came back with/);
  assert.match(refusal("authDone", { ...ctx, authOutcome: "PENDING" }), /what the payer came back with/);
  assert.equal(refusal("authDone", { ...ctx, authOutcome: "APPROVED" }), null);
  // A denial is an answer. A record that cannot move on when the payer says no is a
  // record that sits in the queue forever.
  assert.equal(refusal("authDone", { ...ctx, authOutcome: "DENIED" }), null);
});

test("obtaining the authorization is the operator's job, not the checker's", () => {
  assert.ok(can("authDone", { status: "auth_pending", role: "agent", authOutcome: "APPROVED" }));
  assert.ok(can("authDone", { status: "auth_pending", role: "qa", authOutcome: "APPROVED" }));
  // …and it is the only thing you can do to a record sitting in that queue.
  assert.deepEqual(actionsFor("auth_pending", "agent"), ["authDone"]);
});

test("a record in the authorization queue is still open work", () => {
  assert.ok(OPEN_STATUSES.includes("auth_pending"));
  assert.equal(STATUS.auth_pending, "Authorization");
});

/* ---------------- the correction loop ---------------- */

test("a returned record cannot go back to QA with its findings still open", () => {
  const open = { priority: "P2", note: "policy id", resolvedAt: "" };
  const fixed = { priority: "P2", note: "policy id", resolvedAt: "2026-08-11T10:00:00Z" };
  assert.match(refusal("submit", { status: "returned", errors: [open] }), /still open/);
  assert.equal(refusal("submit", { status: "returned", errors: [fixed] }), null);
});

test("a clean-pass row is never something to fix", () => {
  // NONE means "checked, found nothing". Treating it as an open finding would make
  // a passed record impossible to resubmit.
  assert.deepEqual(unresolved([{ priority: "NONE", resolvedAt: "" }]), []);
  assert.equal(refusal("submit", { status: "returned", errors: [{ priority: "NONE", resolvedAt: "" }] }), null);
});

test("the open-findings gate applies to returned records only", () => {
  // A draft has never been to QA, so it has nothing to resolve — the gate must not
  // catch it on the way out.
  assert.equal(refusal("submit", { status: "draft", errors: [{ priority: "P1", resolvedAt: "" }] }), null);
});

/* ---------------- points and score ---------------- */

test("a record starts at 100 and loses points for what was found on it", () => {
  assert.equal(recordScore([]), 100);
  assert.equal(recordScore([{ priority: "NONE" }]), 100);
  assert.equal(recordScore([{ priority: "P3" }]), 100 - ERROR_POINTS.P3);
  assert.equal(recordScore([{ priority: "P1" }, { priority: "P2" }]), 100 - ERROR_POINTS.P1 - ERROR_POINTS.P2);
});

test("a score never goes below zero", () => {
  // A negative number in a quality column reads as a bug, and says nothing a zero
  // does not already say.
  assert.equal(recordScore(Array.from({ length: 10 }, () => ({ priority: "P1" }))), 0);
});

test("fixing a finding does not erase it from the score", () => {
  // Otherwise the score measures diligence at correcting rather than accuracy at
  // doing, and a team that fixes everything looks flawless.
  const fixed = [{ priority: "P1", resolvedAt: "2026-08-11T10:00:00Z" }];
  assert.equal(recordScore(fixed), 100 - ERROR_POINTS.P1);
  assert.equal(pointsOf(fixed), ERROR_POINTS.P1);
});

test("every priority carries a weight and every category has a name", () => {
  for (const p of PRIORITIES) assert.equal(typeof ERROR_POINTS[p], "number", `${p} has no weight`);
  for (const [k, label] of Object.entries(ERROR_CATEGORIES)) assert.ok(label && label !== k, `${k} has no readable name`);
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
