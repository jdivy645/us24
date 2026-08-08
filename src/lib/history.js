// What changed between two verifications of the same case.
//
// The reason this is not a plain !== comparison: "$1,500.00", "1500" and "$1500"
// are the same figure typed three ways. Without numeric comparison every
// re-verification reports the deductible as changed purely from typing style, and
// the whole feature becomes noise the operator learns to ignore.
import { HEAD } from "../data/fields.js";
import { PER_CALL_FIELDS } from "./schema.js";

const MONEYISH = new Set(["dedInd", "dedMet", "dedRem", "oop", "oopMet", "oopRem", "copayAmt", "secDed"]);
const PCTISH = new Set(["covPct", "coinsAmt"]);
const DATEISH = new Set(["dob", "effDate", "secEff"]);
const YESNOISH = new Set(["copay", "coins", "dedApply", "authEval", "authTx", "referral", "pcpRef", "hasSec"]);

// "$1,500.00" -> 1500. Returns null when there is no number to read, which is how
// "NA" stays distinguishable from "$0.00".
export function moneyVal(s) {
  const t = String(s == null ? "" : s).replace(/,/g, "");
  if (!/\d/.test(t)) return null;
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const norm = (s) => String(s == null ? "" : s).trim().toUpperCase().replace(/\s+/g, " ");

export function sameValue(key, a, b) {
  if (MONEYISH.has(key) || PCTISH.has(key)) {
    const x = moneyVal(a), y = moneyVal(b);
    if (x != null && y != null) return x === y;
  }
  return norm(a) === norm(b);
}

export const kindOf = (key) =>
  MONEYISH.has(key) ? "money" : PCTISH.has(key) ? "percent" : DATEISH.has(key) ? "date" : YESNOISH.has(key) ? "yesno" : "text";

// Fields that differ between two form snapshots. Per-call fields are excluded by
// default: they change every single time and would bury the two or three figures
// the operator actually needs to see.
export function diffVersions(a, b, { includePerCall = false } = {}) {
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) {
    if (key.startsWith("_")) continue;
    if (!includePerCall && PER_CALL_FIELDS.includes(key)) continue;
    const from = (a || {})[key] || "", to = (b || {})[key] || "";
    if (sameValue(key, from, to)) continue;
    const kind = kindOf(key);
    const x = moneyVal(from), y = moneyVal(to);
    out.push({
      key, label: HEAD[key] || key, from, to, kind,
      delta: kind === "money" && x != null && y != null ? Number((y - x).toFixed(2)) : null,
    });
  }
  return out.sort((p, q) => p.key.localeCompare(q.key));
}

export const changedKeys = (a, b) => diffVersions(a, b).map((d) => d.key);

// A one-line summary for the save toast. Money leads because it is what the
// practice actually re-verifies for.
export function changeSummary(diffs, limit = 3) {
  if (!diffs.length) return "";
  const ranked = [...diffs].sort((a, b) => (b.kind === "money") - (a.kind === "money"));
  const parts = ranked.slice(0, limit).map((d) =>
    `${d.label.toLowerCase()} ${d.from || "—"} → ${d.to || "—"}`);
  const rest = ranked.length - parts.length;
  return parts.join(", ") + (rest > 0 ? ` and ${rest} more` : "");
}

// Field × date table for the history modal: one row per field that ever moved.
export function historyTable(versions) {
  const ordered = [...versions].sort((a, b) => a.seq - b.seq);
  const moved = new Set();
  for (let i = 1; i < ordered.length; i++) {
    for (const k of changedKeys(ordered[i - 1].form, ordered[i].form)) moved.add(k);
  }
  const rows = [...moved].sort().map((key) => ({
    key, label: HEAD[key] || key, kind: kindOf(key),
    cells: ordered.map((ver) => (ver.form || {})[key] || ""),
  }));
  return { dates: ordered.map((ver) => ver.verifiedOn || ver.savedAt || ""), rows };
}
