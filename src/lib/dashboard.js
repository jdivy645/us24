// The counts a manager asked for on the requirements call: project-wise, QA-wise,
// insurance-wise, how many need an authorization, and what QA has been finding.
//
// A pure function of the record rows, so it can be tested without a browser and
// without a database — the same reason excelSheets.js is shaped this way.
import { OPEN_STATUSES } from "./workflow.js";
import { turnaroundDays } from "./flags.js";

const up = (s) => String(s || "").trim().toUpperCase();

// Counts by some key, biggest first, with an explicit bucket for "not recorded".
// Sorting by size rather than by name is the whole point of these lists: the answer
// to "where is the work" is the first row.
function tally(rows, keyOf, { blank = "—", limit = 0 } = {}) {
  const counts = new Map();
  for (const r of rows) {
    const k = String(keyOf(r) || "").trim() || blank;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return limit ? out.slice(0, limit) : out;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function buildDashboard(records, { from = "", to = "" } = {}) {
  const rows = records
    .filter((r) => !from || String(r.today || "") >= from)
    .filter((r) => !to || String(r.today || "") <= to);

  const byStatus = {};
  for (const r of rows) byStatus[r._status || "finished"] = (byStatus[r._status || "finished"] || 0) + 1;

  const byVerdict = {};
  for (const r of rows) byVerdict[r._verdict || "NO TRANSCRIPT"] = (byVerdict[r._verdict || "NO TRANSCRIPT"] || 0) + 1;

  const byPriority = { P1: 0, P2: 0, P3: 0, NONE: 0 };
  let findings = 0;
  for (const r of rows) {
    for (const e of r._errors || []) {
      if (byPriority[e.priority] === undefined) continue;
      byPriority[e.priority] += 1;
      if (e.priority !== "NONE") findings += 1;
    }
  }

  const turnarounds = rows.map(turnaroundDays).filter((d) => d !== null && d >= 0);

  // A record is "checked" once QA has passed or returned it. Draft and submitted
  // records are not failures, they are work in progress, and counting them as
  // unchecked would make the quality figure a measure of backlog instead.
  const checked = rows.filter((r) => (r._errors || []).length > 0);
  const clean = checked.filter((r) => !(r._errors || []).some((e) => e.priority !== "NONE"));

  return {
    total: rows.length,
    open: rows.filter((r) => OPEN_STATUSES.includes(r._status)).length,
    finished: byStatus.finished || 0,
    authRequired: rows.filter((r) => r._authRequired === "YES").length,
    incomplete: rows.filter((r) => (r._blankCount || 0) > 0).length,
    withTranscript: rows.filter((r) => r._hasTranscript || r._transcript).length,
    byStatus,
    byVerdict,
    byPriority,
    findings,
    checked: checked.length,
    cleanRate: checked.length ? Math.round((clean.length / checked.length) * 100) : null,
    medianTurnaround: median(turnarounds),
    byProject: tally(rows, (r) => r.projectName),
    byOperator: tally(rows, (r) => r.username || r.verifiedBy),
    byQa: tally(rows.filter((r) => r._qaName), (r) => r._qaName),
    byInsurance: tally(rows, (r) => up(r.insName), { limit: 12 }),
    byRequestMode: tally(rows, (r) => up(r.requestMode) || "CALL"),
  };
}
