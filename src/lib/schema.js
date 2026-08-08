// Shapes and policy for the stored data. Kept apart from db.js so the rules are
// readable without wading through IndexedDB plumbing, and importable from tests.

export const DB_NAME = "us24_vob";
export const DB_VERSION = 2;

// v1 held only `audio`, written by the old recording upload. It stays for records
// saved before that was removed; nothing writes to it now.
export const STORES = {
  audio: { keyPath: null, indexes: [] },
  patients: {
    keyPath: "id",
    indexes: [
      { name: "by_key", on: "key", unique: true },
      { name: "by_last", on: "lastNameNorm" },
      { name: "by_dob", on: "dob" },
    ],
  },
  carriers: {
    keyPath: "id",
    indexes: [
      { name: "by_key", on: "key", unique: true },
      { name: "by_alias", on: "aliases", multiEntry: true },
      { name: "by_payerId", on: "payerId" },
    ],
  },
  cases: {
    keyPath: "id",
    indexes: [
      { name: "by_caseKey", on: "caseKey", unique: true },
      { name: "by_patient", on: "patientId" },
      { name: "by_carrier", on: "carrierId" },
      { name: "by_policyKey", on: "policyKey" },
      { name: "by_lastVerified", on: "lastVerifiedAt" },
    ],
  },
  versions: {
    keyPath: "id",
    indexes: [
      { name: "by_case", on: "caseId" },
      { name: "by_case_seq", on: ["caseId", "seq"] },
      { name: "by_savedAt", on: "savedAt" },
    ],
  },
  transcripts: { keyPath: "id", indexes: [] },
  imports: { keyPath: "id", indexes: [] },
  meta: { keyPath: null, indexes: [] },
};

// Carrier master data: entered once, reused on every later VOB for that payer.
// One list, consumed by both prefill and learn-from-call, so the two cannot drift.
export const CARRIER_FIELDS = ["payerId", "insPhone", "claimAddr", "tfl", "tflCorr"];

// Where each field's prefilled value may come from. Order of authority is the
// order of this table: patient beats case beats carrier beats prior.
export const PREFILL_TIER = {
  patient: ["lastName", "firstName", "dob"],
  case: ["insName", "policyId", "groupId", "planType"],
  carrier: CARRIER_FIELDS,
  prior: [
    "network", "networkInd", "coverage", "effDate", "hra",
    "copay", "copayAmt", "covPct", "coins", "coinsAmt",
    "dedApply", "dedInd", "oop", "visitLimit",
    "authEval", "authTx", "authAfter", "referral", "pcpRef", "authHow", "authWindow",
    "primary", "hasSec", "secName", "secPlan", "secPolicy", "secEff", "secDed", "secVisit", "secUsed",
  ],
};

// Shown from the last call for reference, never written into the form.
//
// These are the numbers the call exists to establish. A prefilled figure that
// survives to save is an unverified claim wearing a verified badge — and because
// verify.js grades every non-blank field, it produces either a false REJECTED or,
// worse, a coincidental "found" when the rep happens to say something similar.
// repName and callRef are excluded for the same reason: last month's reference
// number must never be "confirmed" against a digit string in today's call.
export const REFERENCE_FIELDS = ["dedMet", "dedRem", "oopMet", "oopRem", "visitUsed"];

// Always typed fresh.
export const NEVER_PREFILL = ["today", "termDate", "repName", "callRef", "authNum", "authDates", "note", "verifiedBy"];

// Fields that change every call and would bury the signal in a "what changed"
// summary. They are still stored on every version.
export const PER_CALL_FIELDS = ["today", "repName", "callRef", "authNum", "note", "verifiedBy"];

export const tierOf = (key) => {
  for (const [tier, keys] of Object.entries(PREFILL_TIER)) if (keys.includes(key)) return tier;
  if (REFERENCE_FIELDS.includes(key)) return "reference";
  return "none";
};
