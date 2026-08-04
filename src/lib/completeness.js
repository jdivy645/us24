// Form completeness — a pure function of the typed values, never of the transcript.
// Deliberately independent of verify.js: SKIP decides what can be checked against
// audio, this decides what the manager still has to ask.

// "NA" is an ANSWER (the rep said there is no deductible), not a blank. Only these
// count as unanswered.
const UNANSWERED = new Set(["", "TBD", "TBA", "UNKNOWN", "PENDING", "?"]);
const isAnswered = (val) => !UNANSWERED.has(String(val || "").trim().toUpperCase());

const sec = (v) => v.hasSec === "YES";

// Labels read like the form's own <label>s — the manager is hunting for an input.
export const MANDATORY_FIELDS = [
  { key: "lastName", label: "Last name" },
  { key: "firstName", label: "First name" },
  { key: "dob", label: "Date of birth" },
  { key: "insName", label: "Insurance name" },
  { key: "policyId", label: "Policy ID" },
  { key: "planType", label: "Plan type" },
  { key: "network", label: "Network status" },
  { key: "coverage", label: "Coverage" },
  { key: "effDate", label: "Effective date" },
  { key: "payerId", label: "Payer ID" },
  { key: "copay", label: "Co-pay" },
  { key: "copayAmt", label: "Co-pay amount" },
  { key: "coins", label: "Co-insurance" },
  { key: "coinsAmt", label: "Co-insurance %" },
  { key: "dedApply", label: "Deductible applies" },
  { key: "dedInd", label: "Deductible (individual)" },
  { key: "oop", label: "Out of pocket max" },
  { key: "visitLimit", label: "Visit limitation" },
  { key: "authEval", label: "Auth required — initial eval" },
  { key: "authTx", label: "Auth required — treatment" },
  { key: "referral", label: "Referral required" },
  { key: "tfl", label: "Timely filing — claims" },
  { key: "repName", label: "Insurance rep name" },
  { key: "callRef", label: "Call reference #" },
  { key: "secName", label: "Secondary insurance name", when: sec },
  { key: "secPolicy", label: "Secondary policy ID", when: sec },
];

export function checkCompleteness(v) {
  const required = MANDATORY_FIELDS.filter((f) => !f.when || f.when(v));
  const blank = required.filter((f) => !isAnswered(v[f.key]));
  return {
    required: required.length,
    answered: required.length - blank.length,
    blank,
    incomplete: blank.length > 0,
  };
}

// Saved records: trust what was stored, recompute for rows predating the feature
// (collect() writes every form key onto the row, so recomputing is accurate).
const LEGACY_RECOMPUTE = true;

export function recordCompleteness(rec) {
  if (Array.isArray(rec._blank)) {
    return { blank: rec._blank, count: rec._blank.length, required: rec._required || 0, incomplete: rec._blank.length > 0 };
  }
  if (!LEGACY_RECOMPUTE) return { blank: [], count: 0, required: 0, incomplete: false };
  const c = checkCompleteness(rec);
  return { blank: c.blank.map((f) => f.label), count: c.blank.length, required: c.required, incomplete: c.incomplete };
}
