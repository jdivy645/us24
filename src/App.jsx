import { useEffect, useMemo, useRef, useState } from "react";
import { F, HEAD, collect, dash, initialForm, clearedForm, sampleForm } from "./data/fields.js";
import * as db from "./lib/db.js";
import { applyPrefill, clearPrefilled } from "./lib/prefill.js";
import { isOnFile } from "./lib/schema.js";
import { makePDF } from "./lib/pdf.js";
import { exportExcel } from "./lib/excel.js";
import { vobName, downloadBlob, downloadText } from "./lib/files.js";
import { getAudio, delAudio, clearAudio } from "./lib/audioStore.js";
import { checkTranscript } from "./lib/verify.js";
import { checkCompleteness, recordCompleteness } from "./lib/completeness.js";
import { downloadTranscriptTxt } from "./lib/transcriptFile.js";
import { parseTranscript } from "./lib/transcriptParse.js";
import { deriveAdditionalInfo } from "./lib/vobTemplate.js";
import { normalizeMeta, setBypass, clearBypass, setAck, bypassSummary, bypassedKeys, carrierKeys, extractOf } from "./lib/bypass.js";
import { fieldStates, blockingCount } from "./lib/fieldState.js";
import { getPrep } from "./lib/verify.js";
import { extractFromTranscript, agentOnlyObservations } from "./lib/extract.js";
import { decide, applyExtraction, useSuggestion, acceptFields, rejectField, clearAutofilled } from "./lib/autofill.js";
import ReviewGate from "./components/ReviewGate.jsx";
import PrefillBar from "./components/PrefillBar.jsx";
import CaseHistory from "./components/CaseHistory.jsx";
import ImportPanel from "./components/ImportPanel.jsx";
import VerificationForm from "./components/VerificationForm.jsx";
import PreviewDoc from "./components/PreviewDoc.jsx";
import LogTable from "./components/LogTable.jsx";
import Toasts from "./components/Toast.jsx";
import CallMediaPanel from "./components/CallMediaPanel.jsx";
import VerifyPanel from "./components/VerifyPanel.jsx";
import TranscriptView from "./components/TranscriptView.jsx";

