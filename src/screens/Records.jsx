import { useMemo, useState } from "react";
import * as db from "../lib/db.js";
import { dash } from "../data/fields.js";
import { recordCompleteness } from "../lib/completeness.js";
import { checkTranscript } from "../lib/verify.js";
import { parseTranscript } from "../lib/transcriptParse.js";
import { downloadTranscriptTxt } from "../lib/transcriptFile.js";
import { getAudio, delAudio, clearAudio } from "../lib/audioStore.js";
import { downloadBlob } from "../lib/files.js";
import { exportExcel } from "../lib/excel.js";
import LogTable from "../components/LogTable.jsx";
import RecordFilters from "../components/RecordFilters.jsx";
import CaseHistory from "../components/CaseHistory.jsx";
import TranscriptView from "../components/TranscriptView.jsx";

const VERDICT_PILL = { APPROVED: "ok", ATTESTED: "ok", REJECTED: "bad", UNVERIFIED: "warn" };
const ALL = "__all__";

// Filtering and sorting happen here rather than in db.js because the whole record
// set is already in memory for the count badge. Going back to the database on every
// keystroke would be slower and would make the table flicker.
const matches = (r, f) => {
  const q = String(f.q || "").trim().toLowerCase();
  if (q && ![r.lastName, r.firstName, r.dob, r.policyId, r.groupId, r.insName, r.projectName,
    r.category, r.username, r.verifiedBy, r._qaName, r.authNum, r.callRef, r.repName]
    .some((x) => String(x || "").toLowerCase().includes(q))) return false;
  if (f.projectName && r.projectName !== f.projectName) return false;
  if (f.status && r._status !== f.status) return false;
  if (f.verdict && (r._verdict || "NO TRANSCRIPT") !== f.verdict) return false;
  if (f.priority && r._topPriority !== f.priority) return false;
  if (f.from && String(r.today || "") < f.from) return false;
  if (f.to && String(r.today || "") > f.to) return false;
  return true;
};

