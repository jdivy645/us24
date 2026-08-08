import { useState } from "react";
import { readWorkbook } from "../lib/xlsxRead.js";
import { detectHeaderRow, mapHeaders, mapOwnExport, parseRows, detectKind, HEADER_SYNONYMS } from "../lib/importMap.js";
import { HEAD } from "../data/fields.js";

// Import a patient roster or carrier list from a spreadsheet.
//
// Nothing is written until the operator has seen what was read. Column mapping is
// a guess — a good one, but a guess — and a silently mis-mapped column is worse
// than no import at all.

const FIELD_CHOICES = Object.keys(HEADER_SYNONYMS);
const ACTION_PILL = { import: "ok", warn: "warn", conflict: "warn", skip: "na" };

export default function ImportPanel({ existingKeys, onApply, onClose }) {
  const [book, setBook] = useState(null);
  const [sheet, setSheet] = useState("");
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState({});
  const [unmapped, setUnmapped] = useState([]);
  const [kind, setKind] = useState("patients");
  const [error, setError] = useState("");

  const load = async (file) => {
    setError("");
    try {
      const wb = await readWorkbook(file);
      const first = wb.sheetNames[0];
      setBook(wb);
      pickSheet(wb, first);
    } catch (e) {
      setError("Could not read that file: " + (e?.message || e));
    }
  };

  const pickSheet = (wb, name) => {
    setSheet(name);
    const grid = wb.sheets[name].raw;
    const hr = detectHeaderRow(grid);
    setHeaderRow(hr);
    const headers = grid[hr] || [];
    // Our own exported log is the likeliest thing to be re-imported, so try that
    // first — its headers are exact and need no fuzzy matching.
    const own = mapOwnExport(headers);
    const fuzzy = mapHeaders(headers);
    const use = Object.keys(own).length >= 4 ? { mapping: own, unmapped: [] } : fuzzy;
    setMapping(use.mapping);
    setUnmapped(use.unmapped);
    setKind(detectKind(use.mapping));
  };

  const grid = book && sheet ? book.sheets[sheet] : null;
  const headers = grid ? grid.raw[headerRow] || [] : [];
  const rows = grid ? parseRows({ raw: grid.raw, formatted: grid.formatted, headerRow, mapping, kind, existingKeys }) : [];
  const usable = rows.filter((r) => r.action !== "skip");
  const counts = rows.reduce((a, r) => ({ ...a, [r.action]: (a[r.action] || 0) + 1 }), {});

  const setCol = (key, index) => setMapping((m) => {
    const next = { ...m };
    for (const [k, v] of Object.entries(next)) if (v === index && k !== key) delete next[k];
    if (index === "") delete next[key]; else next[key] = Number(index);
    return next;
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <div>
            <h2>Import from a spreadsheet</h2>
            <p>Patients or carriers. Nothing is saved until you confirm what was read.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="card-body">
          {!book && (
            <div className="drop">
              <div className="rec-bar">
                <label className="btn btn-dark btn-sm">
                  Choose a file
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) load(f); }} />
                </label>
                <span className="hint">.xlsx, .xls or .csv — the file is read in this browser and goes nowhere else.</span>
              </div>
            </div>
          )}
          {error && <p className="hint bad">{error}</p>}

          {book && (
            <>
              <div className="ps-row">
                <span className="ps-k">Sheet</span>
                <select value={sheet} onChange={(e) => pickSheet(book, e.target.value)} className="rg-sel">
                  {book.sheetNames.map((n) => <option key={n}>{n}</option>)}
                </select>
                <span className="ps-k">Header row</span>
                <select value={headerRow} onChange={(e) => { setHeaderRow(+e.target.value); }} className="rg-sel">
                  {grid.raw.slice(0, 10).map((r, i) => (
                    <option key={i} value={i}>{i + 1}: {r.slice(0, 4).join(" | ").slice(0, 48)}</option>
                  ))}
                </select>
                <span className="ps-k">Contains</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="rg-sel">
                  <option value="patients">Patients</option>
                  <option value="carriers">Carriers</option>
                </select>
              </div>

              <div className="rg-group">
                <div className="rg-head">Columns <span className="rg-hint">Check these before importing.</span></div>
                <div className="imp-cols">
                  {headers.map((h, i) => {
                    const key = Object.keys(mapping).find((k) => mapping[k] === i) || "";
                    return (
                      <label key={i} className={"imp-col" + (key ? " on" : "")}>
                        <span>{String(h || `(column ${i + 1})`).slice(0, 28)}</span>
                        <select value={key} onChange={(e) => setCol(e.target.value || key, e.target.value ? i : "")}>
                          <option value="">— ignore —</option>
                          {FIELD_CHOICES.map((k) => <option key={k} value={k}>{HEAD[k] || k}</option>)}
                        </select>
                      </label>
                    );
                  })}
                </div>
                {unmapped.length > 0 && (
                  <p className="hint">{unmapped.length} column(s) were not recognised and will be ignored unless you assign them.</p>
                )}
              </div>

              <div className="rg-group">
                <div className="rg-head">
                  Rows <span className="count">{rows.length}</span>
                  <span className="rg-hint">
                    {counts.import || 0} ready · {counts.warn || 0} with warnings · {counts.conflict || 0} already on file · {counts.skip || 0} skipped
                  </span>
                </div>
                <div className="tbl-wrap" style={{ maxHeight: 260 }}>
                  <table className="data">
                    <thead>
                      <tr><th>Row</th>{Object.keys(mapping).map((k) => <th key={k}>{HEAD[k] || k}</th>)}<th>Status</th></tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 100).map((r) => (
                        <tr key={r.i}>
                          <td>{r.i + 1}</td>
                          {Object.keys(mapping).map((k) => <td key={k}>{r.values[k] || "—"}</td>)}
                          <td>
                            <span className={"pill " + (ACTION_PILL[r.action] || "na")}>{r.action}</span>
                            {r.issues.length > 0 && <span className="hint"> {r.issues.map((x) => x.msg).join("; ")}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 100 && <p className="hint">Showing the first 100 of {rows.length}.</p>}
              </div>
            </>
          )}
        </div>

        <div className="actionbar">
          <button className="btn btn-primary" disabled={!usable.length}
            onClick={() => onApply({ kind, rows: usable, mapping, sheetName: sheet })}>
            Import {usable.length || ""} row{usable.length === 1 ? "" : "s"}
          </button>
          <div className="spacer"></div>
          <span className="hint">Existing values are kept — an import never overwrites what a call confirmed.</span>
        </div>
      </div>
    </div>
  );
}
