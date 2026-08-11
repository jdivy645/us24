import { useEffect, useMemo, useState } from "react";
import * as db from "../lib/db.js";
import { HEAD, dash } from "../data/fields.js";
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_RANK, ERROR_CATEGORIES, ERROR_POINTS } from "../lib/workflow.js";

// Every QA finding in one place.
//
// The QA review panel shows one record's findings while you are looking at that
// record. This is the other question — what is going wrong across all of them —
// and it cannot be answered a record at a time.
const priorityClass = (p) => (p === "P1" ? "bad" : p === "P2" || p === "P3" ? "warn" : "ok");
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");

const COLUMNS = [
  { key: "at", label: "Raised" },
  { key: "priority", label: "Priority" },
  { key: "category", label: "Category" },
  { key: "projectId", label: "Project" },
  { key: "patient", label: "Patient" },
  { key: "fieldKey", label: "Field" },
  { key: "note", label: "Finding" },
  { key: "against", label: "Against" },
  { key: "by", label: "Raised by" },
  { key: "resolvedAt", label: "Fixed" },
];

export default function Errors({ records, projects, currentUser, toast, onReload, onOpenRecord }) {
  const [errors, setErrors] = useState([]);
  const [filters, setFilters] = useState({ state: "open", sort: "at", dir: "desc" });
  const [busy, setBusy] = useState(false);

  // The record each finding hangs off, for the patient name and to open it.
  const byVersion = useMemo(() => new Map(records.map((r) => [r._id, r])), [records]);

  const load = async () => setErrors(await db.listErrors({}));
  useEffect(() => { load().catch(() => {}); }, [records]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const q = String(filters.q || "").trim().toLowerCase();
    const out = errors
      .map((e) => {
        const rec = byVersion.get(e.versionId);
        return {
          ...e,
          patient: rec ? `${rec.lastName || ""}${rec.lastName && rec.firstName ? ", " : ""}${rec.firstName || ""}`.trim() : "",
          record: rec,
        };
      })
      .filter((e) => !filters.priority || e.priority === filters.priority)
      .filter((e) => !filters.category || e.category === filters.category)
      .filter((e) => !filters.projectName || e.projectId === filters.projectName)
      .filter((e) => !filters.state || (filters.state === "open" ? !e.resolvedAt : !!e.resolvedAt))
      .filter((e) => !filters.from || String(e.at).slice(0, 10) >= filters.from)
      .filter((e) => !filters.to || String(e.at).slice(0, 10) <= filters.to)
      .filter((e) => !q || [e.note, e.patient, e.against, e.by, e.projectId, HEAD[e.fieldKey]]
        .some((x) => String(x || "").toLowerCase().includes(q)));

    const { sort = "at", dir = "desc" } = filters;
    const sign = dir === "asc" ? 1 : -1;
    // Priority sorts by severity, not alphabetically — "P1, P2, P3" only happens to
    // be alphabetical, and NONE would sort into the middle.
    if (sort === "priority") return out.sort((a, b) => sign * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]));
    return out.sort((a, b) => sign * String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), undefined, { numeric: true }));
  }, [errors, filters, byVersion]);

  const totals = useMemo(() => {
    const t = { P1: 0, P2: 0, P3: 0, NONE: 0, open: 0, points: 0 };
    for (const e of errors) {
      if (t[e.priority] !== undefined) t[e.priority] += 1;
      if (e.priority !== "NONE" && !e.resolvedAt) t.open += 1;
      t.points += ERROR_POINTS[e.priority] || 0;
    }
    return t;
  }, [errors]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const onSort = (key) =>
    setFilters((f) => ({ ...f, sort: key, dir: f.sort === key && f.dir === "desc" ? "asc" : "desc" }));

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); await load(); await onReload?.(); toast(msg); }
    catch (e) { toast(e?.message || String(e), "bad"); }
    finally { setBusy(false); }
  };

  const arrow = (key) => (filters.sort !== key ? "" : filters.dir === "asc" ? " ▲" : " ▼");

  return (
    <div className="wrap">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Errors</h2>
            <p>Everything QA has found, across every record. A finding stays on the score once it is fixed.</p>
          </div>
          <div className="pill-row">
            {totals.P1 > 0 && <span className="pill bad">{totals.P1} P1</span>}
            {totals.P2 > 0 && <span className="pill warn">{totals.P2} P2</span>}
            {totals.P3 > 0 && <span className="pill warn">{totals.P3} P3</span>}
            {totals.open > 0 && <span className="pill bad">{totals.open} open</span>}
            {!totals.P1 && !totals.P2 && !totals.P3 && <span className="pill ok">No errors logged</span>}
          </div>
        </div>

        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="filters">
            <input className="filter-q" type="search" placeholder="Search the finding, patient, operator or project…"
              value={filters.q || ""} onChange={set("q")} aria-label="Search findings" />
            <select value={filters.state || ""} onChange={set("state")} aria-label="Open or fixed">
              <option value="">Open and fixed</option>
              <option value="open">Open only</option>
              <option value="resolved">Fixed only</option>
            </select>
            <select value={filters.priority || ""} onChange={set("priority")} aria-label="Priority">
              <option value="">Any priority</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
            <select value={filters.category || ""} onChange={set("category")} aria-label="Category">
              <option value="">Any category</option>
              {Object.entries(ERROR_CATEGORIES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <select value={filters.projectName || ""} onChange={set("projectName")} aria-label="Project">
              <option value="">All projects</option>
              {projects.filter((p) => !p.archived).map((p) => <option key={p.id}>{p.name}</option>)}
            </select>
            <label className="filter-date">From <input type="date" value={filters.from || ""} onChange={set("from")} /></label>
            <label className="filter-date">To <input type="date" value={filters.to || ""} onChange={set("to")} /></label>
            <span className="hint filter-count">
              {rows.length === errors.length ? `${errors.length} finding${errors.length === 1 ? "" : "s"}` : `${rows.length} of ${errors.length}`}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ sort: filters.sort, dir: filters.dir })}>
              Clear filters
            </button>
          </div>
        </div>

        <div className="tbl-wrap">
          {!rows.length ? (
            <div className="empty">
              <h3>Nothing here</h3>
              <p>{errors.length ? "No finding matches these filters." : "QA has not logged anything yet."}</p>
            </div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key}>
                      <button type="button" className="th-sort" onClick={() => onSort(c.key)}>{c.label}{arrow(c.key)}</button>
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>{when(e.at)}</td>
                    <td><span className={"pill " + priorityClass(e.priority)}>{e.priority}</span></td>
                    <td>{ERROR_CATEGORIES[e.category] || dash(e.category)}</td>
                    <td>{dash(e.projectId)}</td>
                    <td>{dash(e.patient)}</td>
                    <td>{e.fieldKey ? HEAD[e.fieldKey] || e.fieldKey : "Whole record"}</td>
                    <td style={{ whiteSpace: "normal", minWidth: 260 }}>{dash(e.note)}</td>
                    <td>{dash(e.against)}</td>
                    <td>{dash(e.by)}</td>
                    <td>
                      {e.resolvedAt
                        ? <span className="pill ok" title={`${e.resolvedBy || "unknown"} · ${when(e.resolvedAt)}`}>fixed</span>
                        : <span className="pill warn">open</span>}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {e.record && (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => onOpenRecord(e.record)}>Open record</button>{" "}
                        </>
                      )}
                      {e.priority !== "NONE" && (e.resolvedAt
                        ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => db.reopenError(e.id), "Finding reopened")}>Reopen</button>
                        : <button className="btn btn-dark btn-sm" disabled={busy} onClick={() => act(() => db.resolveError(e.id, currentUser?.name || ""), "Marked fixed")}>Mark fixed</button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
