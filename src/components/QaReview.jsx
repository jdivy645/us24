import { useEffect, useState } from "react";
import * as db from "../lib/db.js";
import { F, HEAD, dash, fmtDate } from "../data/fields.js";
import { PRIORITIES, PRIORITY_LABEL, STATUS, ERROR_CATEGORIES, ERROR_POINTS, recordScore, actionsFor, refusal } from "../lib/workflow.js";
import PreviewDoc from "./PreviewDoc.jsx";
import TranscriptView from "./TranscriptView.jsx";

const priorityClass = (p) => (p === "P1" ? "bad" : p === "P2" || p === "P3" ? "warn" : "ok");

const ACTION_LABEL = {
  submit: "Send to QA",
  pickUp: "Pick up",
  pass: "Pass — no changes needed",
  return: "Return to the operator",
  reopen: "Reopen",
};

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");

// A second person reading a finished record beside the call it came from.
//
// The form is deliberately read-only here. QA's job is to say what is wrong, not to
// fix it quietly: a correction made by the checker and never seen by the operator
// is the same mistake again next week.
export default function QaReview({ record, currentUser, onClose, onChanged, toast }) {
  const [errors, setErrors] = useState(record._errors || []);
  const [comments, setComments] = useState(record._comments || []);
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState({ priority: "P2", category: "WRONG_DATA", fieldKey: "", note: "" });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const role = currentUser?.role || "agent";
  const by = currentUser?.name || "";
  const status = record._status || "finished";

  useEffect(() => {
    let live = true;
    db.getTranscript(record._id).then((t) => { if (live) setTranscript(t || ""); }).catch(() => {});
    return () => { live = false; };
  }, [record._id]);

  const reload = async () => {
    const [e, c] = await Promise.all([db.listErrors({ versionId: record._id }), db.listComments(record._id)]);
    setErrors(e);
    setComments(c);
  };

  const addError = async () => {
    if (draft.priority !== "NONE" && !draft.note.trim()) {
      toast("Say what is wrong — a priority with no note is not a finding", "bad");
      return;
    }
    await db.addError({ versionId: record._id, ...draft, by });
    setDraft({ priority: "P2", category: "WRONG_DATA", fieldKey: "", note: "" });
    await reload();
    await onChanged?.();
    toast("Finding logged");
  };

  const removeError = async (id) => {
    // Deleting takes the finding out of the quality score. Marking it fixed does
    // not — which is why "reopen" exists rather than delete-and-retype.
    if (!window.confirm("Delete this finding? It will stop counting against the quality score.")) return;
    await db.deleteError(id);
    await reload();
    await onChanged?.();
  };

  const reopen = async (id) => {
    await db.reopenError(id);
    await reload();
    await onChanged?.();
    toast("Finding reopened");
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    await db.addComment({ versionId: record._id, text: comment, by });
    setComment("");
    await reload();
    await onChanged?.();
  };

  const act = async (action) => {
    setBusy(true);
    try {
      // Passing a record is itself a finding — "someone looked and found nothing"
      // is a fact worth keeping, and an empty error list cannot say it.
      if (action === "pass" && !errors.length) {
        await db.addError({ versionId: record._id, priority: "NONE", note: "Checked — no errors found", by });
      }
      const out = await db.setStatus(record._id, action, { by, role, note: "" });
      if (out.status === "refused") { toast(out.reason, "bad"); return; }
      if (out.status === "not-found") { toast("That record is no longer here", "bad"); return; }
      await reload();
      await onChanged?.();
      toast(`${dash(record.lastName)} — ${STATUS[out.workflow.status].toLowerCase()}`);
      if (action === "pass" || action === "return") onClose();
    } catch (e) {
      toast("Could not update the record: " + (e?.message || e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const available = actionsFor(status, role);
  const returnWhy = refusal("return", { status, role, errors });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <div>
            <h2>QA — {dash(record.lastName)}, {dash(record.firstName)}</h2>
            <p>
              {dash(record.projectName)} · {dash(record.insName)} · verified {fmtDate(record.today) || "—"}
              {record.username ? ` · entered by ${record.username}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="pill warn">{STATUS[status] || status}</span>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="card-body">
          <div className="qa-split">
            <div>
              <div className="section-label">What QA found</div>

              {!errors.length && <p className="hint">Nothing logged against this record yet.</p>}
              {errors.length > 0 && (
                <p className="hint">
                  Quality score {recordScore(errors)} / 100 — {ERROR_POINTS.P1} points for a P1,
                  {" "}{ERROR_POINTS.P2} for a P2, {ERROR_POINTS.P3} for a P3.
                </p>
              )}
              {errors.map((e) => (
                <div key={e.id} className="rg-row">
                  <div className="rg-main">
                    <span className="rg-label">
                      <span className={"pill " + priorityClass(e.priority)}>{e.priority}</span>{" "}
                      {e.fieldKey ? HEAD[e.fieldKey] || e.fieldKey : "Whole record"}
                      {e.resolvedAt && <span className="pill ok rg-pill">fixed</span>}
                    </span>
                    <span className="rg-detail">
                      {ERROR_CATEGORIES[e.category] ? `${ERROR_CATEGORIES[e.category]} · ` : ""}
                      {e.note || PRIORITY_LABEL[e.priority]} — {e.by || "unknown"}, {when(e.at)}
                      {e.resolvedAt ? ` · fixed by ${e.resolvedBy || "unknown"}, ${when(e.resolvedAt)}` : ""}
                    </span>
                  </div>
                  <div className="rg-acts">
                    {e.resolvedAt
                      ? <button className="btn btn-ghost btn-sm" onClick={() => reopen(e.id)}>Reopen</button>
                      : null}
                    <button className="btn btn-ghost btn-sm" onClick={() => removeError(e.id)}>Remove</button>
                  </div>
                </div>
              ))}

              <div className="qa-entry">
                <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} aria-label="Priority">
                  {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </select>
                {/* What kind of mistake, not just how bad. Without it the dashboard
                    can say a team makes ten P2s a week but not what they are. */}
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label="Category">
                  {Object.entries(ERROR_CATEGORIES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                {/* Naming the field is what puts the finding on the operator's form
                    when the record comes back to them. */}
                <select value={draft.fieldKey} onChange={(e) => setDraft({ ...draft, fieldKey: e.target.value })} aria-label="Field">
                  <option value="">Whole record</option>
                  {F.map((k) => <option key={k} value={k}>{HEAD[k] || k}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="What is wrong, and what it should be"
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && addError()}
                  aria-label="Finding"
                />
                <button className="btn btn-dark btn-sm" onClick={addError}>Log it</button>
              </div>

              <div className="section-label">Comments</div>
              {!comments.length && <p className="hint">No comments yet.</p>}
              {comments.map((c) => (
                <div key={c.id} className="qa-comment">
                  <div className="qa-comment-head">{c.by || "unknown"} · {when(c.at)}</div>
                  <div>{c.text}</div>
                </div>
              ))}
              <div className="qa-entry">
                <input
                  type="text"
                  placeholder="Add a comment — it cannot be edited afterwards"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addComment()}
                  aria-label="New comment"
                />
                <button className="btn btn-ghost btn-sm" onClick={addComment}>Comment</button>
              </div>

              {record._workflow?.history?.length > 1 && (
                <>
                  <div className="section-label">History</div>
                  {record._workflow.history.map((h, i) => (
                    <div key={i} className="hint">
                      {STATUS[h.to] || h.to}{h.by ? ` — ${h.by}` : ""} · {when(h.at)}
                    </div>
                  ))}
                </>
              )}
            </div>

            <div>
              <div className="section-label">The record as saved</div>
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
          {available.includes("pickUp") && (
            <button className="btn btn-dark" disabled={busy} onClick={() => act("pickUp")}>{ACTION_LABEL.pickUp}</button>
          )}
          {available.includes("pass") && (
            <button className="btn btn-primary" disabled={busy} onClick={() => act("pass")}>{ACTION_LABEL.pass}</button>
          )}
          {available.includes("return") && (
            <button className="btn btn-dark" disabled={busy || !!returnWhy} title={returnWhy || ""} onClick={() => act("return")}>
              {ACTION_LABEL.return}
            </button>
          )}
          {available.includes("submit") && (
            <button className="btn btn-primary" disabled={busy} onClick={() => act("submit")}>{ACTION_LABEL.submit}</button>
          )}
          {available.includes("reopen") && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => act("reopen")}>{ACTION_LABEL.reopen}</button>
          )}
          {returnWhy && available.includes("return") && <span className="hint">{returnWhy}</span>}
          <div className="spacer"></div>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
