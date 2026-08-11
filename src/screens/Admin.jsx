import { useState } from "react";
import * as db from "../lib/db.js";
import { F, HEAD, REQUEST_MODES } from "../data/fields.js";
import { MANDATORY_FIELDS, MODE_EXEMPT } from "../lib/completeness.js";

const ROLES = [
  { value: "agent", label: "Operator — enters verifications" },
  { value: "qa", label: "QA — checks other people's work" },
  { value: "admin", label: "Admin — everything, including reopening finished records" },
];

// The fields that are required for everyone, so the per-project editor can show
// what it is adding to rather than presenting an empty list as the whole truth.
const STANDARD = new Set(MANDATORY_FIELDS.map((f) => f.key));

// Which required-field rule this project applies for one request mode. `add` names
// extra fields; `exempt` drops standard ones. Both are needed: one client wants the
// payer phone chased, another cannot get a call reference out of a web portal.
function RequirementEditor({ project, mode, onChange }) {
  const rule = project.required?.[mode] || { add: [], exempt: [] };
  const add = new Set(rule.add || []);
  const exempt = new Set(rule.exempt || []);
  const modeExempt = new Set(MODE_EXEMPT[mode] || []);

  const toggle = (key) => {
    // Three states in one click, in the order a person reaches for them:
    // standard → exempt → standard, and optional → required → optional.
    const isStandard = STANDARD.has(key);
    const next = { add: [...add], exempt: [...exempt] };
    if (isStandard) {
      if (exempt.has(key)) next.exempt = next.exempt.filter((k) => k !== key);
      else next.exempt = [...next.exempt, key];
    } else if (add.has(key)) {
      next.add = next.add.filter((k) => k !== key);
    } else {
      next.add = [...next.add, key];
    }
    onChange({ ...project, required: { ...project.required, [mode]: next } });
  };

  const stateOf = (key) => {
    if (modeExempt.has(key)) return "n/a for this mode";
    if (exempt.has(key)) return "not required";
    if (STANDARD.has(key) || add.has(key)) return "required";
    return "optional";
  };

  return (
    <div className="req-grid">
      {F.map((key) => {
        const s = stateOf(key);
        return (
          <button
            key={key}
            type="button"
            className={"req-chip s-" + s.replace(/[^a-z]/g, "")}
            disabled={modeExempt.has(key)}
            title={`${HEAD[key] || key} — ${s}`}
            onClick={() => toggle(key)}
          >
            {HEAD[key] || key}
          </button>
        );
      })}
    </div>
  );
}

export default function Admin({ projects, users, currentUser, toast, onReload }) {
  const [editing, setEditing] = useState(null);
  const [mode, setMode] = useState("CALL");
  const [newProject, setNewProject] = useState({ name: "", category: "" });
  const [newUser, setNewUser] = useState({ name: "", role: "agent" });

  const save = async (fn, ok) => {
    try {
      await fn();
      await onReload();
      toast(ok);
    } catch (e) {
      toast(e?.message || String(e), "bad");
    }
  };

  return (
    <div className="wrap">
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <div>
            <h2>Projects</h2>
            <p>Every verification belongs to one. The required-field rule is set per project and per request mode.</p>
          </div>
        </div>
        <div className="card-body">
          <div className="qa-entry">
            <input type="text" placeholder="Project name" value={newProject.name}
              onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} aria-label="New project name" />
            <input type="text" placeholder="Category (optional)" value={newProject.category}
              onChange={(e) => setNewProject({ ...newProject, category: e.target.value })} aria-label="New project category" />
            <button className="btn btn-dark btn-sm"
              onClick={() => save(async () => {
                await db.upsertProject(newProject);
                setNewProject({ name: "", category: "" });
              }, `Project "${newProject.name}" added`)}>
              Add project
            </button>
          </div>

          {!projects.length && <p className="hint">No projects yet. Add one before saving a verification.</p>}

          {projects.map((p) => (
            <div key={p.id} className="rg-row">
              <div className="rg-main">
                <span className="rg-label">{p.name}{p.archived ? " (archived)" : ""}</span>
                <span className="rg-detail">
                  {p.category || "no category"}
                  {REQUEST_MODES.map((m) => {
                    const r = p.required?.[m] || {};
                    const n = (r.add?.length || 0) + (r.exempt?.length || 0);
                    return n ? ` · ${m}: ${n} rule${n > 1 ? "s" : ""}` : "";
                  }).join("")}
                </span>
              </div>
              <div className="rg-acts">
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setEditing(editing?.id === p.id ? null : p)}>
                  {editing?.id === p.id ? "Done" : "Required fields"}
                </button>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => save(() => db.archiveProject(p.id, !p.archived), p.archived ? "Project restored" : "Project archived")}>
                  {p.archived ? "Restore" : "Archive"}
                </button>
              </div>
            </div>
          ))}

          {editing && (
            <div className="req-editor">
              <div className="section-label sec-head">
                <span>Required fields for {editing.name}</span>
                <span className="sec-actions">
                  {REQUEST_MODES.map((m) => (
                    <button key={m} className={"btn btn-xs " + (mode === m ? "btn-dark" : "btn-ghost")} onClick={() => setMode(m)}>{m}</button>
                  ))}
                </span>
              </div>
              <p className="hint">
                Click a field to change it. Required fields still take a Not-Applicable with a reason —
                this decides what has to be answered, not what has to be filled in.
              </p>
              <RequirementEditor project={editing} mode={mode} onChange={setEditing} />
              <div className="actionbar">
                <button className="btn btn-primary btn-sm"
                  onClick={() => save(async () => { await db.upsertProject(editing); setEditing(null); }, "Required fields saved")}>
                  Save rule
                </button>
                <div className="spacer"></div>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>People</h2>
            <p>
              Attribution and queue routing, not sign-in. There are no passwords here —
              this says who did the work and who is allowed to check it.
            </p>
          </div>
        </div>
        <div className="card-body">
          <div className="qa-entry">
            <input type="text" placeholder="Name" value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} aria-label="New user name" />
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} aria-label="Role">
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <button className="btn btn-dark btn-sm"
              onClick={() => save(async () => {
                const u = await db.upsertUser(newUser);
                if (!currentUser) await db.setCurrentUser(u.id);
                setNewUser({ name: "", role: "agent" });
              }, `${newUser.name} added`)}>
              Add person
            </button>
          </div>

          {!users.length && <p className="hint">Nobody added yet. The first person you add becomes the current user.</p>}

          {users.map((u) => (
            <div key={u.id} className="rg-row">
              <div className="rg-main">
                <span className="rg-label">{u.name}{currentUser?.id === u.id ? " — signed in" : ""}</span>
                <span className="rg-detail">{ROLES.find((r) => r.value === u.role)?.label || u.role}{u.active ? "" : " · inactive"}</span>
              </div>
              <div className="rg-acts">
                <select value={u.role} onChange={(e) => save(() => db.upsertUser({ ...u, role: e.target.value }), `${u.name} is now ${e.target.value}`)}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.value}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => save(() => db.upsertUser({ ...u, active: !u.active }), u.active ? `${u.name} deactivated` : `${u.name} reactivated`)}>
                  {u.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
