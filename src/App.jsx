import { useEffect, useMemo, useRef, useState } from "react";
import * as db from "./lib/db.js";
import { downloadText } from "./lib/files.js";
import { OPEN_STATUSES } from "./lib/workflow.js";
import ImportPanel from "./components/ImportPanel.jsx";
import Toasts from "./components/Toast.jsx";
import NewVerification from "./screens/NewVerification.jsx";
import Records from "./screens/Records.jsx";
import QaQueue from "./screens/QaQueue.jsx";
import Dashboard from "./screens/Dashboard.jsx";
import Admin from "./screens/Admin.jsx";

// The shell. It owns what more than one screen needs — who is signed in, the
// project list, the records, the toast stack — and nothing else.
//
// Navigation is a string in state plus the URL hash rather than a router: five flat
// screens with no parameters do not justify a dependency, and the hash gives back
// the two things a plain useState loses — a refresh that stays put, and a link.
const SCREENS = [
  { id: "form", label: "New verification" },
  { id: "records", label: "Saved records" },
  { id: "qa", label: "QA queue" },
  { id: "dashboard", label: "Dashboard" },
  { id: "admin", label: "Admin" },
];

const fromHash = () => {
  const id = String(window.location.hash || "").replace(/^#\/?/, "").split("/")[0];
  return SCREENS.some((s) => s.id === id) ? id : "form";
};

export default function App() {
  const [screen, setScreen] = useState(fromHash);
  const [records, setRecords] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [importing, setImporting] = useState(null);
  const [handoff, setHandoff] = useState(null);
  const toastId = useRef(0);

  const toast = (msg, type = "good") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  const reload = async () => {
    const [rows, prj, usr, st] = await Promise.all([
      db.listRecent(), db.listProjects(), db.listUsers(), db.stats()]);
    setRecords(rows);
    setProjects(prj.sort((a, b) => a.name.localeCompare(b.name)));
    setUsers(usr.sort((a, b) => a.name.localeCompare(b.name)));
    setStats(st);
    setCurrentUser(await db.currentUser());
  };

  // Migration from the old localStorage log and the v3 workflow backfill both run
  // once, on first load.
  useEffect(() => {
    db.ready()
      .then((r) => {
        if (r?.migrated) toast(`Records moved to local database — ${r.counts.cases} case(s), ${r.counts.carriers} carrier(s)`);
        if (r?.backfilled) toast(`${r.backfilled} existing record(s) marked finished and assigned to ${db.UNASSIGNED}`);
        return reload();
      })
      .catch((e) => toast("Could not open the local database: " + (e?.message || e), "bad"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Two-way with the hash: clicking a tab writes it, and Back reads it.
  useEffect(() => {
    const onHash = () => setScreen(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (id) => {
    setScreen(id);
    if (fromHash() !== id) window.location.hash = "/" + id;
  };

  const queueCount = useMemo(
    () => records.filter((r) => OPEN_STATUSES.includes(r._status)).length, [records]);

  const switchUser = async (id) => {
    await db.setCurrentUser(id);
    const u = await db.currentUser();
    setCurrentUser(u);
    toast(u ? `Signed in as ${u.name} (${u.role})` : "Signed out");
  };

  // Sending a saved record back to the form is the one thing that crosses screens,
  // so the shell brokers it. NewVerification clears the handoff once it has loaded
  // it, which keeps a stale record from being re-applied on every later render.
  const reverify = (record) => {
    setHandoff(record);
    go("form");
    toast("Loaded — update what changed and save as a new version");
  };

  const openImport = async () => setImporting({ existingKeys: await db.patientKeySet() });

  const handleImport = async ({ kind, rows, mapping, sheetName }) => {
    try {
      const counts = await db.applyImport({ kind, rows, mapping, sheetName });
      setImporting(null);
      await reload();
      toast(`Imported — ${counts.created} added, ${counts.updated} updated, ${counts.skipped} skipped`);
    } catch (e) {
      toast("Import failed: " + (e?.message || e), "bad");
    }
  };

  const handleBackup = async () => {
    const bundle = await db.exportAll();
    downloadText(JSON.stringify(bundle, null, 2), `US24_VOB_Backup_${new Date().toISOString().slice(0, 10)}.json`);
    toast("Backup downloaded — keep it somewhere outside this browser");
  };

  const handleRestore = async (file) => {
    if (!window.confirm("Merge this backup into the current database?")) return;
    try {
      await db.importAll(JSON.parse(await file.text()), { mode: "merge" });
      await reload();
      toast("Backup restored");
    } catch (e) {
      toast("That file is not a US24 backup: " + (e?.message || e), "bad");
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">US<span>24</span> SOLUTIONS</div>
          <div className="brand-rule"></div>
          <div className="brand-tag">Verification of Benefits</div>
        </div>
        <div className="topbar-actions">
          {/* Who is doing the work. Not a login — it decides attribution on the
              record and whether the QA actions are offered at all. */}
          <select className="user-pick" value={currentUser?.id || ""} onChange={(e) => switchUser(e.target.value)} aria-label="Current user">
            <option value="">No user selected</option>
            {users.filter((u) => u.active).map((u) => (
              <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
            ))}
          </select>
          <label className="btn btn-light btn-sm">
            Restore backup
            <input type="file" accept=".json,application/json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleRestore(f); }} />
          </label>
          <button className="btn btn-light btn-sm" onClick={openImport}>Import spreadsheet</button>
          <button className="btn btn-light btn-sm" onClick={handleBackup}>Download backup</button>
        </div>
      </div>

      <div className="tabs">
        {SCREENS.map((s) => (
          <button key={s.id} className={"tab" + (screen === s.id ? " active" : "")} onClick={() => go(s.id)}>
            {s.label}
            {s.id === "records" && <span className="count">{records.length}</span>}
            {s.id === "qa" && queueCount > 0 && <span className="count">{queueCount}</span>}
          </button>
        ))}
      </div>

      {/* Only the active screen is mounted. The old two-tab version hid the inactive
          pane with CSS, which was free at two panes and is not at five — every
          keystroke in the form would re-render four screens nobody is looking at. */}
      {screen === "form" && (
        <NewVerification
          toast={toast}
          currentUser={currentUser}
          projects={projects}
          handoff={handoff}
          onHandoffDone={() => setHandoff(null)}
          onSaved={reload}
        />
      )}
      {screen === "records" && (
        <Records records={records} projects={projects} toast={toast} onReload={reload} onReverify={reverify} />
      )}
      {screen === "qa" && (
        <QaQueue records={records} projects={projects} currentUser={currentUser} toast={toast} onReload={reload} />
      )}
      {screen === "dashboard" && <Dashboard records={records} stats={stats} />}
      {screen === "admin" && (
        <Admin projects={projects} users={users} currentUser={currentUser} toast={toast} onReload={reload} />
      )}

      {importing && (
        <ImportPanel existingKeys={importing.existingKeys} onApply={handleImport} onClose={() => setImporting(null)} />
      )}

      <Toasts toasts={toasts} />
    </>
  );
}
