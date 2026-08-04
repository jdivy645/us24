import { useMemo, useRef, useState } from "react";
import { F, collect, dash, initialForm, clearedForm, sampleForm } from "./data/fields.js";
import { load, store } from "./lib/storage.js";
import { makePDF } from "./lib/pdf.js";
import { exportExcel } from "./lib/excel.js";
import { vobName, downloadBlob, downloadText } from "./lib/files.js";
import { putAudio, getAudio, delAudio, clearAudio } from "./lib/audioStore.js";
import { checkTranscript } from "./lib/verify.js";
import { checkCompleteness, recordCompleteness } from "./lib/completeness.js";
import { downloadTranscriptTxt } from "./lib/transcriptFile.js";
import useTranscriber from "./hooks/useTranscriber.js";
import VerificationForm from "./components/VerificationForm.jsx";
import PreviewDoc from "./components/PreviewDoc.jsx";
import LogTable from "./components/LogTable.jsx";
import Toasts from "./components/Toast.jsx";
import CallMediaPanel from "./components/CallMediaPanel.jsx";
import VerifyPanel from "./components/VerifyPanel.jsx";
import TranscriptView from "./components/TranscriptView.jsx";

const VERDICT_PILL = { APPROVED: "ok", REJECTED: "bad" };
const NO_UPLOAD = { blob: null, name: "", transcript: "", transcriptName: "" };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [records, setRecords] = useState(load);
  const [tab, setTab] = useState("form");
  const [errs, setErrs] = useState(() => new Set());
  const [toasts, setToasts] = useState([]);
  const [viewIdx, setViewIdx] = useState(-1);
  const [upload, setUpload] = useState(NO_UPLOAD);
  const toastId = useRef(0);
  const savingRef = useRef(false);
  const tr = useTranscriber();

  const toast = (msg, type = "good") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  const set = (k, val) => setForm((f) => ({ ...f, [k]: val }));
  const v = collect(form);
  // A supplied transcript always wins — audio is only converted when none was given.
  const transcript = upload.transcript || tr.finalText;
  const liveResult = useMemo(() => checkTranscript(v, transcript), [form, transcript]); // eslint-disable-line react-hooks/exhaustive-deps
  const comp = useMemo(() => checkCompleteness(v), [form]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = () => {
    const missing = ["lastName", "firstName", "insName"].filter((k) => !v[k]);
    setErrs(new Set(missing));
    if (missing.length) {
      toast("Add patient name and insurance to continue", "bad");
      return false;
    }
    return true;
  };

  // store() stays outside the updater: React may run an updater twice, and a
  // storage error thrown in there would tear down the whole app.
  const saveRecords = (next) => {
    setRecords((prev) => {
      const r = typeof next === "function" ? next(prev) : next;
      try { store(r); } catch { toast("Saved in this session, but the browser store is full", "bad"); }
      return r;
    });
  };

  const handlePreviewPDF = () => {
    if (!validate()) return;
    makePDF(v);
    toast(comp.incomplete ? `PDF generated — ${comp.blank.length} required field(s) still blank` : "PDF generated",
      comp.incomplete ? "warn" : "good");
  };

  const handleAudioFile = (file) => {
    if (file.size === 0) { toast("That audio file is empty", "bad"); return; }
    tr.reset(); // a previous file's transcript must not linger against a new recording
    setUpload((u) => ({ ...u, blob: file, name: file.name }));
    toast(`Audio attached: ${file.name}`);
  };

  const handleTranscriptFile = async (file) => {
    const text = (await file.text()).trim();
    if (!text) { toast("That transcript file is empty", "bad"); return; }
    setUpload((u) => ({ ...u, transcript: text, transcriptName: file.name }));
    toast(`Transcript attached: ${file.name}`);
  };

  // Name the text file after the audio it came from, else after the patient.
  const textName = () => {
    const base = upload.name ? upload.name.replace(/\.[^.]+$/, "") : "";
    return `${base || vobName(v)}_TRANSCRIPT.txt`;
  };

  const handleDownloadText = (text) => {
    if (!text.trim()) { toast("There is no transcript to save yet", "bad"); return; }
    downloadText(text, textName());
    toast("Transcript saved as .txt");
  };

  const handleTranscribed = (text, cancelled) => {
    if (!text.trim()) { toast(cancelled ? "Stopped before any speech was transcribed" : "No speech was recognised in that audio", "bad"); return; }
    downloadText(text, textName());
    toast(cancelled ? "Stopped — partial transcript .txt downloaded" : "Audio converted — transcript .txt downloaded");
  };

  const handlePaste = (text) => {
    const t = text.trim();
    if (!t) { toast("Nothing pasted", "bad"); return; }
    setUpload((u) => ({ ...u, transcript: t, transcriptName: "" }));
    toast("Transcript attached");
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (tr.active) { toast("Wait for the transcript to finish, or cancel it first", "bad"); return; }
    if (!validate()) return;
    // Audio attached but never converted would silently save as NO AUDIO
    if (upload.blob && !upload.transcript && !tr.text.trim() &&
      !window.confirm("This audio has not been transcribed, so nothing can be verified. Save anyway?")) return;
    savingRef.current = true;
    try {
      const media = tr.result();
      const blob = upload.blob || null;
      const text = (upload.transcript || media?.transcript || "").trim();
      const source = [
        blob ? "uploaded audio" : "",
        upload.transcript ? (upload.transcriptName ? "uploaded transcript" : "pasted transcript")
          : media?.transcript ? "transcribed from the audio" : "",
      ].filter(Boolean).join(" + ");

      const fn = makePDF(v);
      const res = checkTranscript(v, text);
      const _id = newId();
      const recRow = {
        ...v, _id, _savedAt: new Date().toLocaleString(), _file: fn,
        _verdict: res.verdict, _matched: res.matched, _total: res.total,
        _missing: res.checks.filter((c) => !c.soft && c.status === "missing").map((c) => c.label),
        _mismatch: res.checks.filter((c) => c.status === "mismatch").map((c) => `${c.label}: form "${c.value}" — call "${c.heard}"`),
        _blank: comp.blank.map((f) => f.label), _blankCount: comp.blank.length, _required: comp.required,
        _transcript: text, _source: source,
        _audioFile: blob ? upload.name : "",
      };
      if (blob) await putAudio(_id, blob).catch(() => {}); // uploaded file is already on disk
      if (text) downloadTranscriptTxt(recRow, text, res);
      saveRecords((prev) => [recRow, ...prev]);
      tr.reset();
      setUpload(NO_UPLOAD);
      const base =
        res.verdict === "APPROVED" ? `Saved — APPROVED, all ${res.total} details matched`
          : res.verdict === "REJECTED" ? `Saved — REJECTED, ${res.mismatched.length} contradicted, ${res.missing.length} not heard`
            : res.verdict === "UNVERIFIED" ? "Saved — nothing to verify against the transcript"
              : "Saved — no audio or transcript, verification skipped";
      toast(comp.incomplete ? `${base} · INCOMPLETE, ${comp.blank.length} required field(s) blank` : base,
        res.verdict === "REJECTED" ? "bad" : comp.incomplete ? "warn" : "good");
    } catch (e) {
      toast("Save failed: " + (e?.message || e), "bad");
    } finally {
      savingRef.current = false;
    }
  };

  const handleClear = () => {
    if (!window.confirm("Clear all fields in this form?")) return;
    setForm(clearedForm());
    toast("Form cleared");
  };

  const handleLoadSample = () => {
    setForm(sampleForm());
    toast("Sample loaded");
  };

  const handleExport = () => {
    if (!records.length) { toast("No records to export", "bad"); return; }
    exportExcel(records);
    toast(`Exported ${records.length} record${records.length > 1 ? "s" : ""} to Excel`);
  };

  const handleOpen = (i) => {
    const r = records[i];
    setForm((f) => {
      const n = { ...f };
      F.forEach((k) => { if (r[k] !== undefined) n[k] = r[k]; });
      return n;
    });
    setTab("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("Record loaded into the form");
  };

  const handleDelete = (i) => {
    const r = records[i];
    if (r._id) delAudio(r._id).catch(() => {});
    setViewIdx(-1);
    saveRecords((prev) => prev.filter((x) => x !== r));
    toast("Record deleted");
  };

  const handleClearAll = () => {
    if (!window.confirm("Delete all saved records? Export to Excel first if you need them.")) return;
    clearAudio().catch(() => {});
    setViewIdx(-1);
    saveRecords([]);
    toast("All records cleared");
  };

  const handleAudio = (i) => {
    const r = records[i];
    getAudio(r._id)
      .then((b) => b ? downloadBlob(b, r._audioFile || "call_audio.webm") : toast("Audio not found in this browser", "bad"))
      .catch(() => toast("Audio not found in this browser", "bad"));
  };

  const viewRec = viewIdx >= 0 ? records[viewIdx] : null;
  // Audio-only upload is a plain conversion job: transcribe it, no on-screen
  // checklist — the verdict still lands on the saved record.
  const audioOnly = !!upload.blob && !upload.transcript;

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">US<span>24</span> SOLUTIONS</div>
          <div className="brand-rule"></div>
          <div className="brand-tag">Verification of Benefits</div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-light btn-sm" onClick={handleExport}>Download Excel log</button>
        </div>
      </div>

      <div className="tabs">
        <button className={"tab" + (tab === "form" ? " active" : "")} onClick={() => setTab("form")}>
          New verification
        </button>
        <button className={"tab" + (tab === "log" ? " active" : "")} onClick={() => setTab("log")}>
          Saved records <span className="count">{records.length}</span>
        </button>
      </div>

      <div className={"wrap" + (tab !== "form" ? " hidden" : "")}>
        <div className="split">
          <div>
            <CallMediaPanel
              tr={tr}
              upload={upload}
              onAudioFile={handleAudioFile}
              onTranscriptFile={handleTranscriptFile}
              onPaste={handlePaste}
              onClearAudio={() => { tr.reset(); setUpload((u) => ({ ...u, blob: null, name: "" })); }}
              onClearTranscript={() => setUpload((u) => ({ ...u, transcript: "", transcriptName: "" }))}
              onTranscribed={handleTranscribed}
              onDownloadText={handleDownloadText}
            />
            <VerificationForm
              form={form}
              set={set}
              errs={errs}
              onSave={handleSave}
              onPreviewPDF={handlePreviewPDF}
              onClear={handleClear}
              onLoadSample={handleLoadSample}
            />
          </div>
          <div className="preview-shell">
            {!audioOnly && <VerifyPanel result={liveResult} comp={comp} active={tr.active} hasTranscript={!!transcript.trim()} />}
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-head">
                <div>
                  <h2>Live preview</h2>
                  <p>Matches the generated PDF.</p>
                </div>
              </div>
            </div>
            <PreviewDoc v={v} />
          </div>
        </div>
      </div>

      <div className={"wrap" + (tab !== "log" ? " hidden" : "")}>
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
          <div className="tbl-wrap">
            <LogTable
              records={records}
              onOpen={handleOpen}
              onDelete={handleDelete}
              onTranscript={setViewIdx}
              onAudio={handleAudio}
            />
          </div>
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
                <span className={"pill " + (VERDICT_PILL[viewRec._verdict] || "na")}>{viewRec._verdict || "NO AUDIO"}</span>
                {recordCompleteness(viewRec).incomplete && (
                  <span className="pill warn" title={recordCompleteness(viewRec).blank.join(", ")}>
                    INCOMPLETE {recordCompleteness(viewRec).count}
                  </span>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => downloadTranscriptTxt(viewRec, viewRec._transcript || "", checkTranscript(viewRec, viewRec._transcript || ""))}
                >
                  Download .txt
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewIdx(-1)}>Close</button>
              </div>
            </div>
            <div className="card-body">
              <TranscriptView v={viewRec} transcript={viewRec._transcript || ""} />
            </div>
          </div>
        </div>
      )}

      <Toasts toasts={toasts} />
    </>
  );
}
