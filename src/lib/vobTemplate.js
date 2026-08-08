// The VOB document, as data. Both renderers — lib/pdf.js (jsPDF) and
// components/PreviewDoc.jsx (HTML) — consume this and nothing else, so the
// layout is defined once. Adding a row is a one-line edit in this file.
//
// Pure on purpose: no DOM, no jsPDF, no React, so node --test can import it.
// Row order and every label string mirror the client's production template
// verbatim, punctuation included ("Co-pay?" keeps its question mark).
import { fmtDate } from "../data/fields.js";
import { bypassOf, BYPASS_REASONS, isNegative } from "./bypass.js";

const up = (s) => String(s || "").trim().toUpperCase();

// First number in a string: "$2,473.76" -> 2473.76, "20%" -> 20, "NA" -> null.
export const num = (s) => {
  const m = String(s == null ? "" : s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const money = (n) => `$${n.toFixed(2)}`;

const ORDINALS = ["", "1ST", "2ND", "3RD", "4TH", "5TH", "6TH", "7TH", "8TH", "9TH", "10TH"];
export const ordinal = (n) => {
  const i = num(n);
  if (i == null) return up(n);
  if (i > 0 && i < ORDINALS.length) return ORDINALS[i];
  const r = i % 100;
  if (r >= 11 && r <= 13) return `${i}TH`;
  return `${i}${["TH", "ST", "ND", "RD"][i % 10] || "TH"}`;
};

// ---------------------------------------------------------------- derivations

// Has the deductible been satisfied? Drives both the PAT box and the narrative.
export function dedState(v) {
  if (up(v.dedApply) === "NO" || isNegative(v.dedInd)) return "none";
  const rem = num(v.dedRem), ind = num(v.dedInd), met = num(v.dedMet);
  if (rem != null) return rem <= 0 ? "met" : "open";
  if (ind != null && met != null) return met >= ind ? "met" : "open";
  return "unknown";
}

// The boxed line at the top right. Mirrors the bottom-most PAT line.
export function derivePatResp(v) {
  const ded = dedState(v);
  const copay = num(v.copayAmt), coins = num(v.coinsAmt);
  if (ded === "open") return "PAT: 100% RESPONSIBLE";
  if (up(v.copay) === "YES" && copay) return `PAT: ${money(copay)} (CO-PAY)`;
  if (up(v.coins) === "YES" && coins) return `PAT: ${coins}% (CO-INS)`;
  return "PAT: $0.00 (100% COVERED)";
}

// The "Additional Info" narrative. Formulaic in the client's own documents, so
// it is generated — a typed note always overrides it (see noteText).
export function deriveAdditionalInfo(v) {
  const payer = up(v.insName) || "THE PAYER";
  const ded = dedState(v);
  const copay = num(v.copayAmt), coins = num(v.coinsAmt);
  const cov = num(v.covPct) ?? (coins != null ? 100 - coins : null);
  const dedTail = ded === "met" ? " AS DED MET" : "";

  if (ded === "open") {
    const mid = (coins != null && cov != null)
      ? ` AFTER DED MET ${payer} COVER ${cov}% AND ${coins}% WILL BE PAT RESPONSIBILITY.`
      : ` AFTER DED MET ${payer} COVER 100%.`;
    return `PAT IS 100% RESPONSIBLE, AS DED NOT MET.${mid} AFTER OOP MET PAT WILL BE 100% COVERED BY ${payer}.`;
  }
  if (up(v.copay) === "YES" && copay)
    return `PATIENT IS RESPONSIBLE FOR ${money(copay)} CO-PAY REST WILL BE COVERED BY ${payer}${dedTail}. ` +
      `AFTER OOP MET PATIENT WILL BE 100% COVERED BY ${payer}.`;
  if (up(v.coins) === "YES" && coins)
    return `PATIENT IS RESPONSIBLE FOR ${coins}% CO-INSURANCE REST WILL BE COVERED BY ${payer}${dedTail}. ` +
      `AFTER OOP MET PATIENT WILL BE 100% COVERED BY ${payer}.`;
  return `PATIENT IS 100% COVERED BY ${payer} AS PER MEMBER'S PLAN.`;
}

export const noteText = (v) => (v.note || "").trim() || deriveAdditionalInfo(v);

// "SP" stays "SP"; "Sarah Patel" becomes "SP". Appended to the verification date
// in the client's template: "08/04/2026-SP".
export const initialsOf = (s) => {
  const t = String(s || "").trim();
  if (!t) return "";
  if (/^[A-Za-z]{1,3}$/.test(t)) return t.toUpperCase();
  return t.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3);
};

export const todayWithInitials = (v) => {
  const d = fmtDate(v.today);
  const i = initialsOf(v.verifiedBy);
  return d && i ? `${d}-${i}` : d;
};

export const fullName = (v) =>
  `${up(v.lastName)}${v.lastName && v.firstName ? ", " : ""}${up(v.firstName)}`;

// A blank or negative termination date reads as still-active coverage.
const termTail = (v) => (!v.termDate || isNegative(v.termDate) ? "CURRENT" : up(v.termDate));
export const effRange = (v) => (v.effDate ? `${fmtDate(v.effDate)} TO ${termTail(v)}` : "");

// The visit threshold lives in its own field so it can be verified, but it
// prints inline exactly where the client's template shows it.
const afterTail = (v) => (v.authAfter ? ` (AFTER ${ordinal(v.authAfter)} VISIT)` : "");
export const coverageText = (v) => {
  const c = up(v.coverage);
  return c.includes("WITH AUTH") ? c + afterTail(v) : c;
};
export const authTxText = (v) => {
  const a = up(v.authTx);
  return a === "YES" ? a + afterTail(v) : a;
};

// ---------------------------------------------------------------- the document

export const CARRIER_SOURCES = new Set(["carrier", "portal", "derived"]);
const isCarrierish = (meta, key) => CARRIER_SOURCES.has(meta?.[key]?.source);

export function buildVobDoc(v, meta = {}) {
  // A deliberately bypassed field prints its reason in muted type rather than a
  // blank — the exception has to be visible on the artifact itself. An AUTO
  // bypass (the operator simply typed "NA"/"NO") keeps printing that value, which
  // is what the client's own template shows.
  const L = (key, label, value) => {
    const b = key && bypassOf(meta, key);
    if (b && !b.auto) return { key, label, value: `N/A — ${BYPASS_REASONS[b.reason] || b.reason}`, muted: true, mark: "" };
    return { key, label, value: value == null ? "" : String(value), muted: false, mark: key && isCarrierish(meta, key) ? "†" : "" };
  };
  const T = (key, text) => ({ key, label: "", value: "", text: text == null ? "" : String(text), muted: false, mark: "" });
  const GAP = { gap: true };
  const C = (...lines) => ({ lines: lines.filter(Boolean) });
  const R = (id, ...cells) => ({ id, cells });

  const svc = up(v.serviceType) || "PT";
  const splitNetwork = !!(v.networkInd || "").trim();

  const rows = [
    R("patient",
      C(L("lastName", "Name:", fullName(v))),
      C(L("dob", "DOB:", fmtDate(v.dob)))),

    R("dates",
      C(L("today", "Today's Date:", todayWithInitials(v))),
      C(L("note", "Additional Info:", noteText(v)))),

    R("payer",
      C(L("insName", "Insurance Name:", up(v.insName)),
        L("insPhone", "Insurance Contact Number:", v.insPhone)),
      C(L("policyId", "Policy ID:", v.policyId),
        L("groupId", "GROUP ID:", v.groupId))),

    R("plan",
      C(L("serviceType", "Service Type:", svc),
        L("planType", "Plan Type:", up(v.planType)),
        L("network", splitNetwork ? "Network Status Group:" : "Network Status:", up(v.network)),
        splitNetwork ? L("networkInd", "Network Status Ind Prov:", up(v.networkInd)) : null,
        L("coverage", "Coverage:", coverageText(v))),
      C(L("effDate", "Effective Date:", effRange(v)),
        L("termDate", "Termination Date:", termTail(v) === "CURRENT" ? "NO" : up(v.termDate)),
        L("hra", "HSA/HRA AMT:", up(v.hra)))),

    R("copay",
      C(L("copay", "Co-pay?", up(v.copay)),
        L("copayAmt", "Amount:", v.copayAmt)),
      C(L("dedApply", `Is Deductible Applied for ${svc} Services:`, up(v.dedApply)),
        L("dedInd", "Deductible Individual:", v.dedInd),
        L("dedMet", "Met Amount:", v.dedMet),
        L("dedRem", "Remaining Amount:", v.dedRem))),

    R("coins",
      C(L("coins", "Co-insurance:", up(v.coins)),
        L("coinsAmt", "Covered:", v.coinsAmt)),
      C(L("oop", "Out of Pocket:", v.oop),
        L("oopMet", "Met Amount:", v.oopMet),
        L("oopRem", "Amount Remaining:", v.oopRem))),

    R("visits",
      C(L("visitLimit", "Visit Limitations:", up(v.visitLimit))),
      C(L("visitUsed", "Used Visit:", v.visitUsed))),

    R("auth",
      C(L("authEval", "Is Authorization Required for Initial Eval?", up(v.authEval)),
        L("authTx", "Is Authorization Required for Treatment?", authTxText(v)),
        L("referral", "Referral Required?", up(v.referral)),
        L("pcpRef", "Is Referral Required from PCP for Approval?", up(v.pcpRef))),
      C(L(null, "How to obtain Authorization?", ""),
        T("authHow", up(v.authHow)),
        GAP,
        L(null, "With In How many days we can request for Auth?", ""),
        T("authWindow", up(v.authWindow)))),

    R("authnum",
      C(L("authNum", "Authorization #", v.authNum)),
      C(L("authDates", "Auth Coverage Dates:", v.authDates))),

    R("parties",
      C(L("primary", "PRIMARY:", up(v.primary) || up(v.insName)),
        L("hasSec", "SECONDARY:", up(v.hasSec) === "YES" ? up(v.secName) || "YES" : "NO")),
      C(L("repName", "Insurance Rep Name:", up(v.repName)),
        L("callRef", "Call Reference:", v.callRef))),

    // Full-width span: the address needs the room.
    R("claims",
      C(L("claimAddr", "Claim Mailing Address:", v.claimAddr),
        L("payerId", "Payer ID:", up(v.payerId)),
        L("tfl", "TFL days for claims:", up(v.tfl)),
        L("tflCorr", "TFL for corrected claims:", up(v.tflCorr)))),

    // The secondary block always prints, filled or not — the client's template
    // shows it on every document as a standing prompt.
    R("sec1",
      C(L("hasSec", "SECONDARY (YES/NO):", up(v.hasSec) || "NO")),
      C(L("secName", "SECONDARY INS NAME:", up(v.secName)))),
    R("sec2",
      C(L("secPlan", "PLAN NAME:", up(v.secPlan))),
      C(L("secPolicy", "POLICY ID:", v.secPolicy))),
    R("sec3",
      C(L("secEff", "EFFECTIVE DATE:", fmtDate(v.secEff))),
      C(L("secDed", "DEDUCTIBLE:", v.secDed))),
    R("sec4",
      C(L("secVisit", "VISIT LIMIT:", up(v.secVisit))),
      C(L("secUsed", "USED LIMIT:", v.secUsed))),
  ];

  const anyMarked = rows.some((r) => r.cells.some((c) => c.lines.some((l) => l.mark)));

  return {
    title: "Pre-Authorization & Benefits Determination",
    tagline: "Innovative Technology Driven",
    patBox: derivePatResp(v),
    rows,
    footnotes: anyMarked ? ["† From carrier or portal data — not stated on the call."] : [],
    footer: "US24 Solutions — Confidential. Benefits quoted are not a guarantee of payment.",
  };
}
