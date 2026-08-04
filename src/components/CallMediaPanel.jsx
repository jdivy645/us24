import { useEffect, useRef, useState } from "react";

const mmss = (s) => `${String((s / 60) | 0).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Windows resolves audio/* through registry MIME associations, so .m4a/.opus/.aac
// and friends vanish from the file dialog. List extensions explicitly too.
const AUDIO_ACCEPT = "audio/*,video/*,.mp3,.m4a,.wav,.webm,.ogg,.oga,.opus,.aac,.amr,.wma,.flac,.mp4,.3gp,.m4b,.caf";

export default function CallMediaPanel({ tr, upload, onAudioFile, onTranscriptFile, onPaste, onClearAudio, onClearTranscript, onTranscribed, onDownloadText }) {
  const boxRef = useRef(null);
  const audioRef = useRef(null);
  const [url, setUrl] = useState("");
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!upload.blob) { setUrl(""); return; }
    const u = URL.createObjectURL(upload.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [upload.blob]);

  const shown = upload.transcript || tr.text;
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown]);

  const pickFile = (handler) => (e) => {
    const file = e.target.files?.[0];
    if (file) handler(file);
    e.target.value = ""; // allow re-picking the same file
  };

  const stage =
    tr.status === "decoding" ? "Reading the audio file…"
      : tr.status === "loading" ? `Loading the speech model ${tr.pct}%${tr.device === "wasm" ? " (no GPU — this will be slower)" : ""}`
        : tr.status === "running" ? `Transcribing ${mmss(tr.seconds)} of ${mmss(tr.duration)}${tr.device === "wasm" ? " (no GPU — slower)" : ""}`
          : "";

  const source = upload.transcript
    ? (upload.transcriptName ? `Using transcript file: ${upload.transcriptName}` : "Using the pasted transcript")
    : tr.status === "done" && tr.text ? "Transcribed from the uploaded audio"
      : "";

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div>
          <h2>Call audio &amp; transcript</h2>
          <p>Attach the call recording. A transcript is written only if you don't provide one.</p>
        </div>
        {tr.status === "done" && tr.text && <span className="pill ok">Transcribed</span>}
      </div>
      <div className="card-body">
        <div className="rec-bar" style={{ flexWrap: "wrap" }}>
          <label className={"btn btn-dark btn-sm" + (tr.active ? " disabled" : "")}>
            Upload audio
            <input type="file" accept={AUDIO_ACCEPT} className="hidden" disabled={tr.active} onChange={pickFile(onAudioFile)} />
          </label>
          <label className="btn btn-ghost btn-sm">
            Upload transcript (.txt)
            <input type="file" accept=".txt,.text,.log,text/plain" className="hidden" onChange={pickFile(onTranscriptFile)} />
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => { setDraft(upload.transcript || ""); setPasting(!pasting); }}>
            {pasting ? "Close paste box" : "Paste transcript"}
          </button>
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

        {(upload.blob || upload.transcript) && (
          <div className="rec-files">
            {upload.blob && (
              <div className="rec-file">
                <span className="rec-file-name">🎧 {upload.name}</span>
                {url && <audio ref={audioRef} src={url} controls preload="metadata" />}
                {upload.transcript ? (
                  <span className="hint">Transcript supplied — no conversion needed</span>
                ) : tr.active ? (
                  <button className="btn btn-primary btn-sm" onClick={tr.cancel}>Cancel</button>
                ) : (
                  <button className="btn btn-dark btn-sm" onClick={() => tr.transcribe(upload.blob, onTranscribed)}>
                    {tr.text ? "Transcribe again" : "Transcribe this audio"}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={onClearAudio} disabled={tr.active}>Remove</button>
              </div>
            )}
            {upload.transcript && (
              <div className="rec-file">
                <span className="rec-file-name">📄 {upload.transcriptName || "Pasted transcript"}</span>
                <span className="hint">{upload.transcript.length.toLocaleString()} characters — used for verification</span>
                <button className="btn btn-ghost btn-sm" onClick={onClearTranscript}>Remove</button>
              </div>
            )}
          </div>
        )}

        {tr.active && (
          <div className="prog-wrap">
            <div className="prog"><div className="prog-bar" style={{ width: `${tr.pct}%` }}></div></div>
            <p className="hint">{stage}</p>
          </div>
        )}
        {tr.status === "error" && <p className="hint bad" style={{ marginTop: 10 }}>{tr.error}</p>}

        <div className="rec-transcript" ref={boxRef} style={{ marginTop: 12, marginBottom: 0 }}>
          {shown || <span className="hint">The transcript appears here — attach a transcript, or upload audio and convert it.</span>}
        </div>
        {shown && (
          <div className="rec-bar" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => onDownloadText(shown)}>Download transcript (.txt)</button>
            <span className="hint">{shown.trim().split(/\s+/).length.toLocaleString()} words</span>
          </div>
        )}
        {source && <p className="hint" style={{ marginTop: 10 }}>{source}</p>}
        <p className="hint" style={{ marginTop: 6 }}>
          Speech runs entirely on this computer — the recording is never uploaded. The model downloads once (about 50–90 MB) and is reused afterwards.
        </p>
      </div>
    </div>
  );
}
