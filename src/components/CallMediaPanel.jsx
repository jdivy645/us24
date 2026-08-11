import { useEffect, useRef, useState } from "react";

// Call recordings are transcribed upstream (RingCentral/RingSense, or the payer
// portal) and the transcript is what reaches this app. Accept the text formats
// those exports actually produce; parsing happens in lib/transcriptParse.js.
const TRANSCRIPT_ACCEPT = ".txt,.text,.log,.vtt,.srt,text/plain,text/vtt";

const ROLE_LABEL = { rep: "insurance rep", agent: "our side", ivr: "phone menu", unknown: "unidentified" };
const FORMAT_LABEL = { ringcentral: "RingCentral export", vtt: "captions (VTT/SRT)", teams: "Teams transcript", labelled: "speaker-labelled", plain: "plain text" };

import { HEAD } from "../data/fields.js";

const jumpTo = (key) => {
  const el = document.getElementById("f-" + key);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1200);
};

export default function CallMediaPanel({
  upload, parsed, queue, onTranscriptFiles, onPaste, onClearTranscript, onDownloadText,
  onPickQueued, onSetRole, attributed, readCall, onReadCall, onClearRead, onUseSuggestion,
  pendingCount = 0, onAcceptAll, onUseAllSuggestions,
}) {
  // Values the call offered but did not write in. Listed apart from the filled ones
  // because the two need different actions: a filled value needs accepting, an
  // offered one needs putting in.
  const suggestions = Object.values(readCall?.suggest || {});
  const boxRef = useRef(null);
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);

  const shown = upload.transcript;
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = 0;
  }, [shown]);

  const pickFile = (e) => {
    const files = [...(e.target.files || [])];
    if (files.length) onTranscriptFiles(files);
    e.target.value = ""; // allow re-picking the same file
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) onTranscriptFiles(files);
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div>
          <h2>Call transcript</h2>
          <p>Attach the transcript of the benefits call. Every typed value is checked against it.</p>
        </div>
        {shown && <span className="pill ok">Attached</span>}
      </div>
      <div className="card-body">
        <div
          className={"drop" + (dragging ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="rec-bar" style={{ flexWrap: "wrap" }}>
            <label className="btn btn-dark btn-sm">
              Upload transcript
              <input type="file" multiple accept={TRANSCRIPT_ACCEPT} className="hidden" onChange={pickFile} />
            </label>
            <button className="btn btn-ghost btn-sm" onClick={() => { setDraft(upload.transcript || ""); setPasting(!pasting); }}>
              {pasting ? "Close paste box" : "Paste transcript"}
            </button>
            <span className="hint">…or drop a file here</span>
          </div>
        </div>

        {pasting && (
          <div className="f" style={{ marginTop: 10 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste the call transcript here…"
              style={{ minHeight: 90 }}
            />
            <div className="rec-bar" style={{ marginTop: 8 }}>
              <button className="btn btn-dark btn-sm" onClick={() => { onPaste(draft); setPasting(false); }}>Use this transcript</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setDraft(""); setPasting(false); }}>Cancel</button>
            </div>
          </div>
        )}

        {queue.length > 0 && (
          <div className="rec-files">
            <div className="q-head">Queued — {queue.length} more to verify</div>
            {queue.map((q, i) => (
              <div key={q.name + i} className="rec-file">
                <span className="rec-file-name">📄 {q.name}</span>
                <span className="hint">{q.text.length.toLocaleString()} characters</span>
                <button className="btn btn-ghost btn-sm" onClick={() => onPickQueued(i)}>Verify this next</button>
              </div>
            ))}
          </div>
        )}

        {shown && (
          <div className="rec-files">
            <div className="rec-file">
              <span className="rec-file-name">📄 {upload.transcriptName || "Pasted transcript"}</span>
              <span className="hint">{shown.length.toLocaleString()} characters — used for verification</span>
              <button className="btn btn-ghost btn-sm" onClick={onClearTranscript}>Remove</button>
            </div>
          </div>
        )}

        {/* What the parser made of the file. A misread shows up here rather than
            as mysteriously failing verification. */}
        {parsed && (
          <div className="parse-sum">
            <div className="ps-row">
              <span className="ps-k">Read as</span>
              <span className="ps-v">{FORMAT_LABEL[parsed.format] || parsed.format}</span>
              {parsed.turns.length > 1 && <span className="hint">{parsed.turns.length} turns</span>}
            </div>
            {/* Shown even with nothing to correct. Telling an operator their
                transcript has no payer in it and then withholding the control that
                would fix it is the bug this panel already fixed once, for the
                colon formats. */}
            {parsed.speakers.length === 0 && (
              <div className="ps-row">
                <span className="ps-k">Speakers</span>
                <span className="hint">
                  None found — this file has no speaker labels. Re-export it with them if you can.
                </span>
              </div>
            )}
            {parsed.speakers.length > 0 && (
              <div className="ps-row">
                <span className="ps-k">Speakers</span>
                {parsed.speakers.map((s) => (
                  <span key={s.name} className={"ps-spk r-" + s.role}>
                    {s.name}
                    <select value={s.role} onChange={(e) => onSetRole(s.name, e.target.value)} title="Only the rep's words confirm a value">
                      {["rep", "agent", "unknown"].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </span>
                ))}
              </div>
            )}
            {parsed.warnings.map((w) => <p key={w} className="hint warn-text">{w}</p>)}

            {/* Reading the call runs by itself when a transcript is attached, but
                it is also a button. An automatic action with no control is one an
                operator cannot retry after correcting who the payer is, and cannot
                tell apart from a feature that did nothing. */}
            <div className="ps-row" style={{ marginTop: 4 }}>
              <span className="ps-k">From the call</span>
              {!readCall ? (
                <span className="hint">Reading the call…</span>
              ) : (
                <>
                  <span className="pf-chip">
                    {readCall.counts.fill} filled
                    {readCall.counts.suggest ? ` · ${readCall.counts.suggest} to consider` : ""}
                    {readCall.counts.contested + readCall.counts.blocked ? ` · ${readCall.counts.contested + readCall.counts.blocked} left for you` : ""}
                  </span>
                  <button className="btn btn-dark btn-sm" onClick={onReadCall}>Fill the form from this call</button>
                  {/* One click for everything the call supports, because a good
                      transcript now fills thirty fields and signing for each in
                      turn is how a checklist becomes a reflex. The money and
                      authorization values are deliberately not in here — they stay
                      one at a time, where a wrong one costs a denial. */}
                  {pendingCount > 0 && (
                    <button className="btn btn-dark btn-sm" onClick={onAcceptAll}>
                      Accept all {pendingCount}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={onClearRead}>Clear what it wrote</button>
                </>
              )}
              {!attributed && (
                <span className="hint warn-text">
                  Nobody in this transcript is identified as the payer — a value read from it could be something our own side said. Check each one.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Everything the engine noticed, including where it filled nothing.
            Absence of a fill is not absence of information, and an operator who
            trusts a blank is the failure mode with no local signal. */}
        {parsed && readCall && (
          <div className="parse-sum" style={{ marginTop: 8 }}>
            <div className="rg-head">
              Written into the form <span className="count">{readCall.counts.fill}</span>
              <span className="rg-hint">Each one still has to be accepted before the record saves.</span>
            </div>
            {Object.values(readCall.fill).map((p) => (
              <div key={p.key} className="pull-row">
                <span className="pull-k">{HEAD[p.key] || p.key}</span>
                <b>{p.value}</b>
                <span className="hint">“{String(p.quote).slice(0, 70)}”</span>
                <button className="btn btn-ghost btn-xs" onClick={() => jumpTo(p.key)}>→ field</button>
              </div>
            ))}

            {/* These were heard but scored below the bar to write in by themselves.
                They used to be listed here with no way to act on them, so the only
                route into the form was to remember the value, find the field and
                type it — which is the work the panel exists to save. */}
            {suggestions.length > 0 && (
              <>
                <div className="rg-head" style={{ marginTop: 10 }}>
                  Offered, not written in <span className="count">{suggestions.length}</span>
                  <span className="rg-hint">Below the bar to fill on their own. Put them in if they look right.</span>
                  {suggestions.length > 1 && (
                    <button className="btn btn-dark btn-xs" onClick={() => onUseAllSuggestions?.(suggestions)}>
                      Use all {suggestions.length}
                    </button>
                  )}
                </div>
                {suggestions.map((p) => (
                  <div key={p.key} className="pull-row">
                    <span className="pull-k">{HEAD[p.key] || p.key}</span>
                    <b>{p.value}</b>
                    <span className="hint">{p.why || `“${String(p.quote).slice(0, 60)}”`}</span>
                    <button className="btn btn-dark btn-xs" onClick={() => onUseSuggestion(p)}>Use it</button>
                    <button className="btn btn-ghost btn-xs" onClick={() => jumpTo(p.key)}>→ field</button>
                  </div>
                ))}
              </>
            )}

            {(readCall.counts.contested + readCall.counts.blocked + Object.keys(readCall.agentOnly || {}).length) > 0 && (
              <>
                <div className="rg-head" style={{ marginTop: 10 }}>
                  Heard but not placed
                  <span className="count">{readCall.counts.contested + readCall.counts.blocked + Object.keys(readCall.agentOnly || {}).length}</span>
                  <span className="rg-hint">Noticed, deliberately not written in.</span>
                </div>
                {/* No one-click "Use it" here. These were held back BECAUSE
                    something did not add up — accepting one from this list would
                    land it pre-signed and it would never reach the review gate. */}
                {Object.values({ ...readCall.contested, ...readCall.blocked }).map((p) => (
                  <div key={p.key} className="pull-row">
                    <span className="pull-k">{HEAD[p.key] || p.key}</span>
                    <b>{p.value}</b>
                    <span className="hint warn-text">{p.why}</span>
                    <button className="btn btn-ghost btn-xs" onClick={() => jumpTo(p.key)}>→ field</button>
                  </div>
                ))}
                {Object.values(readCall.agentOnly || {}).map((p) => (
                  <div key={p.key} className="pull-row">
                    <span className="pull-k">{HEAD[p.key] || p.key}</span>
                    <b>{p.value}</b>
                    <span className="hint warn-text">only our side said this</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div id="call-transcript" className="rec-transcript" ref={boxRef} style={{ marginTop: 12, marginBottom: 0 }}>
          {shown || <span className="hint">The transcript appears here — upload a file, or paste the text.</span>}
        </div>
        {shown && (
          <div className="rec-bar" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => onDownloadText(shown)}>Download transcript (.txt)</button>
            <span className="hint">{shown.trim().split(/\s+/).length.toLocaleString()} words</span>
          </div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          Nothing leaves this computer — the transcript is read in the browser and stored locally.
        </p>
      </div>
    </div>
  );
}
