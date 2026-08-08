import { reviewGroups, blockingCount } from "../lib/fieldState.js";
import { BYPASS_REASONS } from "../lib/bypass.js";

// The one moment where the verifier is made to look at everything the call did not
// support. It opens on Save, never on Preview — previewing a half-filled form while
// still on the phone is the normal way to work.

const jumpTo = (key) => {
  const el = document.getElementById("f-" + key);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1200);
};

function Row({ s, onUse, onKeep, onBypass, onClose }) {
  const heard = s.heard != null ? String(s.heard).replace(/\s+/g, " ").trim() : "";
  return (
    <div className={"rg-row" + (s.blocking ? " blocking" : "")}>
      <div className="rg-main">
        <span className="rg-label">{s.label}</span>
        {s.kind === "required" ? (
          <span className="rg-detail">required, still empty</span>
        ) : heard ? (
          <span className="rg-detail">
            form <b>{s.value || "—"}</b> · call {s.confidence === "low" ? "may say" : "says"} <b>{heard}</b>
          </span>
        ) : (
          <span className="rg-detail">{s.value || "—"}{s.detail ? ` · ${s.detail}` : ""}</span>
        )}
        {s.acked && <span className="pill ok rg-pill">kept</span>}
      </div>
      <div className="rg-acts">
        {heard && !s.acked && (
          <>
            <button className="btn btn-dark btn-sm" onClick={() => onUse(s.key, heard)}>Use “{heard}”</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onKeep(s.key, heard, s.value)}>Keep mine</button>
          </>
        )}
        {(s.kind === "required" || s.kind === "notheard" || s.kind === "echo") && (
          <select className="rg-sel" value="" onChange={(e) => e.target.value && onBypass(s.key, e.target.value)}>
            <option value="">Bypass…</option>
            {Object.entries(BYPASS_REASONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => { onClose(); jumpTo(s.key); }}>Go to field</button>
      </div>
    </div>
  );
}

export default function ReviewGate({ states, onUse, onKeep, onBypass, onClose, onSaveAnyway }) {
  const groups = reviewGroups(states);
  const blockers = blockingCount(states);
  const exceptions = [...states.values()].filter((s) => s.acked || s.kind === "bypassed").length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <div>
            <h2>Review before saving</h2>
            <p>{blockers ? `${blockers} item${blockers > 1 ? "s" : ""} still need${blockers > 1 ? "" : "s"} a decision.` : "Nothing left to resolve."}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="card-body">
          {!groups.length && <p className="hint">Everything on the form matches the call.</p>}
          {groups.map((g) => (
            <div key={g.id} className="rg-group">
              <div className="rg-head">
                {g.title} <span className="count">{g.items.length}</span>
                <span className="rg-hint">{g.hint}</span>
              </div>
              {g.items.map((s) => (
                <Row key={s.key} s={s} onUse={onUse} onKeep={onKeep} onBypass={onBypass} onClose={onClose} />
              ))}
            </div>
          ))}
        </div>
        <div className="actionbar">
          <button className="btn btn-primary" disabled={blockers > 0} onClick={onSaveAnyway}>
            {exceptions ? `Save with ${exceptions} exception${exceptions > 1 ? "s" : ""}` : "Save & generate PDF"}
          </button>
          <div className="spacer"></div>
          <button className="btn btn-ghost" onClick={onClose}>Keep editing</button>
        </div>
      </div>
    </div>
  );
}
