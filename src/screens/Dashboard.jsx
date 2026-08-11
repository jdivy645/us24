import { useMemo, useState } from "react";
import { buildDashboard } from "../lib/dashboard.js";
import { STATUS, PRIORITY_LABEL } from "../lib/workflow.js";

// Bars rather than a chart library. Four breakdowns of a few rows each do not
// justify 200 kB of JavaScript, and a bar whose width is a percentage is readable
// in a way a pie chart of eleven insurers is not.
function Bars({ title, rows, total, empty = "Nothing yet" }) {
  if (!rows.length) return (
    <div className="dash-card">
      <div className="section-label">{title}</div>
      <p className="hint">{empty}</p>
    </div>
  );
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="dash-card">
      <div className="section-label">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="dash-row">
          <span className="dash-label" title={r.label}>{r.label}</span>
          <span className="prog">
            <span className="prog-bar" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
          </span>
          <span className="dash-num">
            {r.count}
            {total ? <span className="hint"> · {Math.round((r.count / total) * 100)}%</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

const Tile = ({ label, value, hint, tone }) => (
  <div className="tile">
    <div className={"tile-value" + (tone ? " t-" + tone : "")}>{value}</div>
    <div className="tile-label">{label}</div>
    {hint ? <div className="hint">{hint}</div> : null}
  </div>
);

export default function Dashboard({ records, stats }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const d = useMemo(() => buildDashboard(records, range), [records, range]);

  const statusRows = Object.entries(d.byStatus)
    .map(([k, count]) => ({ label: STATUS[k] || k, count }))
    .sort((a, b) => b.count - a.count);
  const verdictRows = Object.entries(d.byVerdict)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  const priorityRows = Object.entries(d.byPriority)
    .filter(([, count]) => count > 0)
    .map(([k, count]) => ({ label: PRIORITY_LABEL[k], count }));

  return (
    <div className="wrap">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Dashboard</h2>
            <p>Everything saved in this browser, by verification date.</p>
          </div>
          <div className="filters" style={{ margin: 0 }}>
            <label className="filter-date">
              From <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </label>
            <label className="filter-date">
              To <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </label>
            {(range.from || range.to) && (
              <button className="btn btn-ghost btn-sm" onClick={() => setRange({ from: "", to: "" })}>All time</button>
            )}
          </div>
        </div>

        <div className="card-body">
          <div className="tiles">
            <Tile label="Verifications" value={d.total} hint={`${d.withTranscript} with a call attached`} />
            <Tile label="Open" value={d.open} tone={d.open ? "warn" : "ok"} hint={`${d.finished} finished`} />
            <Tile label="Authorization required" value={d.authRequired}
              hint={d.total ? `${Math.round((d.authRequired / d.total) * 100)}% of records` : ""} />
            <Tile label="QA findings" value={d.findings} tone={d.byPriority.P1 ? "bad" : d.findings ? "warn" : "ok"}
              hint={d.openFindings ? `${d.openFindings} still open` : d.byPriority.P1 ? `${d.byPriority.P1} of them P1` : "none open"} />
            <Tile label="Quality score" value={d.qualityScore === null ? "—" : d.qualityScore}
              tone={d.qualityScore === null ? undefined : d.qualityScore >= 90 ? "ok" : d.qualityScore >= 75 ? "warn" : "bad"}
              hint={d.checked ? `mean of ${d.checked} checked` : "nothing checked yet"} />
            <Tile label="Clean rate" value={d.cleanRate === null ? "—" : `${d.cleanRate}%`}
              hint={d.checked ? `of ${d.checked} checked` : "nothing checked yet"} />
            <Tile label="Turnaround" value={d.medianTurnaround === null ? "—" : `${d.medianTurnaround}d`}
              hint="median, request to verification" />
            <Tile label="Incomplete" value={d.incomplete} tone={d.incomplete ? "warn" : "ok"}
              hint="required fields still blank" />
          </div>

          <div className="dash-grid">
            <Bars title="By project" rows={d.byProject} total={d.total} />
            <Bars title="By insurance" rows={d.byInsurance} total={d.total} />
            <Bars title="By operator" rows={d.byOperator} total={d.total} />
            <Bars title="By QA" rows={d.byQa} total={d.total} empty="No record has been through QA yet" />
            <Bars title="By status" rows={statusRows} total={d.total} />
            <Bars title="By call verdict" rows={verdictRows} total={d.total} />
            <Bars title="QA findings by priority" rows={priorityRows} empty="Nothing logged yet" />
            <Bars title="What kind of mistake" rows={d.byCategory} empty="Nothing logged yet" />
            {/* Not a percentage of the total: only records that need an
                authorization are in this pipeline at all. */}
            <Bars title="Authorization pipeline" rows={d.authPipeline}
              empty="No record has needed an authorization yet" />
            <Bars title="Quality score by operator" rows={d.scoreByOperator}
              empty="No record has been checked yet" />
            <Bars title="By request mode" rows={d.byRequestMode} total={d.total} />
          </div>

          {stats && (
            <p className="hint" style={{ marginTop: 16 }}>
              {stats.patients} patient(s) · {stats.carriers} payer(s) · {stats.cases} case(s) · {stats.versions} verification(s)
              · {stats.projects} project(s) · {stats.users} user(s)
              {stats.quota?.usage ? ` · ${(stats.quota.usage / 1048576).toFixed(1)} MB stored` : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
