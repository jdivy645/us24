import { historyTable, moneyVal } from "../lib/history.js";
import { fmtDate } from "../data/fields.js";

// One row per field that ever moved, one column per verification date.
//
// Only fields that changed appear. A table of fifty rows where forty-eight are
// identical hides the two figures the practice actually re-verifies for.

const Cell = ({ value, prev, kind }) => {
  if (kind !== "money" || !prev || value === prev) return <td>{value || "—"}</td>;
  const a = moneyVal(prev), b = moneyVal(value);
  const delta = a != null && b != null ? b - a : null;
  return (
    <td>
      {value || "—"}
      {delta != null && delta !== 0 && (
        <span className={"ch-delta " + (delta > 0 ? "up" : "down")}>
          {delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}
        </span>
      )}
    </td>
  );
};

export default function CaseHistory({ name, versions, onClose }) {
  const { dates, rows } = historyTable(versions);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <div>
            <h2>{name} — what changed</h2>
            <p>{versions.length} verification{versions.length > 1 ? "s" : ""} on this case. Only fields that moved are listed.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="card-body">
          {!rows.length ? (
            <p className="hint">Nothing has changed between these verifications.</p>
          ) : (
            <div className="tbl-wrap">
              <table className="ch-tbl">
                <thead>
                  <tr>
                    <th>Field</th>
                    {dates.map((d, i) => <th key={i}>{fmtDate(d) || `#${i + 1}`}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      {r.cells.map((c, i) => <Cell key={i} value={c} prev={i ? r.cells[i - 1] : null} kind={r.kind} />)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
