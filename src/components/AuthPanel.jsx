import { useEffect, useState } from "react";
import * as db from "../lib/db.js";
import { dash, fmtDate, AUTH_STATUSES } from "../data/fields.js";
import { STATUS, refusal } from "../lib/workflow.js";
import PreviewDoc from "./PreviewDoc.jsx";
import TranscriptView from "./TranscriptView.jsx";

// The authorization stage: the record is verified, the payer said an authorization
// is required, and somebody now has to go and get one.
//
// Only the authorization fields are editable. Everything else on the record was
// established on the call and checked against it — reopening it here would let an
// unrelated value be changed with no transcript to answer to.
const FIELDS = [
  { key: "authStatus", label: "Outcome", type: "select", options: AUTH_STATUSES, hint: "What the payer came back with" },
  { key: "authNum", label: "Authorization #", type: "text" },
  { key: "authDates", label: "Auth coverage dates", type: "text", hint: "e.g. 08/12/2026 – 11/12/2026" },
  { key: "authAfter", label: "Auth required after visit #", type: "text" },
  { key: "authHow", label: "How it was obtained", type: "text", hint: "Portal, fax, phone" },
  { key: "authWindow", label: "Request window from DOS", type: "text" },
];

const outcomeClass = (s) => (s === "APPROVED" ? "ok" : s === "DENIED" ? "bad" : s === "PENDING" ? "warn" : "na");

export default function AuthPanel({ record, currentUser, onClose, onChanged, toast }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, record[f.key] || ""])));
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const role = currentUser?.role || "agent";
  const by = currentUser?.name || "";
  const status = record._status || "auth_pending";

  useEffect(() => {
    let live = true;
    db.getTranscript(record._id).then((t) => { if (live) setTranscript(t || ""); }).catch(() => {});
    return () => { live = false; };
  }, [record._id]);

  const set = (k, val) => { setDraft((d) => ({ ...d, [k]: val })); setDirty(true); };

  const save = async () => {
    setBusy(true);
    try {
      await db.updateAuth(record._id, draft, { by });
      setDirty(false);
      await onChanged?.();
      toast("Authorization details saved");
    } catch (e) {
      toast("Could not save: " + (e?.message || e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const sendOn = async () => {
    setBusy(true);
    try {
      // Saved first, always: the gate reads the stored record, so sending on with
      // an unsaved outcome would be refused for a value that is on screen.
      await db.updateAuth(record._id, draft, { by });
      const out = await db.setStatus(record._id, "authDone", { by, role });
      if (out.status === "refused") { toast(out.reason, "bad"); return; }
      if (out.status === "not-found") { toast("That record is no longer here", "bad"); return; }
      await onChanged?.();
      toast(`${dash(record.lastName)} — authorization ${String(draft.authStatus).toLowerCase()}, now awaiting QA`);
      onClose();
    } catch (e) {
      toast("Could not send it on: " + (e?.message || e), "bad");
    } finally {
      setBusy(false);
    }
  };

  // Checked against the draft rather than the saved record, so the button explains
  // itself before anything is written.
  const why = refusal("authDone", { status, role, authOutcome: draft.authStatus });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <div>
            <h2>Authorization — {dash(record.lastName)}, {dash(record.firstName)}</h2>
            <p>
              {dash(record.projectName)} · {dash(record.insName)} · verified {fmtDate(record.today) || "—"}
              {record.authEval === "YES" ? " · required for the initial eval" : ""}
              {record.authTx === "YES" ? " · required for treatment" : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={"pill " + outcomeClass(draft.authStatus)}>{draft.authStatus || "NOT SET"}</span>
            <span className="pill warn">{STATUS[status] || status}</span>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="card-body">
          <div className="qa-split">
            <div>
              <div className="section-label">What the payer came back with</div>
              <div className="grid">
                {FIELDS.map((f) => (
                  <div className="f" key={f.key}>
                    <label htmlFor={"auth-" + f.key}>{f.label}</label>
                    {f.type === "select" ? (
                      <select id={"auth-" + f.key} value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                        <option value="">— select —</option>
                        {f.options.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input id={"auth-" + f.key} type="text" value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                    )}
                    {f.hint && <span className="hint">{f.hint}</span>}
                  </div>
                ))}
              </div>

              <p className="hint" style={{ marginTop: 12 }}>
                A denial sends the record on just as an approval does — the answer is what
                matters, and a denied authorization is an answer.
              </p>

              {record._workflow?.history?.length > 1 && (
                <>
                  <div className="section-label">History</div>
                  {record._workflow.history.map((h, i) => (
                    <div key={i} className="hint">
                      {STATUS[h.to] || h.to}{h.by ? ` — ${h.by}` : ""} · {h.at ? new Date(h.at).toLocaleString() : ""}
                    </div>
                  ))}
                </>
              )}
            </div>

            <div>
              <div className="section-label">The verification this belongs to</div>
              <PreviewDoc v={record} meta={record._meta || {}} />
              {transcript ? (
                <>
                  <div className="section-label">The call</div>
                  <TranscriptView v={record} transcript={transcript} meta={record._meta} />
                </>
              ) : (
                <p className="hint">No transcript was attached to this verification.</p>
              )}
            </div>
          </div>
        </div>

        <div className="actionbar">
          <button className="btn btn-primary" disabled={busy || !!why} title={why || ""} onClick={sendOn}>
            Send to QA
          </button>
          <button className="btn btn-ghost" disabled={busy || !dirty} onClick={save}>Save and keep chasing</button>
          {why && <span className="hint">{why}</span>}
          <div className="spacer"></div>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
