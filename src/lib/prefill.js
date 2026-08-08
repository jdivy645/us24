// Filling in what is already known, and recording where each value came from.
//
// Provenance is not decoration. verify.js grades every non-blank field against the
// call, and a prefilled payer ID the rep never voices would come back as "missing"
// and reject the record. The `source` marks written here are what let the engine
// tell "the rep didn't say it" apart from "the rep contradicted it".
import { F } from "../data/fields.js";
import { PREFILL_TIER, REFERENCE_FIELDS, NEVER_PREFILL, CARRIER_FIELDS } from "./schema.js";

const val = (o, k) => String((o || {})[k] ?? "").trim();

// patient / case / carrier / prior, in descending authority. The practice
// management data owns demographics; the carrier record owns payer facts; the last
// call owns the shape of the plan.
export function buildPrefillForm({ patient, carrier, priorVersion, matchedCase, importRow } = {}) {
  const form = {};
  const prov = {};
  const take = (key, value, source) => {
    if (form[key] || !value) return;
    form[key] = value;
    prov[key] = source;
  };

  for (const key of PREFILL_TIER.patient) {
    take(key, val(importRow, key), "import");
    take(key, val(patient, key), "patient");
  }
  for (const key of PREFILL_TIER.case) {
    take(key, val(matchedCase, key), "prior");
    take(key, val(importRow, key), "import");
    take(key, val(priorVersion?.form, key), "prior");
  }
  for (const key of CARRIER_FIELDS) {
    take(key, val(carrier, key), "carrier");
    take(key, val(priorVersion?.form, key), "prior");
  }
  for (const key of PREFILL_TIER.prior) {
    take(key, val(priorVersion?.form, key), "prior");
  }

  for (const key of [...REFERENCE_FIELDS, ...NEVER_PREFILL]) {
    delete form[key];
    delete prov[key];
  }
  return { form, prov };
}

// Last call's figures, shown beside the inputs with a copy button rather than
// written into them. All of the speed, none of the false confirmations.
export function referenceFrom(priorVersion) {
  if (!priorVersion) return null;
  const on = priorVersion.verifiedOn || priorVersion.savedAt || "";
  const items = REFERENCE_FIELDS
    .map((key) => ({ key, value: val(priorVersion.form, key) }))
    .filter((x) => x.value);
  return items.length ? { on, items } : null;
}

// Merge a prefill into the form the operator already has open. Anything they typed
// wins, and stays marked manual.
export function applyPrefill(currentForm, currentMeta, { form, prov }) {
  const nextForm = { ...currentForm };
  const nextMeta = { ...currentMeta };
  const filled = [];
  for (const key of F) {
    if (!form[key]) continue;
    if (String(nextForm[key] || "").trim()) continue;   // never overwrite a typed value
    nextForm[key] = form[key];
    nextMeta[key] = { ...nextMeta[key], source: prov[key] };
    filled.push(key);
  }
  return { form: nextForm, meta: nextMeta, filled };
}

// Drop everything the operator did not type themselves.
export function clearPrefilled(currentForm, currentMeta) {
  const nextForm = { ...currentForm };
  const nextMeta = { ...currentMeta };
  for (const key of F) {
    const src = nextMeta[key]?.source;
    if (src && src !== "manual") {
      nextForm[key] = "";
      const { source, ...rest } = nextMeta[key];
      if (Object.keys(rest).length) nextMeta[key] = rest; else delete nextMeta[key];
    }
  }
  return { form: nextForm, meta: nextMeta };
}

// What the carrier record should learn from a completed verification.
//
// Only values the operator typed themselves AND the rep confirmed. Learning from a
// prefilled value would let a wrong carrier record re-confirm itself forever.
export function carrierLearnings(v, meta, result) {
  const found = new Set((result?.checks || []).filter((c) => c.status === "found").map((c) => c.key));
  const out = {};
  for (const key of CARRIER_FIELDS) {
    const source = meta?.[key]?.source || "manual";
    if (source !== "manual") continue;
    if (!found.has(key)) continue;
    const value = val(v, key);
    if (value) out[key] = value;
  }
  return out;
}
