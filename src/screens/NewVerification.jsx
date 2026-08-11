import { useEffect, useMemo, useRef, useState } from "react";
import { F, HEAD, collect, dash, initialForm, clearedForm, sampleForm } from "../data/fields.js";
import * as db from "../lib/db.js";
import { applyPrefill, clearPrefilled } from "../lib/prefill.js";
import { isOnFile } from "../lib/schema.js";
import { makePDF } from "../lib/pdf.js";
import { vobName, downloadText } from "../lib/files.js";
import { checkTranscript, getPrep } from "../lib/verify.js";
import { checkCompleteness } from "../lib/completeness.js";
import { downloadTranscriptTxt } from "../lib/transcriptFile.js";
import { parseTranscript } from "../lib/transcriptParse.js";
import { deriveAdditionalInfo } from "../lib/vobTemplate.js";
import { normalizeMeta, setBypass, clearBypass, setAck, bypassSummary, bypassedKeys, carrierKeys, extractOf } from "../lib/bypass.js";
import { fieldStates, blockingCount } from "../lib/fieldState.js";
import { extractFromTranscript, agentOnlyObservations } from "../lib/extract.js";
import { decide, applyExtraction, useSuggestion, acceptFields, rejectField, clearAutofilled } from "../lib/autofill.js";
import ReviewGate from "../components/ReviewGate.jsx";
import PrefillBar from "../components/PrefillBar.jsx";
import CaseHistory from "../components/CaseHistory.jsx";
import VerificationForm from "../components/VerificationForm.jsx";
import PreviewDoc from "../components/PreviewDoc.jsx";
import CallMediaPanel from "../components/CallMediaPanel.jsx";
import VerifyPanel from "../components/VerifyPanel.jsx";

const NO_UPLOAD = { transcript: "", transcriptName: "" };

