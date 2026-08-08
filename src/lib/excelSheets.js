// Builds the workbook contents as plain data, so the export can be tested without
// SheetJS or a browser. excel.js is the thin shell that writes the file.
import { HEAD } from "../data/fields.js";

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
      o[HEAD[k]] = clamp(flat(v[k]));
    }
    return o;
  });

  // One row per segment, so nothing is lost and Excel's own Find still works.
  const transcripts = [];
  records.forEach((v) => {
    const t = String(v._transcript || "");
    if (!t) return;
    const who = `${v.lastName || ""}${v.lastName && v.firstName ? ", " : ""}${v.firstName || ""}`.trim() || "—";
    segmentText(t).forEach((seg, i) => {
      transcripts.push({
        "Record ID": v._id || "", Patient: who, "Saved At": v._savedAt || "",
        "Segment #": i + 1, Text: clamp(seg),
      });
    });
  });

  const sheets = [{ name: "VOB Log", header: keys.map((k) => HEAD[k]), rows: log,
    widths: keys.map((k) => (k === "_transcript" ? 60 : k === "_blank" || k === "_mismatch" || k === "_bypassReasons" ? 40 : Math.max(HEAD[k].length + 2, 14))) }];

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
