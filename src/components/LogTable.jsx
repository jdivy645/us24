import { dash, fmtDate } from "../data/fields.js";
import { recordCompleteness } from "../lib/completeness.js";
import { STATUS, PRIORITY_LABEL } from "../lib/workflow.js";

// Green means one thing: complete form, everything confirmed.
const verdictClass = (v, incomplete) =>
  v._verdict === "REJECTED" ? "bad"
    : v._verdict === "APPROVED" || v._verdict === "ATTESTED" ? (incomplete ? "warn" : "ok")
      : "na";

// Where a record is in the QA cycle, at a glance. Returned is the one that needs
// somebody to do something, so it reads as a warning rather than as neutral.
const statusClass = (s) =>
  s === "finished" ? "ok" : s === "returned" ? "bad" : s === "in_qa" || s === "submitted" ? "warn" : "na";

const priorityClass = (p) => (p === "P1" ? "bad" : p === "P2" || p === "P3" ? "warn" : p === "NONE" ? "ok" : "na");

// key: the row value to sort on. Kept beside the header so the two cannot drift.
const COLUMNS = [
  { key: "_savedAt", label: "Saved" },
  { key: "projectName", label: "Project" },
  { key: "lastName", label: "Patient" },
  { key: "dob", label: "DOB" },
  { key: "insName", label: "Insurance" },
  { key: "policyId", label: "Policy ID" },
  { key: "_status", label: "Status" },
  { key: "authStatus", label: "Auth" },
  { key: "_verdict", label: "Verdict" },
  { key: "_topPriority", label: "QA" },
  { key: "username", label: "By" },
];

const authClass = (s) => (s === "APPROVED" ? "ok" : s === "DENIED" ? "bad" : s === "PENDING" ? "warn" : "na");

export default function LogTable({ records, sort, dir, onSort, onOpen, onDelete, onTranscript, onAudio, onHistory, onQa, qaLabel = "Review" }) {
  if (!records.length) {
    return (
      <div className="empty">
        <h3>No records here</h3>
        <p>Saved verifications appear here and export straight to Excel.</p>
      </div>
    );
  }
  const arrow = (key) => (sort !== key ? "" : dir === "asc" ? " ▲" : " ▼");
  return (
    <table className="data">
      <thead>
        <tr>
          {COLUMNS.map((c) => (
            <th key={c.key}>
              {onSort
                ? <button type="button" className="th-sort" onClick={() => onSort(c.key)}>{c.label}{arrow(c.key)}</button>
                : c.label}
            </th>
          ))}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {records.map((v, i) => {
          const comp = recordCompleteness(v);
          return (
            <tr key={v._id || i}>
              <td>{v._savedAt || "—"}</td>
              <td>{dash(v.projectName)}</td>
              <td>
                <strong>{dash(v.lastName)}, {dash(v.firstName)}</strong>
                {/* Which verification of this case this is. A patient re-verified
                    monthly shows ×4 rather than four identical-looking rows. */}
                {v._versionCount > 1 && (
                  <span className="ver-chip" title={`Verification ${v._seq} of ${v._versionCount} for this case`}>
                    v{v._seq}/{v._versionCount}
                  </span>
                )}
              </td>
              <td>{dash(fmtDate(v.dob))}</td>
              <td>{dash(v.insName)}</td>
              <td>{dash(v.policyId)}</td>
              <td><span className={"pill " + statusClass(v._status)}>{STATUS[v._status] || "—"}</span></td>
              <td>
                {/* Blank where no authorization was ever needed — an empty cell says
                    "not applicable" more clearly than a word for it would. */}
                {v._authRequired === "YES"
                  ? <span className={"pill " + authClass(v.authStatus)}>{v.authStatus || "NOT SET"}</span>
                  : <span className="hint">—</span>}
              </td>
              <td>
                <div className="pill-row">
                  <span className={"pill " + verdictClass(v, comp.incomplete)}>{v._verdict || "NO TRANSCRIPT"}</span>
                  {v._verdict === "REJECTED" && <span className="hint">{v._matched}/{v._total}</span>}
                  {comp.incomplete && (
                    <span className="pill warn" title={comp.blank.join(", ")}>INCOMPLETE {comp.count}</span>
                  )}
                </div>
              </td>
              <td>
                {v._topPriority
                  ? <span className="pill-row">
                    <span className={"pill " + priorityClass(v._topPriority)} title={PRIORITY_LABEL[v._topPriority]}>
                      {v._topPriority}{v._errorCount > 1 ? ` ×${v._errorCount}` : ""}
                    </span>
                    {/* An open finding is work outstanding; a resolved one is history. */}
                    {v._openCount > 0 && <span className="pill warn" title="Findings not yet marked fixed">{v._openCount} open</span>}
                    {v._score !== null && v._score !== undefined && <span className="hint">{v._score}</span>}
                  </span>
                  : <span className="hint">—</span>}
              </td>
              <td>{dash(v.username || v.verifiedBy)}{v._qaName ? <span className="hint"> · QA {v._qaName}</span> : null}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {onQa && <><button className="btn btn-dark btn-sm" onClick={() => onQa(i)}>{qaLabel}</button>{" "}</>}
                {(v._hasTranscript || v._transcript) && <><button className="btn btn-ghost btn-sm" onClick={() => onTranscript(i)}>Transcript</button>{" "}</>}
                {v._versionCount > 1 && <><button className="btn btn-ghost btn-sm" onClick={() => onHistory(i)}>History</button>{" "}</>}
                {v._audioFile && onAudio && <><button className="btn btn-ghost btn-sm" onClick={() => onAudio(i)}>Audio</button>{" "}</>}
                {onOpen && <><button className="btn btn-ghost btn-sm" onClick={() => onOpen(i)}>Re-verify</button>{" "}</>}
                {onDelete && <button className="btn btn-ghost btn-sm" onClick={() => onDelete(i)}>Delete</button>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
