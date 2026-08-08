import { dash, fmtDate } from "../data/fields.js";
import { recordCompleteness } from "../lib/completeness.js";

// Green means one thing: complete form, everything confirmed.
const verdictClass = (v, incomplete) =>
  v._verdict === "REJECTED" ? "bad"
    : v._verdict === "APPROVED" ? (incomplete ? "warn" : "ok")
      : "na";

export default function LogTable({ records, onOpen, onDelete, onTranscript, onAudio, onHistory }) {
  if (!records.length) {
    return (
      <div className="empty">
        <h3>No records yet</h3>
        <p>Saved verifications appear here and export straight to Excel.</p>
      </div>
    );
  }
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Saved</th><th>Patient</th><th>DOB</th><th>Insurance</th><th>Policy ID</th>
          <th>Service</th><th>Network</th><th>Verdict</th><th>Rep</th><th>Call ref</th><th></th>
        </tr>
      </thead>
      <tbody>
        {records.map((v, i) => {
          const comp = recordCompleteness(v);
          return (
            <tr key={v._id || i}>
              <td>{v._savedAt || "—"}</td>
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
              <td>{dash(v.serviceType)}</td>
              <td><span className={"pill " + (v.network === "IN NETWORK" ? "ok" : "warn")}>{dash(v.network)}</span></td>
              <td>
                <div className="pill-row">
                  <span className={"pill " + verdictClass(v, comp.incomplete)}>{v._verdict || "NO TRANSCRIPT"}</span>
                  {v._verdict === "REJECTED" && <span className="hint">{v._matched}/{v._total}</span>}
                  {comp.incomplete && (
                    <span className="pill warn" title={comp.blank.join(", ")}>INCOMPLETE {comp.count}</span>
                  )}
                </div>
              </td>
              <td>{dash(v.repName)}</td>
              <td>{dash(v.callRef)}</td>
              <td style={{ textAlign: "right" }}>
                {(v._hasTranscript || v._transcript) && <button className="btn btn-ghost btn-sm" onClick={() => onTranscript(i)}>Transcript</button>}{" "}
                {v._versionCount > 1 && <button className="btn btn-ghost btn-sm" onClick={() => onHistory(i)}>History</button>}{" "}
                {v._audioFile && <button className="btn btn-ghost btn-sm" onClick={() => onAudio(i)}>Audio</button>}{" "}
                <button className="btn btn-ghost btn-sm" onClick={() => onOpen(i)}>Re-verify</button>{" "}
                <button className="btn btn-ghost btn-sm" onClick={() => onDelete(i)}>Delete</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
