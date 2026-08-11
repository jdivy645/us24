import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboard } from "./dashboard.js";

const rec = (over = {}) => ({
  _id: "r" + Math.random().toString(36).slice(2),
  _status: "finished", _verdict: "APPROVED", _authRequired: "NO", _blankCount: 0,
  _errors: [], _qaName: "", _hasTranscript: true,
  projectName: "EC MARVEL", insName: "AETNA", username: "SP",
  requestMode: "CALL", requestDate: "2026-08-03", today: "2026-08-10",
  ...over,
});

test("an empty record set produces zeroes rather than NaN", () => {
  const d = buildDashboard([]);
  assert.equal(d.total, 0);
  assert.equal(d.authRequired, 0);
  assert.equal(d.findings, 0);
  // Null, not zero: "nothing has been checked" is not "everything failed".
  assert.equal(d.cleanRate, null);
  assert.equal(d.medianTurnaround, null);
  assert.deepEqual(d.byProject, []);
});

test("the project, insurance and operator breakdowns are biggest-first", () => {
  const d = buildDashboard([
    rec({ projectName: "A" }), rec({ projectName: "B" }), rec({ projectName: "B" }), rec({ projectName: "B" }),
    rec({ projectName: "A" }),
  ]);
  assert.deepEqual(d.byProject, [{ label: "B", count: 3 }, { label: "A", count: 2 }]);
});

test("a record with no project is counted, not dropped", () => {
  // Records from before projects existed, and anything imported. Hiding them makes
  // the dashboard total disagree with the records list, which is worse than a dash.
  const d = buildDashboard([rec({ projectName: "" }), rec({ projectName: "A" })]);
  assert.equal(d.total, 2);
  assert.ok(d.byProject.some((r) => r.label === "—" && r.count === 1));
});

test("authorization-required is counted from the stored flag", () => {
  const d = buildDashboard([rec({ _authRequired: "YES" }), rec({ _authRequired: "YES" }), rec()]);
  assert.equal(d.authRequired, 2);
});

test("QA findings are counted by priority, and a clean pass is not a finding", () => {
  const d = buildDashboard([
    rec({ _errors: [{ priority: "P1" }, { priority: "P3" }] }),
    rec({ _errors: [{ priority: "NONE" }] }),
    rec({ _errors: [] }),
  ]);
  assert.equal(d.byPriority.P1, 1);
  assert.equal(d.byPriority.P3, 1);
  assert.equal(d.byPriority.NONE, 1);
  assert.equal(d.findings, 2, "NONE rows must not inflate the finding count");
});

test("the clean rate is over what was checked, not over everything", () => {
  // Counting unchecked work as failed would make the quality figure a measure of
  // how far behind QA is.
  const d = buildDashboard([
    rec({ _errors: [{ priority: "NONE" }] }),
    rec({ _errors: [{ priority: "NONE" }] }),
    rec({ _errors: [{ priority: "P2" }] }),
    rec({ _errors: [] }),
    rec({ _errors: [] }),
  ]);
  assert.equal(d.checked, 3);
  assert.equal(d.cleanRate, 67);
});

test("turnaround is a median over records that have both dates", () => {
  const d = buildDashboard([
    rec({ requestDate: "2026-08-09", today: "2026-08-10" }),   // 1
    rec({ requestDate: "2026-08-05", today: "2026-08-10" }),   // 5
    rec({ requestDate: "2026-08-01", today: "2026-08-10" }),   // 9
    rec({ requestDate: "", today: "2026-08-10" }),             // ignored
  ]);
  assert.equal(d.medianTurnaround, 5);
});

test("a negative turnaround is left out rather than dragging the median down", () => {
  // A verification dated before its request is a typo, not a same-day miracle.
  const d = buildDashboard([
    rec({ requestDate: "2026-08-20", today: "2026-08-10" }),
    rec({ requestDate: "2026-08-06", today: "2026-08-10" }),
  ]);
  assert.equal(d.medianTurnaround, 4);
});

test("the date range filters on the verification date", () => {
  const rows = [rec({ today: "2026-07-01" }), rec({ today: "2026-08-10" }), rec({ today: "2026-09-01" })];
  assert.equal(buildDashboard(rows, { from: "2026-08-01" }).total, 2);
  assert.equal(buildDashboard(rows, { to: "2026-08-31" }).total, 2);
  assert.equal(buildDashboard(rows, { from: "2026-08-01", to: "2026-08-31" }).total, 1);
});

test("open and finished always add up to the total", () => {
  const d = buildDashboard([
    rec({ _status: "draft" }), rec({ _status: "submitted" }), rec({ _status: "in_qa" }),
    rec({ _status: "returned" }), rec({ _status: "finished" }),
  ]);
  assert.equal(d.open + d.finished, d.total);
  assert.equal(d.open, 4);
});

test("the QA breakdown only counts records that have actually been through QA", () => {
  const d = buildDashboard([rec({ _qaName: "QA1" }), rec({ _qaName: "QA1" }), rec({ _qaName: "" })]);
  assert.deepEqual(d.byQa, [{ label: "QA1", count: 2 }]);
});

test("insurance names are normalised so one payer is one row", () => {
  const d = buildDashboard([rec({ insName: "Aetna" }), rec({ insName: "AETNA" }), rec({ insName: " aetna " })]);
  assert.deepEqual(d.byInsurance, [{ label: "AETNA", count: 3 }]);
});
