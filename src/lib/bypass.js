// Per-field metadata: why a field is blank, where its value came from, and which
// contradictions the verifier has already looked at and chosen to keep.
//
// This module exists because verify.js and completeness.js used to disagree about
// what "NA" means. verify.js dropped NA/NONE/CURRENT from the checklist entirely
// while completeness.js counted them as answered — so typing "NA" produced
// FORM COMPLETE + APPROVED with no record of the exception. Both now route
// through isBypassed(), and normalizeMeta() turns the typed tokens into real,
// attributable bypasses at save time.
//
// Shape, held per field key on a `meta` object saved as the record's _meta:
//   meta[key] = {
//     bypass: { reason, note, by, at, auto },
//     source: "manual" | "rep" | "carrier" | "portal" | "derived" | "prior" | "import",
//     ack:    { heard, keep, by, at },
//   }
// Nested rather than 108 flat keys: F, HEAD, collect() and excel.js all iterate
// flat field keys, and flattening would triple the exported sheet.

export const BYPASS_REASONS = {
  NOT_APPLICABLE: "Not applicable to this plan",
  NOT_AVAILABLE: "Rep could not provide it",
  NOT_ON_CALL: "Not discussed on the call",
  CARRIER_DATA: "From carrier master data",
};

export const norm = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");

// Tokens a human types to MEAN "not applicable". They are answers, not blanks —
// but they carry no audit trail, so normalizeMeta() promotes them to bypasses.
// TBD/TBA/PENDING/UNKNOWN are deliberately absent: those are genuinely unanswered.
// CURRENT is absent too — it is a real termination-date value, handled by effRange().
const NEGATIVE = new Set(["NA", "NONE", "NO", "NIL", "NOTAPPLICABLE", "NOTPROVIDED"]);

export const isNegative = (s) => {
  const n = norm(s);
  return n === "0" || NEGATIVE.has(n);
};

export const bypassOf = (meta, key) => (meta && meta[key] && meta[key].bypass) || null;
export const isBypassed = (meta, key) => !!bypassOf(meta, key);
export const sourceOf = (meta, key) => (meta && meta[key] && meta[key].source) || "manual";
export const ackOf = (meta, key) => (meta && meta[key] && meta[key].ack) || null;

// Values the operator did not obtain from the call. Never counted as "not heard",
// but — critically — still able to be contradicted by it.
const NOT_FROM_CALL = new Set(["carrier", "portal", "derived", "prior", "import"]);
export const isCarrier = (meta, key) => NOT_FROM_CALL.has(sourceOf(meta, key));

export const bypassedKeys = (meta) => Object.keys(meta || {}).filter((k) => isBypassed(meta, k));
export const carrierKeys = (meta) => Object.keys(meta || {}).filter((k) => isCarrier(meta, k));

// Human-readable audit trail for the Excel log.
export const bypassSummary = (meta, labels = {}) =>
  bypassedKeys(meta).map((k) => {
    const b = bypassOf(meta, k);
    const who = b.by ? `, ${b.by}` : "";
    const note = b.note ? ` — ${b.note}` : "";
    return `${labels[k] || k} (${BYPASS_REASONS[b.reason] || b.reason}${who})${note}`;
  });

const stamp = (by) => ({ by: by || "", at: new Date().toISOString() });

export const setBypass = (meta, key, reason, note, by) => ({
  ...meta,
  [key]: { ...meta?.[key], bypass: { reason, note: note || "", ...stamp(by), auto: false } },
});

export const clearBypass = (meta, key) => {
  const next = { ...meta, [key]: { ...meta?.[key] } };
  delete next[key].bypass;
  if (!Object.keys(next[key]).length) delete next[key];
  return next;
};

export const setSource = (meta, key, source) => ({ ...meta, [key]: { ...meta?.[key], source } });

export const setAck = (meta, key, heard, keep, by) => ({
  ...meta,
  [key]: { ...meta?.[key], ack: { heard, keep, ...stamp(by) } },
});

// Fields where "NO" is the answer itself, not a way of saying "not applicable".
// Auto-bypassing these would silently drop every yes/no answer from verification.
const YESNO_KEYS = new Set(["copay", "coins", "dedApply", "authEval", "authTx", "referral", "pcpRef", "hasSec"]);

// A blank or negative termination date means coverage is still active. The
// template renders that itself, so it is an answer rather than an exception.
const NEVER_AUTO = new Set([...YESNO_KEYS, "termDate", "network", "networkInd"]);

// Called once at save. A value field typed as "NA"/"NONE"/"NO" becomes an
// attributable bypass so the exception survives on the record — but it is marked
// auto, and auto bypasses still PRINT their typed value (the client's own
// template shows a bare "NO" for HSA/HRA and termination date). Only a bypass the
// operator set deliberately prints as an exception. Fields that already carry a
// bypass are left alone.
export function normalizeMeta(v, meta, by) {
  const out = { ...(meta || {}) };
  for (const k of Object.keys(v || {})) {
    if (k.startsWith("_") || !v[k] || NEVER_AUTO.has(k) || bypassOf(out, k)) continue;
    if (isNegative(v[k])) {
      out[k] = {
        ...out[k],
        bypass: { reason: "NOT_APPLICABLE", note: `typed "${v[k]}"`, ...stamp(by), auto: true },
      };
    }
  }
  return out;
}
