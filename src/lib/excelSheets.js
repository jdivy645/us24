// Builds the workbook contents as plain data, so the export can be tested without
// SheetJS or a browser. excel.js is the thin shell that writes the file.
import { HEAD } from "../data/fields.js";
import { PRIORITY_LABEL, STATUS, ERROR_CATEGORIES, ERROR_POINTS } from "./workflow.js";

// Excel's real ceiling is 32,767 characters in one cell.
const CELL_MAX = 32700;
// How much of the transcript to keep inline on the main sheet. Enough to
// recognise the call at a glance; the whole thing lives on its own sheet.
const EXCERPT = 4000;
const SEGMENT_WORDS = 200;

const flat = (x) => (Array.isArray(x) ? x.join(", ") : x == null ? "" : x);
const clamp = (s) => (typeof s === "string" && s.length > CELL_MAX ? s.slice(0, CELL_MAX - 14) + "… [truncated]" : s);

export const segmentText = (text, words = SEGMENT_WORDS) => {
  const parts = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i += words) out.push(parts.slice(i, i + words).join(" "));
  return out;
};

const who = (v) =>
  `${v.lastName || ""}${v.lastName && v.firstName ? ", " : ""}${v.firstName || ""}`.trim() || "—";

// The client asked for the log "mapped by section" — patient, insurance,
// authorization, call information — rather than one 90-column sheet nobody scrolls.
//
// One table drives it, so a field can never appear on a section sheet under a
// different heading from the one the main log uses. Every sheet repeats the patient
// and the project: a sheet that cannot be read on its own is not a section, it is a
// column range.
const KEY_COLUMNS = ["projectName", "category", "lastName", "firstName", "dob"];

export const SHEET_SECTIONS = [
  {
    name: "Patient",
    keys: [...KEY_COLUMNS, "requestMode", "verifType", "requestDate", "today", "serviceType",
      "pat", "username", "_qaName", "_status", "_verdict", "_blankCount"],
  },
  {
    name: "Insurance",
    keys: [...KEY_COLUMNS, "insName", "insPhone", "policyId", "groupId", "planType", "planName",
      "network", "networkInd", "coverage", "effDate", "termDate", "payerId", "primary",
      "hasSec", "secName", "secPlan", "secPolicy"],
  },
  {
    name: "Authorization",
    keys: [...KEY_COLUMNS, "_authRequired", "authStatus", "authEval", "authTx", "authAfter", "referral", "pcpRef",
      "authHow", "authWindow", "authNum", "authDates", "visitLimit", "visitUsed", "initialTx"],
  },
  {
    name: "Call Information",
    keys: [...KEY_COLUMNS, "today", "repName", "callRef", "_source", "_verdict", "_matched", "_total",
      "_missing", "_mismatch", "_contested", "_echoed", "_bypassReasons"],
  },
];

const sheetFrom = (records, section) => ({
  name: section.name,
  header: section.keys.map((k) => HEAD[k] || k),
  rows: records.map((v) => Object.fromEntries(section.keys.map((k) => [HEAD[k] || k, clamp(flat(v[k]))]))),
  widths: section.keys.map((k) => Math.max(String(HEAD[k] || k).length + 2, 14)),
});

export function buildSheets(records) {
  const keys = Object.keys(HEAD);

  // Main sheet. The transcript used to be truncated at 32,000 characters with a
  // bare "…", which silently dropped most of a long call from the archived log.
  // It now carries an excerpt that says how much is missing and where to find it.
  const log = records.map((v) => {
    const o = {};
    for (const k of keys) {
      if (k === "_transcript") {
        const t = String(v._transcript || "");
        o[HEAD[k]] = t.length > EXCERPT
          ? `${t.slice(0, EXCERPT)}… [full text on the "Transcripts" sheet — ${t.length.toLocaleString()} characters]`
          : t;
        continue;
      }
      if (k === "_status") { o[HEAD[k]] = STATUS[v._status] || ""; continue; }
      // The findings live in their own store as objects; the log wants them read.
      if (k === "_errors" || k === "_comments") { o[HEAD[k]] = ""; continue; }
      o[HEAD[k]] = clamp(flat(v[k]));
    }
    o[HEAD._errors] = clamp((v._errors || [])
      .map((e) => `${e.priority}${e.fieldKey ? ` ${HEAD[e.fieldKey] || e.fieldKey}` : ""}: ${e.note || ""} (${e.by || "?"})`)
      .join(" · "));
    o[HEAD._comments] = clamp((v._comments || []).map((c) => `${c.by || "?"}: ${c.text}`).join(" · "));
    return o;
  });

  // One row per segment, so nothing is lost and Excel's own Find still works.
  const transcripts = [];
  records.forEach((v) => {
    const t = String(v._transcript || "");
    if (!t) return;
    segmentText(t).forEach((seg, i) => {
      transcripts.push({
        "Record ID": v._id || "", Patient: who(v), "Saved At": v._savedAt || "",
        "Segment #": i + 1, Text: clamp(seg),
      });
    });
  });

  // Every QA finding on its own row: the client wants to count P1s, and a
  // comma-joined cell cannot be counted.
  const errorLog = [];
  records.forEach((v) => {
    for (const e of v._errors || []) {
      errorLog.push({
        "Record ID": v._id || "", Project: v.projectName || "", Patient: who(v),
        "Verification Date": v.today || "", "Entered By": v.username || v.verifiedBy || "",
        Priority: e.priority || "", Severity: PRIORITY_LABEL[e.priority] || "",
        // Points and category are what make this sheet pivotable — a priority
        // column alone cannot answer "which mistake is costing us the most".
        Points: ERROR_POINTS[e.priority] ?? 0,
        Category: ERROR_CATEGORIES[e.category] || e.category || "",
        Field: e.fieldKey ? HEAD[e.fieldKey] || e.fieldKey : "Whole record",
        Finding: clamp(e.note || ""), "Raised Against": e.against || "",
        "Raised By": e.by || "", "Raised At": e.at || "",
        Resolved: e.resolvedAt ? `${e.resolvedBy || "yes"} ${e.resolvedAt}` : "",
      });
    }
  });

  const sheets = [{
    name: "VOB Log", header: keys.map((k) => HEAD[k]), rows: log,
    widths: keys.map((k) => (k === "_transcript" ? 60 : k === "_blank" || k === "_mismatch" || k === "_bypassReasons" || k === "_errors" ? 40 : Math.max(HEAD[k].length + 2, 14))),
  }];

  for (const section of SHEET_SECTIONS) sheets.push(sheetFrom(records, section));

  if (errorLog.length) {
    sheets.push({
      name: "Error Log",
      header: Object.keys(errorLog[0]),
      rows: errorLog,
      widths: [22, 18, 24, 16, 16, 10, 16, 8, 22, 22, 50, 16, 16, 22, 20],
    });
  }

  if (transcripts.length) {
    sheets.push({
      name: "Transcripts",
      header: ["Record ID", "Patient", "Saved At", "Segment #", "Text"],
      rows: transcripts,
      widths: [22, 24, 20, 10, 120],
    });
  }
  return sheets;
}
