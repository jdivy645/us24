import { useMemo, useState } from "react";
import { OPEN_STATUSES, STATUS } from "../lib/workflow.js";
import LogTable from "../components/LogTable.jsx";
import RecordFilters from "../components/RecordFilters.jsx";
import QaReview from "../components/QaReview.jsx";

// The work waiting on somebody, oldest first.
//
// Sorted the opposite way to the records list on purpose: a queue is worked from
// the bottom of the pile, and showing the newest arrival at the top is how the
// oldest record quietly ages out of sight.
const LANES = [
  { key: "submitted", hint: "Waiting for someone to pick up" },
  { key: "in_qa", hint: "Being checked now" },
  { key: "returned", hint: "Sent back to the operator" },
  { key: "draft", hint: "Saved but never submitted" },
];

export default function QaQueue({ records, projects, currentUser, toast, onReload }) {
  const [filters, setFilters] = useState({ sort: "_savedAt", dir: "asc" });
  const [lane, setLane] = useState("submitted");
  const [reviewing, setReviewing] = useState(null);

  const counts = useMemo(() => {
    const out = {};
    for (const s of OPEN_STATUSES) out[s] = 0;
    for (const r of records) if (out[r._status] !== undefined) out[r._status] += 1;
    return out;
  }, [records]);

  const rows = useMemo(() => {
    const q = String(filters.q || "").trim().toLowerCase();
    const out = records
      .filter((r) => r._status === lane)
      .filter((r) => !filters.projectName || r.projectName === filters.projectName)
      .filter((r) => !filters.priority || r._topPriority === filters.priority)
      .filter((r) => !q || [r.lastName, r.firstName, r.policyId, r.insName, r.projectName, r.username]
        .some((x) => String(x || "").toLowerCase().includes(q)));
    const { sort = "_savedAt", dir = "asc" } = filters;
    const sign = dir === "asc" ? 1 : -1;
    return out.sort((a, b) => sign * String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), undefined, { numeric: true }));
  }, [records, filters, lane]);

  const onSort = (key) =>
    setFilters((f) => ({ ...f, sort: key, dir: f.sort === key && f.dir === "asc" ? "desc" : "asc" }));

  // The reviewed record is looked up again from the freshly loaded list rather than
  // held in state, so logging a finding updates the panel behind the modal too.
  const open = reviewing ? records.find((r) => r._id === reviewing) : null;

  return (
    <div className="wrap">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>QA queue</h2>
            <p>
              {currentUser?.role === "qa" || currentUser?.role === "admin"
                ? "Check a record against its call, log what is wrong, then pass or return it."
                : "You are signed in as an operator — switch to a QA user to pass or return records."}
            </p>
          </div>
        </div>

        <div className="subtabs">
          {LANES.map((l) => (
            <button key={l.key} className={"subtab" + (lane === l.key ? " active" : "")} onClick={() => setLane(l.key)} title={l.hint}>
              {STATUS[l.key]} <span className="count">{counts[l.key] || 0}</span>
            </button>
          ))}
        </div>

        <div className="card-body" style={{ paddingBottom: 0 }}>
          <RecordFilters
            value={filters}
            onChange={setFilters}
            projects={projects}
            hide={["status", "verdict", "from", "to"]}
            total={counts[lane] || 0}
            shown={rows.length}
          />
        </div>

        <div className="tbl-wrap">
          <LogTable
            records={rows}
            sort={filters.sort}
            dir={filters.dir}
            onSort={onSort}
            onQa={(i) => setReviewing(rows[i]._id)}
            onTranscript={(i) => setReviewing(rows[i]._id)}
            onHistory={(i) => setReviewing(rows[i]._id)}
          />
        </div>
      </div>

      {open && (
        <QaReview
          record={open}
          currentUser={currentUser}
          toast={toast}
          onChanged={onReload}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
