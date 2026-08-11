// One place that decides how each field is doing, so the form, the pre-save review
// and the exported log can never disagree about it.
//
// The verification engine reports per-check statuses; completeness reports which
// required fields are still blank. Neither alone is what an input needs to render.
import { F, HEAD } from "../data/fields.js";
import { BYPASS_REASONS, isBypassed, bypassOf, sourceOf, extractOf } from "./bypass.js";
import { isStrict } from "./schema.js";

// Kinds that stop a save until the verifier has looked at them.
//
// `autofill` is here for the reason the whole feature exists to guard against: if
// a machine-read value could be saved without anyone looking, the form would agree
// with the call by construction and the record would mean nothing.
//
// `flagged` is here for the same reason from the other end: a record QA sent back
// must not be able to return to them with the flagged field untouched and
// unacknowledged. It is deliberately the highest-priority state — when the checker
// has said this specific box is wrong, that outranks anything the engine thinks.
const BLOCKING = new Set(["required", "conflict", "contested", "autofill", "filedisagree", "flagged"]);

export const KIND_LABEL = {
  ok: "matches the call",
  flagged: "QA found a problem here",
  attested: "read from the call, checked by you",
  autofill: "read from the call — nobody has checked it",
  filedisagree: "our records and the call disagree",
  echo: "you said it — the rep did not confirm it",
  notheard: "not heard on the call",
  carrier: "carrier data",
  required: "required",
  conflict: "contradicted by the call",
  contested: "the rep gave two different answers",
  bypassed: "bypassed",
  neutral: "",
};

const SOURCE_LABEL = {
  carrier: "carrier master",
  portal: "payer portal",
  derived: "calculated",
  prior: "earlier call",
  import: "imported",
};

// suggestions/conflicts are the extraction layer's output, keyed by field:
//   suggest[key]   — a proposal the policy layer declined to write
//   conflict[key]  — our records say one thing, the call says another
export function fieldStates(v, meta, result, comp, { suggest = {}, conflict = {}, errors = [] } = {}) {
  const byKey = new Map((result?.checks || []).map((c) => [c.key, c]));
  const required = new Set(comp?.requiredKeys || []);
  // Open QA findings, by the field they were raised against. Findings about the
  // record as a whole carry no fieldKey and belong on the review panel, not on a box.
  const flagged = new Map();
  for (const e of errors) {
    if (!e.fieldKey || e.resolvedAt || e.priority === "NONE") continue;
    flagged.set(e.fieldKey, e);
  }
  const out = new Map();

  for (const key of F) {
    const c = byKey.get(key);
    const blank = !String(v[key] || "").trim();
    const ack = meta?.[key]?.ack;
    const ex = extractOf(meta, key);
    let s;

    if (flagged.has(key)) {
      const e = flagged.get(key);
      s = { kind: "flagged", finding: e, detail: e.note, priority: e.priority, raisedBy: e.by };
    } else if (isBypassed(meta, key)) {
      const b = bypassOf(meta, key);
      s = { kind: "bypassed", detail: BYPASS_REASONS[b.reason] || b.reason, bypass: b };
    } else if (conflict[key]) {
      // The most valuable finding this app produces: the carrier record says 90-day
      // filing, the rep says 180. Neither is overwritten; the operator picks.
      s = { kind: "filedisagree", heard: conflict[key].call, onFile: conflict[key].onFile, quote: conflict[key].quote };
    } else if (required.has(key) && blank) {
      s = suggest[key]
        ? { kind: "required", suggestion: suggest[key] }
        : { kind: "required" };
    } else if (!c) {
      s = blank && suggest[key] ? { kind: "neutral", suggestion: suggest[key] } : { kind: "neutral" };
    } else if (c.status === "mismatch") {
      s = { kind: "conflict", heard: c.heard, confidence: c.confidence };
    } else if (c.dispute) {
      s = { kind: "contested", heard: c.dispute.heard, confidence: c.confidence };
    } else if (c.status === "attested") {
      s = { kind: "attested", quote: ex?.quote, by: ex?.review?.by, unplaced: c.unplaced };
    } else if (c.status === "autofill") {
      // `unplaced` means the second engine could not point at where in the call
      // this came from — it did not disagree, it just could not reach it. Worth
      // saying, because it is the one auto-fill with a single reader behind it.
      s = { kind: "autofill", quote: ex?.quote, score: ex?.score, unplaced: c.unplaced };
    } else if (c.status === "found") {
      s = { kind: "ok" };
    } else if (c.status === "carrier") {
      s = { kind: "carrier", detail: SOURCE_LABEL[c.source] || SOURCE_LABEL[sourceOf(meta, key)] };
    } else if (c.status === "echo") {
      s = { kind: "echo" };
    } else if (c.status === "quiet") {
      s = { kind: "neutral" };
    } else {
      // "elsewhere" — the value was spoken, but about some other subject. To the
      // input that is the same instruction as "not heard"; the review gate keeps
      // the distinction because it tells the verifier where to look.
      s = { kind: "notheard", elsewhere: c.status === "elsewhere" };
    }

    out.set(key, {
      key,
      label: HEAD[key] || key,
      value: v[key] || "",
      acked: !!ack,
      soft: c?.soft || false,
      strict: isStrict(key),
      ...s,
      blocking: BLOCKING.has(s.kind) && !ack,
    });
  }
  return out;
}