// Everything that happens while a verification is being made. Split out of App.jsx
// when the app grew a QA queue, a dashboard and an admin screen: this screen holds
// a dozen pieces of interlocking state that none of the others care about, and
// keeping them in the shell made the shell impossible to read.
export default function NewVerification({ toast, currentUser, projects = [], handoff, onHandoffDone, onSaved }) {
  const [form, setForm] = useState(initialForm);
  const [meta, setMeta] = useState({});
  const [upload, setUpload] = useState(NO_UPLOAD);
  const [queue, setQueue] = useState([]);
  const [roles, setRoles] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [readCall, setReadCall] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [decision, setDecision] = useState(null);
  const [cfg, setCfg] = useState({ add: [], exempt: [] });
  // Set only when the operator is putting a returned record right. Carries the id of
  // the version being corrected and the findings still open against it.
  const [correcting, setCorrecting] = useState(null);
  const savingRef = useRef(false);

  // Typing over a value clears any provenance marker: it came from the operator
  // now, so it goes back to being something the call has to support.
  const set = (k, val) => {
    setForm((f) => ({ ...f, [k]: val }));
    setMeta((m) => (m[k]?.source && m[k].source !== "manual" ? { ...m, [k]: { ...m[k], source: "manual" } } : m));
  };

  const v = collect(form);

  // Whoever is signed in did the work, unless they say otherwise. Only ever fills a
  // blank — an operator entering a colleague's backlog must be able to say so.
  useEffect(() => {
    if (currentUser?.name) setForm((f) => (f.username ? f : { ...f, username: currentUser.name }));
  }, [currentUser?.name]);

  // A record handed over from the records list or the QA queue: load it and pick up
  // where it left off. Runs once per handoff, then tells the shell it landed.
  useEffect(() => {
    if (!handoff) return;
    const record = handoff.record || handoff;
    setForm((f) => {
      const n = { ...f };
      F.forEach((k) => { if (record[k] !== undefined) n[k] = record[k]; });
      return n;
    });
    setMeta(record._meta || {});
    // "correct" puts the same record right and resubmits it. "reverify" starts a new
    // version from what this case last looked like. Same load, different write.
    setCorrecting(handoff.mode === "correct"
      ? { versionId: record._id, errors: record._errors || [], openCount: (record._errors || []).filter((e) => e.priority !== "NONE" && !e.resolvedAt).length }
      : null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    onHandoffDone?.();
  }, [handoff]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-read the findings after one is marked fixed, so the flag clears and the
  // resubmit button unlocks without a round trip through the shell.
  const refreshFindings = async () => {
    if (!correcting) return;
    const errors = await db.listErrors({ versionId: correcting.versionId });
    setCorrecting((c) => (c ? { ...c, errors, openCount: errors.filter((e) => e.priority !== "NONE" && !e.resolvedAt).length } : c));
  };

  const handleResolveFinding = async (finding) => {
    try {
      await db.resolveError(finding.id, v.username || v.verifiedBy);
      await refreshFindings();
      await onSaved?.();
      toast("Marked fixed");
    } catch (e) {
      toast("Could not mark that fixed: " + (e?.message || e), "bad");
    }
  };

  // The project's rule decides what "required" means for this record, so it has to
  // be in hand before completeness is computed. Re-read when either input changes;
  // a project edited in Admin takes effect on the next keystroke here.
  useEffect(() => {
    let live = true;
    db.projectRequirements(v.projectName, v.requestMode)
      .then((r) => { if (live) setCfg(r); })
      .catch(() => { if (live) setCfg({ add: [], exempt: [] }); });
    return () => { live = false; };
  }, [v.projectName, v.requestMode]);

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
  const comp = useMemo(() => checkCompleteness(collect(settled), meta, cfg), [settled, meta, cfg]);

  // Can anything in this call be traced to the payer rather than to us? Values are
  // read out of an unattributed transcript anyway — refusing outright helps
  // nobody, and every filled value already has to be signed for before the record
  // saves — but the operator is told, because a figure here could be their own
  // words read back.
  const attributed = !!parsed && parsed.attributed;

  const states = useMemo(
    () => fieldStates(collect(settled), meta, liveResult, comp,
      { suggest: readCall?.suggest || {}, conflict: readCall?.conflict || {}, errors: correcting?.errors || [] }),
    [settled, meta, liveResult, comp, readCall, correcting]);

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

  const handleBypass = (k, reason) => setMeta((m) => setBypass(m, k, reason, "", v.username || v.verifiedBy));
  const handleClearBypass = (k) => setMeta((m) => clearBypass(m, k));
  const handleKeep = (k, heard, keep) => setMeta((m) => setAck(m, k, heard, keep, v.username || v.verifiedBy));
  const handleGenerateNote = () => {
    set("note", deriveAdditionalInfo(v));
    toast("Additional info written from the benefits you entered");
  };

  /* ------------------------------------------------------------ prefill ---- */

  const lookup = async (announce) => {
    try {
      const p = await db.buildPrefill({
        lastName: v.lastName, firstName: v.firstName, dob: v.dob,
        insName: v.insName, policyId: v.policyId, serviceType: v.serviceType,
      });
      setPrefill(p);
      // A patient with a case on file is not being verified for the first time.
      // Set once and never override: the operator may know better.
      if (p?.matchedCase) setForm((f) => (f.verifType === "INITIAL" ? { ...f, verifType: "RE-VERIFICATION" } : f));
      if (announce && !p.patient && !p.carrier) toast("Nothing on file for this patient or payer yet", "warn");
      return p;
    } catch (e) {
      if (announce) toast("Lookup failed: " + (e?.message || e), "bad");
      return null;
    }
  };

  const handleLookup = () => lookup(true);

  // The red fields on the client's template come from our own records, so they
  // should arrive without anyone asking for them. As soon as there is enough to
  // identify a patient or name a payer, load what we hold and fill the blanks.
  const fileRef = useRef("");
  useEffect(() => {
    const key = [v.lastName, v.firstName, v.dob, v.insName].join("|");
    if (key === "|||" || fileRef.current === key) return;
    if (!v.insName && !(v.lastName && v.dob)) return;   // not enough to look anything up
    fileRef.current = key;
    let cancelled = false;
    const id = setTimeout(async () => {
      const p = await lookup(false);
      if (!p || cancelled) return;
      const next = applyPrefill(form, meta, p);
      if (!next.filled.length) return;
      setForm(next.form);
      setMeta(next.meta);
      const onFile = next.filled.filter(isOnFile).length;
      toast(`Filled ${next.filled.length} field(s) from our records${onFile ? ` — ${onFile} will not be chased on the call` : ""}`);
    }, 400);
    return () => { cancelled = true; clearTimeout(id); };
  }, [v.lastName, v.firstName, v.dob, v.insName]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* ---------------------------------------------------------- transcript ---- */

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

  /* --------------------------------------------------------------- saving ---- */

  // Save asks for a decision on everything the call did not support. Only once
  // there are none left does it write.
  const handleSave = () => {
    if (!validate()) return;
    if (blockingCount(states) > 0) { setReviewing(true); return; }
    if (correcting) { commitCorrection(); return; }
    commit(undefined, "submitted");
  };

  // Putting a returned record right. Writes over the same version rather than
  // minting a new one — see db.saveCorrection for why that distinction is the whole
  // reason the correction loop closes.
  const commitCorrection = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setReviewing(false);
    try {
      const savedMeta = normalizeMeta(v, meta, v.username || v.verifiedBy);
      const res = checkTranscript(v, transcript, savedMeta, { ranges: parsed?.ranges });
      const compAtSave = checkCompleteness(v, savedMeta, cfg);
      const out = await db.saveCorrection(correcting.versionId, {
        form: v, meta: savedMeta, by: v.username || v.verifiedBy,
        verify: {
          verdict: res.verdict, matched: res.matched, total: res.total,
          checks: res.checks.map((c) => ({ key: c.key, status: c.status })),
        },
        completeness: {
          blank: compAtSave.blank.map((f) => f.label),
          blankCount: compAtSave.blank.length,
          required: compAtSave.required,
        },
      });
      if (out.status === "refused") { toast(out.reason, "bad"); return; }
      if (out.status === "not-found") { toast("That record is no longer here", "bad"); return; }

      makePDF(v, savedMeta);
      await onSaved?.();
      setCorrecting(null);
      setForm(clearedForm(v));
      setMeta({});
      setPrefill(null);
      setReadCall(null);
      setUpload(NO_UPLOAD);
      autoRef.current = "";
      fileRef.current = "";
      toast(out.workflow.status === "auth_pending"
        ? "Corrected — back to the authorization queue"
        : "Corrected and resubmitted to QA");
    } catch (e) {
      toast("Could not resubmit: " + (e?.message || e), "bad");
    } finally {
      savingRef.current = false;
    }
  };

  // A draft is a private save. It skips the review gate deliberately: the gate
  // exists so that nothing UNCHECKED is handed to anyone, and a draft is handed to
  // nobody. It cannot be submitted to QA until the gate is satisfied.
  const handleSaveDraft = () => {
    if (!validate()) return;
    commit(undefined, "draft");
  };

  const commit = async (resolve, status = "submitted") => {
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
      const savedMeta = normalizeMeta(v, meta, v.username || v.verifiedBy);
      const fn = makePDF(v, savedMeta);
      const res = checkTranscript(v, text, savedMeta, { ranges: parsed?.ranges });
      const compAtSave = checkCompleteness(v, savedMeta, cfg);
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
        form: v, transcript: text, meta: savedMeta, file: fn, source, resolve, status,
        verify: {
          verdict: res.verdict, matched: res.matched, total: res.total,
          missing: recRow._missing, mismatch: recRow._mismatch,
          bypassed: recRow._bypassed, carrier: recRow._carrier,
          contested: recRow._contested, echoed: recRow._echoed,
          attested: res.attested, bypassReasons: recRow._bypassReasons,
          checks: res.checks.map((c) => ({ key: c.key, status: c.status })),
        },
        completeness: { blank: recRow._blank, blankCount: recRow._blankCount, required: recRow._required },
      });

      // A member ID that looks like a typo of an existing one is not merged on a
      // guess: the operator decides, because a wrong merge silently interleaves
      // two patients' deductible histories.
      if (out.status === "needs-decision") {
        setDecision({ reason: out.reason, candidates: out.candidates, status });
        savingRef.current = false;
        return;
      }

      if (text) downloadTranscriptTxt({ ...recRow, _id: out.versionId }, text, res);
      await onSaved?.();
      setMeta({});
      setRoles({});
      setPrefill(null);
      setReadCall(null);
      autoRef.current = "";
      fileRef.current = "";
      // Pull the next queued transcript forward so a batch keeps moving, and carry
      // the project and operator across — a day's work is usually one of each.
      const [next, ...rest] = queue;
      setForm(clearedForm(v));
      if (next) {
        setUpload({ transcript: next.text, transcriptName: next.name });
        setQueue(rest);
      } else {
        setUpload(NO_UPLOAD);
      }
      const exceptions = bypassedKeys(savedMeta).length + carrierKeys(savedMeta).length;
      const SAVED = {
        APPROVED: () => `Saved — APPROVED, all ${res.total} details matched`,
        ATTESTED: () => `Saved — ATTESTED, ${res.attested.length} read from the call and accepted by you`,
        REJECTED: () => `Saved — REJECTED, ${res.mismatched.length} contradicted, ${res.missing.length} not heard`,
        UNVERIFIED: () => "Saved — nothing to verify against the transcript",
        "NO TRANSCRIPT": () => "Saved — no transcript attached, verification skipped",
      };
      const base = (SAVED[res.verdict] || SAVED["NO TRANSCRIPT"])();
      const tail = [
        status === "draft" ? "kept as a draft — not sent anywhere"
          : out.workflow?.status === "auth_pending" ? "authorization required — sent to the authorization queue"
            : "sent to QA",
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
    if (!window.confirm(correcting
      ? "Abandon this correction? The record stays returned and nothing is saved."
      : "Clear all fields in this form?")) return;
    setForm(clearedForm(v));
    setMeta({});
    // Leaving correction mode on would point the next save at a version whose form
    // has just been emptied.
    setCorrecting(null);
    toast(correcting ? "Correction abandoned — the record is still returned" : "Form cleared");
  };

  const handleLoadSample = () => {
    setForm(sampleForm());
    setMeta({});
    toast("Sample loaded");
  };

  // Archived projects are kept off the list, but a record already filed under one
  // keeps its own value in the options. Without this the select finds no matching
  // option, renders blank, and the project is silently dropped on the next save.
  const projectNames = useMemo(() => {
    const live = projects.filter((p) => !p.archived).map((p) => p.name);
    return [...new Set(v.projectName ? [...live, v.projectName] : live)].sort();
  }, [projects, v.projectName]);

  return (
    <>
      <div className="wrap">
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
              projectNames={projectNames}
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
              onSaveDraft={handleSaveDraft}
              onPreviewPDF={handlePreviewPDF}
              onClear={handleClear}
              onLoadSample={handleLoadSample}
              onResolve={handleResolveFinding}
              correcting={correcting}
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

      {historyFor && (
        <CaseHistory name={historyFor.name} versions={historyFor.versions} onClose={() => setHistoryFor(null)} />
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
                      onClick={() => { setDecision(null); commit({ action: "same-case", caseId: c.case.id }, decision.status); }}>
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
              <button className="btn btn-primary" onClick={() => { setDecision(null); commit({ action: "new-case" }, decision.status); }}>
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
          onResolve={handleResolveFinding}
          onClose={() => setReviewing(false)}
          onSaveAnyway={() => (correcting ? commitCorrection() : commit(undefined, "submitted"))}
        />
      )}
    </>
  );
}
