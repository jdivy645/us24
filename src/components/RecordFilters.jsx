import { STATUS, PRIORITIES, PRIORITY_LABEL } from "../lib/workflow.js";

// One row of controls over the saved records. Every filter is a plain value the
// parent owns, so the same component drives the records list and the QA queue
// without either of them learning about the other's state.
const VERDICTS = ["APPROVED", "ATTESTED", "REJECTED", "UNVERIFIED", "NO TRANSCRIPT"];

export default function RecordFilters({ value, onChange, projects = [], hide = [], total = 0, shown = 0 }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const show = (k) => !hide.includes(k);
  const active = Object.entries(value).some(([k, v]) => k !== "sort" && k !== "dir" && v);

  return (
    <div className="filters">
      <input
        className="filter-q"
        type="search"
        placeholder="Search patient, DOB, policy, group, insurance, project, operator…"
        value={value.q || ""}
        onChange={set("q")}
        aria-label="Search saved records"
      />
      {show("projectName") && (
        <select value={value.projectName || ""} onChange={set("projectName")} aria-label="Project">
          <option value="">All projects</option>
          {projects.filter((p) => !p.archived).map((p) => <option key={p.id}>{p.name}</option>)}
        </select>
      )}
      {show("status") && (
        <select value={value.status || ""} onChange={set("status")} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(STATUS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      )}
      {show("verdict") && (
        <select value={value.verdict || ""} onChange={set("verdict")} aria-label="Verdict">
          <option value="">Any verdict</option>
          {VERDICTS.map((x) => <option key={x}>{x}</option>)}
        </select>
      )}
      {show("priority") && (
        <select value={value.priority || ""} onChange={set("priority")} aria-label="QA priority">
          <option value="">Any QA result</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
      )}
      {show("from") && (
        <label className="filter-date">
          From <input type="date" value={value.from || ""} onChange={set("from")} />
        </label>
      )}
      {show("to") && (
        <label className="filter-date">
          To <input type="date" value={value.to || ""} onChange={set("to")} />
        </label>
      )}
      {/* Saying what was filtered out matters more than it looks: a filter left on
          from yesterday reads as "the records are gone". */}
      <span className="hint filter-count">
        {shown === total ? `${total} record${total === 1 ? "" : "s"}` : `${shown} of ${total}`}
      </span>
      {active && (
        <button className="btn btn-ghost btn-sm" onClick={() => onChange({ sort: value.sort, dir: value.dir })}>
          Clear filters
        </button>
      )}
    </div>
  );
}