// ATTESTED is a positive verdict — values came from the call and a human signed
// for them. Left out of this map it rendered grey, identical to NO TRANSCRIPT.
const VERDICT_PILL = { APPROVED: "ok", ATTESTED: "ok", REJECTED: "bad", UNVERIFIED: "warn" };
const NO_UPLOAD = { transcript: "", transcriptName: "" };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [meta, setMeta] = useState({});
  const [records, setRecords] = useState([]);
  const [tab, setTab] = useState("form");
  const [toasts, setToasts] = useState([]);
  const [viewIdx, setViewIdx] = useState(-1);
  const [viewText, setViewText] = useState("");
  const [upload, setUpload] = useState(NO_UPLOAD);
  const [queue, setQueue] = useState([]);
  const [roles, setRoles] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [readCall, setReadCall] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [decision, setDecision] = useState(null);
  const [importing, setImporting] = useState(null);
  const toastId = useRef(0);
  const savingRef = useRef(false);

  const reload = () => db.listRecent().then(setRecords).catch(() => {});

  // Migration from the old localStorage log runs once, on first load.
  useEffect(() => {
    db.ready()
      .then((r) => {
        if (r?.migrated) toast(`Records moved to local database — ${r.counts.cases} case(s), ${r.counts.carriers} carrier(s)`);
        return reload();
      })
      .catch((e) => toast("Could not open the local database: " + (e?.message || e), "bad"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = (msg, type = "good") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  // Typing over a value clears any provenance marker: it came from the operator
  // now, so it goes back to being something the call has to support.
  const set = (k, val) => {
    setForm((f) => ({ ...f, [k]: val }));
    setMeta((m) => (m[k]?.source && m[k].source !== "manual" ? { ...m, [k]: { ...m[k], source: "manual" } } : m));
  };

  const v = collect(form);
  const parsedRaw = useMemo(
    () => (upload.transcript ? parseTranscript(upload.transcript, { insName: v.insName, verifiedBy: v.verifiedBy }) : null),
    [upload.transcript, v.insName, v.verifiedBy]);

  // The operator can correct who is who. Attribution decides which values count as
  // confirmed, so guessing it silently would be the wrong trade.
  const parsed = useMemo(() => {
    if (!parsedRaw || !Object.keys(roles).length) return parsedRaw;
    const turns = parsedRaw.turns.map((t) => ({ ...t, role: roles[t.speaker] || t.role }));
    const speakers = parsedRaw.speakers.map((s) => ({ ...s, role: roles[s.name] || s.role }));
    const ranges = parsedRaw.ranges.map((r) => ({ ...r, role: roles[r.speaker] || r.role }));
    return { ...parsedRaw, turns, speakers, ranges };
  }, [parsedRaw, roles]);

  const transcript = parsed ? parsed.text : "";

  // Re-verifying on every keystroke is wasted work on a long transcript, and the
  // panel only has to keep up with the typist, not with each character.
  const [settled, setSettled] = useState(form);
  useEffect(() => {
    const id = setTimeout(() => setSettled(form), 250);
    return () => clearTimeout(id);
  }, [form]);

  const liveResult = useMemo(
    () => checkTranscript(collect(settled), transcript, meta, { ranges: parsed?.ranges }),
    [settled, transcript, meta, parsed]);
  const comp = useMemo(() => checkCompleteness(collect(settled), meta), [settled, meta]);

  // Can anything in this call be traced to the payer rather than to us? Values are
  // read out of an unattributed transcript anyway — refusing outright helps
  // nobody, and every filled value already has to be signed for before the record
  // saves — but the operator is told, because a figure here could be their own
  // words read back.
  const attributed = !!parsed && parsed.attributed;

  const states = useMemo(
    () => fieldStates(collect(settled), meta, liveResult, comp,
      { suggest: readCall?.suggest || {}, conflict: readCall?.conflict || {} }),
    [settled, meta, liveResult, comp, readCall]);

  const validate = () => {
    const missing = ["lastName", "firstName", "insName"].filter((k) => !v[k]);
    if (missing.length) {
      toast("Add patient name and insurance to continue", "bad");
      return false;
    }
    return true;
  };

  /* ------------------------------------------------- reading the call ---- */

  const runExtraction = (currentForm, currentMeta) => {
    if (!parsed || !transcript) return null;
    const prep = getPrep(transcript);
    const x = extractFromTranscript(prep, { ranges: parsed.ranges });
    const d = decide(x, prep, { form: currentForm });

    // Where our records and the call disagree, neither wins on its own. This is
    // the finding the app exists for — carrier says 90-day filing, rep says 180.
    const conflict = {};
    for (const [k, p] of Object.entries({ ...d.fill, ...d.suggest })) {
      const src = currentMeta[k]?.source;
      const onFile = String(currentForm[k] || "").trim();
      if (!onFile || !src || src === "manual" || src === "call") continue;
      if (onFile.toUpperCase() === String(p.value).toUpperCase()) continue;
      conflict[k] = { onFile, call: p.value, quote: p.quote };
    }
    // `prep` is deliberately not returned — keeping it would pin the whole
    // tokenised transcript, plus its memoised candidate and anchor tables, in
    // React state for the session.
    return { ...d, conflict, agentOnly: agentOnlyObservations(prep, parsed.ranges), attributed };
  };

  // Reading the call and filling the form are one action, and it happens by
  // itself. Making the operator press two buttons to get what they attached the
  // transcript for is the whole complaint this replaces.
  //
  // applyExtraction never overwrites a non-blank field, so this can never take a
  // value out of someone's hands — but it must still not re-run while they type,
  // which is why the trigger is the transcript text rather than `parsed` (that
  // object is rebuilt whenever insName or verifiedBy changes).
  const readAndFill = (announce = true) => {
    const d = runExtraction(v, meta);
    setReadCall(d);
    if (!d) return null;
    const out = applyExtraction(form, meta, d, { transcript, ranges: parsed.ranges, by: v.verifiedBy });
    setForm(out.form);
    setMeta(out.meta);
    if (announce) {
      const bits = [
        out.filled.length ? `Filled ${out.filled.length} field(s) from the call` : "Nothing in this call could be filled in",
        d.counts.suggest ? `${d.counts.suggest} to consider` : "",
        out.rejected.length ? `${out.rejected.length} could not be re-verified and were left out` : "",
        !attributed ? "no speakers in this transcript — check these carefully" : "",
      ].filter(Boolean);
      toast(bits.join(" · "), out.filled.length && attributed ? "good" : "warn");
    }
    return out;
  };

  const autoRef = useRef("");
  useEffect(() => {
    const key = transcript + "|" + JSON.stringify(roles);
    if (!transcript || autoRef.current === key) return;
    autoRef.current = key;
    readAndFill();
  }, [transcript, roles]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAccept = (keys) => {
    setMeta((m) => acceptFields(m, keys, v.verifiedBy));
    toast(`Accepted ${keys.length} value(s) read from the call`);
  };

  const handleRejectRead = (k) => {
    const out = rejectField(form, meta, k, v.verifiedBy);
    setForm(out.form);
    setMeta(out.meta);
  };

  const handleClearSection = (keys) => {
    let f = form, m = meta;
    for (const k of keys) { const o = rejectField(f, m, k, v.verifiedBy); f = o.form; m = o.meta; }
    setForm(f); setMeta(m);
    toast(`Cleared ${keys.length} machine-read value(s)`);
  };

  const handleClearAllRead = () => {
    const out = clearAutofilled(form, meta);
    setForm(out.form);
    setMeta(out.meta);
    toast("Cleared everything read from the call that you had not accepted");
  };

  const handleUseSuggestion = (p) => {
    const out = useSuggestion(form, meta, p, v.verifiedBy);
    setForm(out.form);
    setMeta(out.meta);
    toast(`${HEAD[p.key]} set from the call`);
  };

  // Scroll the transcript box to the words the value came from, rather than
  // dropping the operator at the top of a two-hour call.
  const handleShowInCall = (s) => {
    const box = document.getElementById("call-transcript");
    if (!box) return;
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    if (s?.quote) {
      const at = transcript.indexOf(String(s.quote).replace(/^…|…$/g, "").slice(0, 40));
      if (at >= 0) box.scrollTop = Math.max(0, (at / transcript.length) * box.scrollHeight - box.clientHeight / 2);
    }
    box.classList.add("flash");
    setTimeout(() => box.classList.remove("flash"), 1200);
  };

  const handleBypass = (k, reason) => setMeta((m) => setBypass(m, k, reason, "", v.verifiedBy));
  const handleClearBypass = (k) => setMeta((m) => clearBypass(m, k));
  const handleKeep = (k, heard, keep) => setMeta((m) => setAck(m, k, heard, keep, v.verifiedBy));
  const handleGenerateNote = () => {
    set("note", deriveAdditionalInfo(v));
    toast("Additional info written from the benefits you entered");
  };

  // Look up everything already known about this patient and payer, and offer it.
  const handleLookup = async () => {
    try {
      const p = await db.buildPrefill({
        lastName: v.lastName, firstName: v.firstName, dob: v.dob,
        insName: v.insName, policyId: v.policyId, serviceType: v.serviceType,
      });
      setPrefill(p);
      if (!p.patient && !p.carrier) toast("Nothing on file for this patient or payer yet", "warn");
    } catch (e) {
      toast("Lookup failed: " + (e?.message || e), "bad");
    }
  };

  // The red fields on the client's template: patient name, DOB, payer phone, payer
  // ID, claim address, filing limits. We already hold these, so they are filled
  // from our own records and never chased on the call — but the engine still grades
  // them, so a rep who contradicts one is still heard.
  const handleApplyPrefill = () => {
    if (!prefill) return;
    const next = applyPrefill(form, meta, prefill);
    setForm(next.form);
    setMeta(next.meta);
    const onFile = next.filled.filter(isOnFile).length;
    toast(next.filled.length
      ? `Filled ${next.filled.length} field(s) from our records${onFile ? ` — ${onFile} will not be chased on the call` : ""}`
      : "Nothing left to fill");
  };

  const handleClearPrefilled = () => {
    const next = clearPrefilled(form, meta);
    setForm(next.form);
    setMeta(next.meta);
    toast("Cleared everything that was not typed by you");
  };

  // Never gated on review — previewing a half-filled form mid-call is the normal
  // way to work.
  const handlePreviewPDF = () => {
    if (!validate()) return;
    makePDF(v, meta);
    toast(comp.incomplete ? `PDF generated — ${comp.blank.length} required field(s) still blank` : "PDF generated",
      comp.incomplete ? "warn" : "good");
  };

  // Several files at once: the first is verified now, the rest wait. A manager can
  // drop a day's exports and work through them without going back to the folder.
  const handleTranscriptFiles = async (files) => {
    const read = await Promise.all(files.map(async (f) => ({ name: f.name, text: (await f.text()).trim() })));
    const usable = read.filter((r) => r.text);
    const empty = read.length - usable.length;
    if (!usable.length) { toast("That transcript file is empty", "bad"); return; }

    const [first, ...rest] = usable;
    if (upload.transcript) {
      setQueue((q) => [...q, ...usable]);
      toast(`${usable.length} transcript${usable.length > 1 ? "s" : ""} queued`);
    } else {
      setUpload({ transcript: first.text, transcriptName: first.name });
      setRoles({});
      setReadCall(null);
      if (rest.length) setQueue((q) => [...q, ...rest]);
      toast(rest.length ? `Verifying ${first.name} — ${rest.length} queued` : `Transcript attached: ${first.name}`);
    }
    if (empty) toast(`${empty} file(s) were empty and skipped`, "warn");
  };

  const handlePickQueued = (i) => {
    const picked = queue[i];
    setQueue((q) => q.filter((_, k) => k !== i));
    setUpload({ transcript: picked.text, transcriptName: picked.name });
    setRoles({});
    setReadCall(null);
    toast(`Now verifying ${picked.name}`);
  };

  const handleSetRole = (speaker, role) => setRoles((r) => ({ ...r, [speaker]: role }));

  // Name the text file after the transcript it came from, else after the patient.
  const textName = () => {
    const base = upload.transcriptName ? upload.transcriptName.replace(/\.[^.]+$/, "") : "";
    return `${base || vobName(v)}_TRANSCRIPT.txt`;
  };

  const handleDownloadText = (text) => {
    if (!text.trim()) { toast("There is no transcript to save yet", "bad"); return; }
    downloadText(text, textName());
    toast("Transcript saved as .txt");
  };

  const handlePaste = (text) => {
    const t = text.trim();
    if (!t) { toast("Nothing pasted", "bad"); return; }
    setUpload({ transcript: t, transcriptName: "" });
    setRoles({});
    setReadCall(null);
    toast("Transcript attached");
  };

  // Save asks for a decision on everything the call did not support. Only once
  // there are none left does it write.
  const handleSave = () => {
    if (!validate()) return;
    if (blockingCount(states) > 0) { setReviewing(true); return; }
    commit();
  };

  const commit = async (resolve) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setReviewing(false);
    try {
      const text = transcript;
      const source = [
        upload.transcript ? (upload.transcriptName ? "uploaded transcript" : "pasted transcript") : "",
        parsed && parsed.format !== "plain" ? `${parsed.format} format` : "",
        parsed?.speakers.length ? `${parsed.speakers.map((s) => `${s.name} (${s.role})`).join(", ")}` : "",
      ].filter(Boolean).join(" · ");

      // A typed "NA" becomes an attributable bypass here, so the exception lands
      // on the record rather than disappearing into a magic string.
      const savedMeta = normalizeMeta(v, meta, v.verifiedBy);
      const fn = makePDF(v, savedMeta);
      const res = checkTranscript(v, text, savedMeta, { ranges: parsed?.ranges });
      const compAtSave = checkCompleteness(v, savedMeta);
      const labelOf = (k) => (res.checks.find((c) => c.key === k) || {}).label || k;
      const recRow = {
        ...v, _savedAt: new Date().toLocaleString(), _file: fn,
        _verdict: res.verdict, _matched: res.matched, _total: res.total,
        _missing: res.checks.filter((c) => !c.soft && (c.status === "missing" || c.status === "echo")).map((c) => c.label),
        _mismatch: res.checks.filter((c) => c.status === "mismatch").map((c) => `${c.label}: form "${c.value}" — call "${c.heard}"`),
        _contested: res.checks.filter((c) => c.dispute).map((c) => `${c.label}: also heard "${c.dispute.heard}"`),
        _echoed: res.echoed.map(labelOf),
        _bypassed: res.bypassed.map(labelOf),
        _bypassReasons: bypassSummary(savedMeta, Object.fromEntries(res.checks.map((c) => [c.key, c.label]))),
        _carrier: res.carrier.map(labelOf),
        // Who typed what, six months from now.
        _attested: res.attested.map(labelOf),
        _typed: res.checks.filter((c) => c.status === "found").map((c) => c.label),
        // The extractor's measured error rate, per record, in the client's own
        // data — and the gate on ever turning auto-fill on by default.
        _autofillEdited: F.filter((k) => {
          const ex = extractOf(savedMeta, k);
          return ex && String(v[k] || "") !== String(ex.value || "");
        }).map((k) => `${HEAD[k]}: proposed "${extractOf(savedMeta, k).value}" → saved "${v[k] || "(cleared)"}"`),
        _extractQuotes: F.filter((k) => extractOf(savedMeta, k))
          .map((k) => `${HEAD[k]}: "${String(extractOf(savedMeta, k).quote || "").slice(0, 120)}"`),
        _blank: compAtSave.blank.map((f) => f.label), _blankCount: compAtSave.blank.length, _required: compAtSave.required,
        _transcript: text, _source: source, _meta: savedMeta,
      };
      const out = await db.saveVerification({
        form: v, transcript: text, meta: savedMeta, file: fn, source, resolve,
        verify: {
          verdict: res.verdict, matched: res.matched, total: res.total,
          missing: recRow._missing, mismatch: recRow._mismatch,
          bypassed: recRow._bypassed, carrier: recRow._carrier,
          contested: recRow._contested, echoed: recRow._echoed,
          attested: res.attested, bypassReasons: recRow._bypassReasons,
          // carrierLearnings() reads result.checks to find what the rep actually
          // confirmed. Without this it saw an empty array and the carrier master
          // learned nothing, ever.
          checks: res.checks.map((c) => ({ key: c.key, status: c.status })),
        },
        completeness: { blank: recRow._blank, blankCount: recRow._blankCount, required: recRow._required },
      });

      // A member ID that looks like a typo of an existing one is not merged on a
      // guess: the operator decides, because a wrong merge silently interleaves
      // two patients' deductible histories.
      if (out.status === "needs-decision") {
        setDecision({ reason: out.reason, candidates: out.candidates });
        savingRef.current = false;
        return;
      }

      if (text) downloadTranscriptTxt({ ...recRow, _id: out.versionId }, text, res);
      await reload();
      setMeta({});
      setRoles({});
      setPrefill(null);
      setReadCall(null);
      autoRef.current = "";
      // Pull the next queued transcript forward so a batch keeps moving.
      const [next, ...rest] = queue;
      if (next) {
        setUpload({ transcript: next.text, transcriptName: next.name });
        setQueue(rest);
        setForm(clearedForm());
      } else {
        setUpload(NO_UPLOAD);
      }
      const exceptions = bypassedKeys(savedMeta).length + carrierKeys(savedMeta).length;
      const base =
        res.verdict === "APPROVED" ? `Saved — APPROVED, all ${res.total} details matched`
          : res.verdict === "REJECTED" ? `Saved — REJECTED, ${res.mismatched.length} contradicted, ${res.missing.length} not heard`
            : res.verdict === "UNVERIFIED" ? "Saved — nothing to verify against the transcript"
              : "Saved — no transcript attached, verification skipped";
      const tail = [
        out.seq > 1 ? `version ${out.seq} of this case` : out.isNewCase ? "new case" : "",
        out.changed.length ? `changed: ${out.changed.map((k) => (HEAD[k] || k).toLowerCase()).join(", ")}` : "",
        compAtSave.incomplete ? `INCOMPLETE, ${compAtSave.blank.length} required field(s) blank` : "",
        exceptions ? `${exceptions} exception${exceptions > 1 ? "s" : ""} recorded` : "",
        out.learned.length ? `learned ${out.learned.length} carrier detail(s)` : "",
      ].filter(Boolean).join(" · ");
      toast(tail ? `${base} · ${tail}` : base,
        res.verdict === "REJECTED" ? "bad" : compAtSave.incomplete ? "warn" : "good");
    } catch (e) {
      toast("Save failed: " + (e?.message || e), "bad");
    } finally {
      savingRef.current = false;
    }
  };

  const handleClear = () => {
    if (!window.confirm("Clear all fields in this form?")) return;
    setForm(clearedForm());
    setMeta({});
    toast("Form cleared");
  };

  const handleLoadSample = () => {
    setForm(sampleForm());
    setMeta({});
    toast("Sample loaded");
  };

  // The transcript lives in its own store and is loaded only where it is needed —
  // it is by far the biggest thing on a record and the log never shows it.
  const handleExport = async () => {
    if (!records.length) { toast("No records to export", "bad"); return; }
    const full = await Promise.all(records.map(async (r) => ({ ...r, _transcript: await db.getTranscript(r._id) })));
    exportExcel(full);
    toast(`Exported ${records.length} record${records.length > 1 ? "s" : ""} to Excel`);
  };

  const openImport = async () => setImporting({ existingKeys: await db.patientKeySet() });

  const handleImport = async ({ kind, rows, mapping, sheetName }) => {
    try {
      const counts = await db.applyImport({ kind, rows, mapping, sheetName });
      setImporting(null);
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

  // Re-verify: start from what this case last looked like, so only what changed
  // has to be re-entered.
  const handleOpen = (i) => {
    const r = records[i];
    setForm((f) => {
      const n = { ...f };
      F.forEach((k) => { if (r[k] !== undefined) n[k] = r[k]; });
      return n;
    });
    setMeta(r._meta || {});
    setTab("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("Loaded — update what changed and save as a new version");
  };

  const handleHistory = async (i) => {
    const r = records[i];
    if (!r._caseId) { toast("No history for this record", "warn"); return; }
    const versions = await db.getCaseHistory(r._caseId);
    setHistoryFor({ versions, name: `${dash(r.lastName)}, ${dash(r.firstName)}` });
  };

  const handleDelete = async (i) => {
    const r = records[i];
    if (r._id) delAudio(r._id).catch(() => {});
    setViewIdx(-1);
    await db.deleteVersion(r._id);
    await reload();
    toast("Record deleted");
  };

  const handleClearAll = async () => {
    if (!window.confirm("Delete all saved records? Download a backup first if you need them.")) return;
    clearAudio().catch(() => {});
    setViewIdx(-1);
    await db.clearAll();
    await reload();
    toast("All records cleared");
  };

  // Records saved before audio upload was removed still have a blob in IndexedDB.
  // Nothing writes there any more; this only lets an old recording be downloaded.
  const handleAudio = (i) => {
    const r = records[i];
    getAudio(r._id)
      .then((b) => b ? downloadBlob(b, r._audioFile || "call_audio.webm") : toast("Audio not found in this browser", "bad"))
      .catch(() => toast("Audio not found in this browser", "bad"));
  };

  const viewRec = viewIdx >= 0 ? records[viewIdx] : null;

  // The transcript is fetched only when the modal opens.
  const openTranscript = async (i) => {
    setViewIdx(i);
    setViewText(await db.getTranscript(records[i]._id));
  };

  // Re-parsed so the modal's checklist and highlighting use the same speaker
  // attribution the verdict was reached with.
  const viewParsed = useMemo(
    () => (viewText ? parseTranscript(viewText, { insName: viewRec?.insName, verifiedBy: viewRec?.verifiedBy }) : null),
    [viewText]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">US<span>24</span> SOLUTIONS</div>
          <div className="brand-rule"></div>
          <div className="brand-tag">Verification of Benefits</div>
        </div>
        <div className="topbar-actions">
          <label className="btn btn-light btn-sm">
            Restore backup
            <input type="file" accept=".json,application/json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleRestore(f); }} />
          </label>
          <button className="btn btn-light btn-sm" onClick={openImport}>Import spreadsheet</button>
          <button className="btn btn-light btn-sm" onClick={handleBackup}>Download backup</button>
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
              upload={upload}
              parsed={parsed}
              queue={queue}
              onTranscriptFiles={handleTranscriptFiles}
              onPaste={handlePaste}
              onClearTranscript={() => { setUpload(NO_UPLOAD); setRoles({}); setReadCall(null); autoRef.current = ""; }}
              onDownloadText={handleDownloadText}
              onPickQueued={handlePickQueued}
              onSetRole={handleSetRole}
              attributed={attributed}
              readCall={readCall}
              onReadCall={() => readAndFill()}
              onClearRead={handleClearAllRead}
              onUseSuggestion={handleUseSuggestion}
            />
            <PrefillBar
              prefill={prefill}
              onLookup={handleLookup}
              onApply={handleApplyPrefill}
              onClear={handleClearPrefilled}
              onCopy={(k, val) => { set(k, val); toast(`${HEAD[k]} copied from the last call — the rep still has to confirm it`, "warn"); }}
              onHistory={async () => {
                const c = prefill?.matchedCase;
                if (!c) return;
                setHistoryFor({ versions: await db.getCaseHistory(c.id), name: `${dash(v.lastName)}, ${dash(v.firstName)}` });
              }}
            />
            <VerificationForm
              form={form}
              set={set}
              states={states}
              onKeep={handleKeep}
              onBypass={handleBypass}
              onClearBypass={handleClearBypass}
              onGenerateNote={handleGenerateNote}
              onAccept={handleAccept}
              onReject={handleRejectRead}
              onUseSuggestion={handleUseSuggestion}
              onShowInCall={handleShowInCall}
              onClearSection={handleClearSection}
              onSave={handleSave}
              onPreviewPDF={handlePreviewPDF}
              onClear={handleClear}
              onLoadSample={handleLoadSample}
            />
          </div>
          <div className="preview-shell">
            <VerifyPanel result={liveResult} comp={comp} hasTranscript={!!transcript.trim()} />
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-head">
                <div>
                  <h2>Live preview</h2>
                  <p>Matches the generated PDF.</p>
                </div>
              </div>
            </div>
            <PreviewDoc v={v} meta={meta} />
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
              onTranscript={openTranscript}
              onHistory={handleHistory}
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
                <span className={"pill " + (VERDICT_PILL[viewRec._verdict] || "na")}>{viewRec._verdict || "NO TRANSCRIPT"}</span>
                {recordCompleteness(viewRec).incomplete && (
                  <span className="pill warn" title={recordCompleteness(viewRec).blank.join(", ")}>
                    INCOMPLETE {recordCompleteness(viewRec).count}
                  </span>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => downloadTranscriptTxt(viewRec, viewText, checkTranscript(viewRec, viewText, viewRec._meta, { ranges: viewParsed?.ranges }))}
                >
                  Download .txt
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewIdx(-1)}>Close</button>
              </div>
            </div>
            <div className="card-body">
              <TranscriptView v={viewRec} transcript={viewText} meta={viewRec._meta} ranges={viewParsed?.ranges} />
            </div>
          </div>
        </div>
      )}

      {historyFor && (
        <CaseHistory name={historyFor.name} versions={historyFor.versions} onClose={() => setHistoryFor(null)} />
      )}

      {importing && (
        <ImportPanel existingKeys={importing.existingKeys} onApply={handleImport} onClose={() => setImporting(null)} />
      )}

      {/* A member ID one digit off an existing one is never merged on a guess:
          a wrong merge silently interleaves two patients' financial histories. */}
      {decision && (
        <div className="modal-overlay" onClick={() => setDecision(null)}>
          <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <div>
                <h2>Is this the same policy?</h2>
                <p>This patient already has a case with a very similar member ID.</p>
              </div>
            </div>
            <div className="card-body">
              {decision.candidates.map((c) => (
                <div key={c.case.id} className="rg-row">
                  <div className="rg-main">
                    <span className="rg-label">{c.case.policyId}</span>
                    <span className="rg-detail">
                      {c.case.serviceType} · {c.case.versionCount} verification(s) · last {c.case.lastVerifiedAt || "—"}
                    </span>
                  </div>
                  <div className="rg-acts">
                    <button className="btn btn-dark btn-sm"
                      onClick={() => { setDecision(null); commit({ action: "same-case", caseId: c.case.id }); }}>
                      Same case
                    </button>
                  </div>
                </div>
              ))}
              <p className="hint" style={{ marginTop: 10 }}>
                You typed <b>{v.policyId}</b>. Choosing “same case” keeps one history and records the policy ID change.
              </p>
            </div>
            <div className="actionbar">
              <button className="btn btn-primary" onClick={() => { setDecision(null); commit({ action: "new-case" }); }}>
                No — this is a different policy
              </button>
              <div className="spacer"></div>
              <button className="btn btn-ghost" onClick={() => setDecision(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {reviewing && (
        <ReviewGate
          states={states}
          onUse={(k, heard) => set(k, heard)}
          onKeep={handleKeep}
          onBypass={handleBypass}
          onAccept={handleAccept}
          onReject={handleRejectRead}
          onUseSuggestion={handleUseSuggestion}
          onClose={() => setReviewing(false)}
          onSaveAnyway={commit}
        />
      )}

      <Toasts toasts={toasts} />
    </>
  );
}
