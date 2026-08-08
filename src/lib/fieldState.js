// One place that decides how each field is doing, so the form, the pre-save review
// and the exported log can never disagree about it.
//
// The verification engine reports per-check statuses; completeness reports which
// required fields are still blank. Neither alone is what an input needs to render.
import { F, HEAD } from "../data/fields.js";
import { BYPASS_REASONS, isBypassed, bypassOf, sourceOf } from "./bypass.js";

// Kinds that stop a save until the verifier has looked at them. A conflict or a
// contested value can be acknowledged ("keep mine"); a required blank cannot.
const BLOCKING = new Set(["required", "conflict", "contested"]);

export const KIND_LABEL = {
  ok: "matches the call",
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

export function fieldStates(v, meta, result, comp) {
  const byKey = new Map((result?.checks || []).map((c) => [c.key, c]));
  const required = new Set(comp?.requiredKeys || []);
  const out = new Map();

  for (const key of F) {
    const c = byKey.get(key);
    const blank = !String(v[key] || "").trim();
    const ack = meta?.[key]?.ack;
    let s;

    if (isBypassed(meta, key)) {
      const b = bypassOf(meta, key);
      s = { kind: "bypassed", detail: BYPASS_REASONS[b.reason] || b.reason, bypass: b };
    } else if (required.has(key) && blank) {
      s = { kind: "required" };
    } else if (!c) {
      s = { kind: "neutral" };
    } else if (c.status === "mismatch") {
      s = { kind: "conflict", heard: c.heard, confidence: c.confidence };
    } else if (c.dispute) {
      s = { kind: "contested", heard: c.dispute.heard, confidence: c.confidence };
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
      ...s,
      blocking: BLOCKING.has(s.kind) && !ack,
    });
  }
  return out;
}

// Everything the verifier must look at before the record is saved, grouped the way
// the review modal presents it. Order is deliberate: fix, then explain, then skim.
export function reviewGroups(states) {
  const all = [...states.values()];
  const groups = [
    { id: "fix", title: "Must fix", hint: "The call disagrees, or the field is required and empty.",
      items: all.filter((s) => s.blocking) },
    { id: "echo", title: "Not confirmed by the rep", hint: "Our side said it; the payer never did.",
      items: all.filter((s) => s.kind === "echo") },
    { id: "notheard", title: "Not heard on the call", hint: "Bypass these, or correct them.",
      items: all.filter((s) => s.kind === "notheard" && !s.soft) },
    { id: "info", title: "Carrier data and bypasses", hint: "Recorded as exceptions — nothing to do.",
      items: all.filter((s) => s.kind === "carrier" || s.kind === "bypassed") },
  ];
  return groups.filter((g) => g.items.length);
}

export const blockingCount = (states) => [...states.values()].filter((s) => s.blocking).length;
export const exceptionCount = (states) =>
  [...states.values()].filter((s) => s.acked || s.kind === "bypassed" || s.kind === "carrier").length;