export default function Records({ records, projects, toast, onReload, onReverify, onCorrect }) {
  const [filters, setFilters] = useState({ sort: "_savedAt", dir: "desc" });
  const [projectTab, setProjectTab] = useState(ALL);
  const [viewIdx, setViewIdx] = useState(-1);
  const [viewText, setViewText] = useState("");
  const [historyFor, setHistoryFor] = useState(null);

  // The project tab and the project filter are the same question asked two ways.
  // The tab wins, because it is the one the user just clicked.
  const effective = useMemo(
    () => ({ ...filters, projectName: projectTab === ALL ? filters.projectName : projectTab }),
    [filters, projectTab]);

  const rows = useMemo(() => {
    const out = records.filter((r) => matches(r, effective));
    const { sort = "_savedAt", dir = "desc" } = filters;
    const sign = dir === "asc" ? 1 : -1;
    return out.sort((a, b) => sign * String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), undefined, { numeric: true }));
  }, [records, effective, filters]);

  // Only projects that actually have records get a tab. An admin list of thirty
  // projects would otherwise push the useful ones off the screen.
  const projectTabs = useMemo(() => {
    const counts = new Map();
    for (const r of records) {
      const name = r.projectName || "—";
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [records]);

  const onSort = (key) =>
    setFilters((f) => ({ ...f, sort: key, dir: f.sort === key && f.dir === "desc" ? "asc" : "desc" }));

  const handleExport = async () => {
    if (!rows.length) { toast("No records to export", "bad"); return; }
    // The transcript lives in its own store and is loaded only where it is needed —
    // it is by far the biggest thing on a record and the table never shows it.
    const full = await Promise.all(rows.map(async (r) => ({ ...r, _transcript: await db.getTranscript(r._id) })));
    exportExcel(full);
    toast(`Exported ${rows.length} record${rows.length > 1 ? "s" : ""} to Excel`);
  };

  const openTranscript = async (i) => {
    setViewIdx(i);
    setViewText(await db.getTranscript(rows[i]._id));
  };

  const handleHistory = async (i) => {
    const r = rows[i];
    if (!r._caseId) { toast("No history for this record", "warn"); return; }
    const versions = await db.getCaseHistory(r._caseId);
    setHistoryFor({ versions, name: `${dash(r.lastName)}, ${dash(r.firstName)}` });
  };

  const handleDelete = async (i) => {
    const r = rows[i];
    if (!window.confirm(`Delete the ${r.today || "saved"} verification for ${dash(r.lastName)}? Its QA findings and comments go with it.`)) return;
    if (r._id) delAudio(r._id).catch(() => {});
    setViewIdx(-1);
    await db.deleteVersion(r._id);
    await onReload();
    toast("Record deleted");
  };

  const handleClearAll = async () => {
    if (!window.confirm("Delete all saved records? Download a backup first if you need them.")) return;
    clearAudio().catch(() => {});
    setViewIdx(-1);
    await db.clearAll();
    await onReload();
    toast("All records cleared");
  };

  // Records saved before audio upload was removed still have a blob in IndexedDB.
  // Nothing writes there any more; this only lets an old recording be downloaded.
  const handleAudio = (i) => {
    const r = rows[i];
    getAudio(r._id)
      .then((b) => b ? downloadBlob(b, r._audioFile || "call_audio.webm") : toast("Audio not found in this browser", "bad"))
      .catch(() => toast("Audio not found in this browser", "bad"));
  };

  const viewRec = viewIdx >= 0 ? rows[viewIdx] : null;
  const viewParsed = useMemo(
    () => (viewText ? parseTranscript(viewText, { insName: viewRec?.insName, verifiedBy: viewRec?.verifiedBy }) : null),
    [viewText]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wrap">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Saved verifications</h2>
            <p>Stored in this browser. Export any time to Excel.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleExport}>Download Excel</button>
            <button className="btn btn-ghost btn-sm" onClick={handleClearAll}>Clear all</button>
          </div>
        </div>

        {projectTabs.length > 1 && (
          <div className="subtabs">
            <button className={"subtab" + (projectTab === ALL ? " active" : "")} onClick={() => setProjectTab(ALL)}>
              All cases <span className="count">{records.length}</span>
            </button>
            {projectTabs.map(([name, n]) => (
              <button key={name} className={"subtab" + (projectTab === name ? " active" : "")} onClick={() => setProjectTab(name)}>
                {name} <span className="count">{n}</span>
              </button>
            ))}
          </div>
        )}

        <div className="card-body" style={{ paddingBottom: 0 }}>
          <RecordFilters
            value={filters}
            onChange={setFilters}
            projects={projects}
            hide={projectTab === ALL ? [] : ["projectName"]}
            total={records.length}
            shown={rows.length}
          />
        </div>

        <div className="tbl-wrap">
          <LogTable
            records={rows}
            sort={filters.sort}
            dir={filters.dir}
            onSort={onSort}
            // A record QA sent back is corrected in place, not re-verified into a
            // second version — otherwise the findings stay on version 1 and the
            // return is invisible on the record that replaced it.
            onOpen={(i) => (rows[i]._status === "returned" ? onCorrect(rows[i]) : onReverify(rows[i]))}
            onDelete={handleDelete}
            onTranscript={openTranscript}
            onHistory={handleHistory}
            onAudio={handleAudio}
          />
        </div>
      </div>

      {viewRec && (
        <div className="modal-overlay" onClick={() => setViewIdx(-1)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <div>
                <h2>{dash(viewRec.lastName)}, {dash(viewRec.firstName)} — call transcript</h2>
                <p>Matched details are highlighted{viewRec._source ? ` · ${viewRec._source}` : ""}.</p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={"pill " + (VERDICT_PILL[viewRec._verdict] || "na")}>{viewRec._verdict || "NO TRANSCRIPT"}</span>
                {recordCompleteness(viewRec).incomplete && (
                  <span className="pill warn" title={recordCompleteness(viewRec).blank.join(", ")}>
                    INCOMPLETE {recordCompleteness(viewRec).count}
                  </span>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => downloadTranscriptTxt(viewRec, viewText, checkTranscript(viewRec, viewText, viewRec._meta, { ranges: viewParsed?.ranges }))}
                >
                  Download .txt
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewIdx(-1)}>Close</button>
              </div>
            </div>
            <div className="card-body">
              <TranscriptView v={viewRec} transcript={viewText} meta={viewRec._meta} ranges={viewParsed?.ranges} />
            </div>
          </div>
        </div>
      )}

      {historyFor && (
        <CaseHistory name={historyFor.name} versions={historyFor.versions} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}