// Everything the verifier must look at before the record is saved, grouped the way
// the review modal presents it. Order is deliberate: fix, then sign for, then act
// on, then skim.
export function reviewGroups(states) {
  const all = [...states.values()];
  const groups = [
    // First, above everything the engine found: a person has already looked at this
    // record and said what is wrong with it.
    { id: "flagged", title: "Sent back by QA", hint: "Fix each one, then mark it done.",
      items: all.filter((s) => s.kind === "flagged") },
    { id: "fix", title: "Must fix", hint: "The call disagrees, or the field is required and empty.",
      items: all.filter((s) => s.blocking && s.kind !== "autofill" && s.kind !== "flagged") },
    { id: "autofill", title: "Filled from the call — not yet checked",
      hint: "Nobody has compared these to what the rep actually said.",
      items: all.filter((s) => s.kind === "autofill") },
    { id: "suggest", title: "Suggested by the call — not filled",
      hint: "Below the bar to write in, or only our side said it.",
      items: all.filter((s) => s.suggestion && !s.blocking) },
    { id: "echo", title: "Not confirmed by the rep", hint: "Our side said it; the payer never did.",
      items: all.filter((s) => s.kind === "echo") },
    { id: "notheard", title: "Not heard on the call", hint: "Bypass these, or correct them.",
      items: all.filter((s) => s.kind === "notheard" && !s.soft) },
    { id: "info", title: "Carrier data, bypasses and accepted values",
      hint: "Recorded as exceptions — nothing to do.",
      items: all.filter((s) => s.kind === "carrier" || s.kind === "bypassed" || s.kind === "attested") },
  ];
  return groups.filter((g) => g.items.length);
}

export const blockingCount = (states) => [...states.values()].filter((s) => s.blocking).length;
export const exceptionCount = (states) =>
  [...states.values()].filter((s) => s.acked || s.kind === "bypassed" || s.kind === "carrier").length;

// Machine-read values still waiting for a human, grouped so a whole form section
// can be signed for at once — except the strict money and authorization fields,
// which are signed for one at a time.
export const pendingBySection = (states, sections) =>
  sections.map((sec) => {
    const items = sec.keys.map((k) => states.get(k)).filter((s) => s && s.kind === "autofill");
    return {
      ...sec,
      items,
      bulk: items.filter((s) => !s.strict),
      individual: items.filter((s) => s.strict),
    };
  }).filter((sec) => sec.items.length);
