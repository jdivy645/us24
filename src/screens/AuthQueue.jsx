import { useMemo, useState } from "react";
import { OPEN_STATUSES, STATUS } from "../lib/workflow.js";
import LogTable from "../components/LogTable.jsx";
import RecordFilters from "../components/RecordFilters.jsx";
import QaReview from "../components/QaReview.jsx";
import AuthPanel from "../components/AuthPanel.jsx";

// Everything waiting on somebody, in the order the work actually flows — which
// starts, as the client starts, at "is an authorization required?".
//
// Sorted oldest-first, the opposite of the records list: a queue is worked from the
// bottom of the pile, and putting the newest arrival on top is how the oldest
// record quietly ages out of sight.
const LANES = [
  { key: "auth_pending", hint: "Authorization required — chase it, then send it on" },
  { key: "submitted", hint: "Waiting for someone to pick up" },
  { key: "in_qa", hint: "Being checked now" },
  { key: "returned", hint: "Sent back to the operator to correct" },
  { key: "draft", hint: "Saved but never submitted" },
];

export default function WorkQueue({ records, projects, currentUser, toast, onReload, onCorrect }) {
  const [filters, setFilters] = useState({ sort: "_savedAt", dir: "asc" });
  const [lane, setLane] = useState("auth_pending");
  const [openId, setOpenId] = useState(null);

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

  // Looked up again from the freshly loaded list rather than held in state, so
  // logging a finding or saving an authorization updates the panel behind the modal.
  const open = openId ? records.find((r) => r._id === openId) : null;

  // A returned record is the operator's to fix, and fixing happens on the form —
  // not in a review modal. Everything else opens where it is worked.
  const openRow = (i) => {
    const r = rows[i];
    if (r._status === "returned") { onCorrect(r); return; }
    setOpenId(r._id);
  };

  const actionLabel = lane === "auth_pending" ? "Authorization" : lane === "returned" ? "Correct" : "Review";

  return (
    <div className="wrap">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Work queue</h2>
            <p>
              {lane === "auth_pending"
                ? "These need an authorization before anyone checks them."
                : currentUser?.role === "qa" || currentUser?.role === "admin"
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
          <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
            {LANES.find((l) => l.key === lane)?.hint}
          </p>
        </div>

        <div className="tbl-wrap">
          <LogTable
            records={rows}
            sort={filters.sort}
            dir={filters.dir}
            onSort={onSort}
            onQa={openRow}
            qaLabel={actionLabel}
            onTranscript={openRow}
            onHistory={openRow}
          />
        </div>
      </div>

      {open && open._status === "auth_pending" && (
        <AuthPanel
          record={open}
          currentUser={currentUser}
          toast={toast}
          onChanged={onReload}
          onClose={() => setOpenId(null)}
        />
      )}

      {open && open._status !== "auth_pending" && (
        <QaReview
          record={open}
          currentUser={currentUser}
          toast={toast}
          onChanged={onReload}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
