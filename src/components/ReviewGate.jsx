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

const clamp = (s, n = 90) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

function Row({ s, onUse, onKeep, onBypass, onAccept, onReject, onUseSuggestion, onResolve, onClose }) {
  const heard = s.heard != null ? String(s.heard).replace(/\s+/g, " ").trim() : "";
  const machine = s.kind === "autofill";
  const flagged = s.kind === "flagged";
  return (
    <div className={"rg-row" + (s.blocking ? " blocking" : "")}>
      <div className="rg-main">
        <span className="rg-label">{s.label}</span>
        {flagged ? (
          <span className="rg-detail">
            <b>{s.priority}</b> · {s.detail || "flagged by QA"}{s.raisedBy ? ` — ${s.raisedBy}` : ""}
            {s.value ? ` · currently “${clamp(s.value, 40)}”` : ""}
          </span>
        ) : machine ? (
          <span className="rg-detail"><b>{s.value}</b> · rep said “{clamp(s.quote)}”</span>
        ) : s.kind === "required" ? (
          <span className="rg-detail">required, still empty{s.suggestion ? ` · call may say “${s.suggestion.value}”` : ""}</span>
        ) : s.kind === "filedisagree" ? (
          <span className="rg-detail">on file <b>{s.onFile}</b> · call says <b>{clamp(heard, 40)}</b></span>
        ) : heard ? (
          <span className="rg-detail">
            form <b>{s.value || "—"}</b> · call {s.confidence === "low" ? "may say" : "says"} <b>{heard}</b>
          </span>
        ) : s.suggestion ? (
          <span className="rg-detail">call may say <b>{s.suggestion.value}</b> · {s.suggestion.why}</span>
        ) : (
          <span className="rg-detail">{s.value || "—"}{s.detail ? ` · ${s.detail}` : ""}</span>
        )}
        {s.acked && <span className="pill ok rg-pill">kept</span>}
        {s.strict && machine && <span className="pill warn rg-pill">check individually</span>}
      </div>
      <div className="rg-acts">
        {/* The gate cannot be passed while a finding is open, so it has to be
            possible to close one from here — otherwise the only way out of the
            modal is to leave it, which reads as a dead end. */}
        {flagged && (
          <button className="btn btn-dark btn-sm" onClick={() => onResolve?.(s.finding)}>Mark fixed</button>
        )}
        {machine && (
          <>
            <button className="btn btn-dark btn-sm" onClick={() => onAccept([s.key])}>Accept</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onReject(s.key)}>Clear</button>
          </>
        )}
        {!machine && heard && !s.acked && (
          <>
            <button className="btn btn-dark btn-sm" onClick={() => onUse(s.key, heard)}>Use “{clamp(heard, 28)}”</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onKeep(s.key, heard, s.value || s.onFile)}>
              {s.kind === "filedisagree" ? "Keep the file value" : "Keep mine"}
            </button>
          </>
        )}
        {!machine && !heard && s.suggestion && (
          <button className="btn btn-dark btn-sm" onClick={() => onUseSuggestion(s.suggestion)}>Use it</button>
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

export default function ReviewGate({ states, onUse, onKeep, onBypass, onAccept, onReject, onUseSuggestion, onResolve, onClose, onSaveAnyway }) {
  const groups = reviewGroups(states);
  const blockers = blockingCount(states);
  const exceptions = [...states.values()].filter((s) => s.acked || s.kind === "bypassed").length;
  const attested = [...states.values()].filter((s) => s.kind === "attested").length;
  const machineRead = [...states.values()].filter((s) => s.kind === "autofill").length;
  const other = blockers - machineRead;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <div>
            <h2>Review before saving</h2>
            {/* The gate only opens BECAUSE something is blocking, so its save
                button is always disabled on arrival. Saying which rows are at
                fault is the difference between a checklist and a dead end. */}
            <p>
              {blockers
                ? [
                  machineRead ? `${machineRead} value${machineRead > 1 ? "s were" : " was"} read from the call and nobody has checked ${machineRead > 1 ? "them" : "it"} yet` : "",
                  other ? `${other} other item${other > 1 ? "s need" : " needs"} a decision` : "",
                ].filter(Boolean).join(" · ") + ". Accept what looks right, or clear what doesn't."
                : "Nothing left to resolve."}
            </p>
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
                {/* Only the non-strict ones. A wrong money or authorization value
                    costs a denial or treatment without cover, so those are signed
                    for one at a time. */}
                {g.id === "autofill" && g.items.some((s) => !s.strict) && (
                  <button className="btn btn-dark btn-xs"
                    onClick={() => onAccept(g.items.filter((s) => !s.strict).map((s) => s.key))}>
                    Accept {g.items.filter((s) => !s.strict).length}
                  </button>
                )}
              </div>
              {g.items.map((s) => (
                <Row key={s.key} s={s} onUse={onUse} onKeep={onKeep} onBypass={onBypass}
                  onAccept={onAccept} onReject={onReject} onUseSuggestion={onUseSuggestion}
                  onResolve={onResolve} onClose={onClose} />
              ))}
            </div>
          ))}
        </div>
        <div className="actionbar">
          {/* The label is the record's summary — the operator should be able to
              read what they are signing. */}
          <button className="btn btn-primary" disabled={blockers > 0} onClick={onSaveAnyway}>
            {[attested ? `${attested} accepted` : "", exceptions ? `${exceptions} exception${exceptions > 1 ? "s" : ""}` : ""]
              .filter(Boolean).length
              ? `Save — ${[attested ? `${attested} accepted` : "", exceptions ? `${exceptions} exception${exceptions > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ")}`
              : "Save & generate PDF"}
          </button>
          <div className="spacer"></div>
          <button className="btn btn-ghost" onClick={onClose}>Keep editing</button>
        </div>
      </div>
    </div>
  );
}
