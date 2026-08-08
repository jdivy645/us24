import { useEffect, useRef, useState } from "react";

// Call recordings are transcribed upstream (RingCentral/RingSense, or the payer
// portal) and the transcript is what reaches this app. Accept the text formats
// those exports actually produce; parsing happens in lib/transcriptParse.js.
const TRANSCRIPT_ACCEPT = ".txt,.text,.log,.vtt,.srt,text/plain,text/vtt";

const ROLE_LABEL = { rep: "insurance rep", agent: "our side", ivr: "phone menu", unknown: "unidentified" };
const FORMAT_LABEL = { ringcentral: "RingCentral export", vtt: "captions (VTT/SRT)", labelled: "speaker-labelled", plain: "plain text" };

export default function CallMediaPanel({ upload, parsed, queue, onTranscriptFiles, onPaste, onClearTranscript, onDownloadText, onPickQueued, onSetRole }) {
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
          </div>
        )}

        <div className="rec-transcript" ref={boxRef} style={{ marginTop: 12, marginBottom: 0 }}>
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
