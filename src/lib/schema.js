// Shapes and policy for the stored data. Kept apart from db.js so the rules are
// readable without wading through IndexedDB plumbing, and importable from tests.

export const DB_NAME = "us24_vob";
// v3 added the work-management layer around a verification: which project it belongs
// to, who entered it, who QA'd it, and what QA found.
export const DB_VERSION = 3;

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

  // ---- v3 -----------------------------------------------------------------
  // The unit of work assignment. Required-field rules hang off the project
  // rather than off a separate store, so "this client needs a PCP referral and
  // that one does not" is one row to edit rather than a join.
  projects: {
    keyPath: "id",
    indexes: [
      { name: "by_key", on: "key", unique: true },
      { name: "by_archived", on: "archivedFlag" },
    ],
  },
  // Attribution and queue routing, not security. There are no passwords here and
  // there is nothing to authenticate against — one browser, one team.
  users: {
    keyPath: "id",
    indexes: [
      { name: "by_key", on: "key", unique: true },
      { name: "by_role", on: "role" },
    ],
  },
  // What QA found, one row per finding, so a record can carry several. A clean
  // pass writes a NONE row: "QA looked and found nothing" is a fact worth
  // storing, and an absence of rows cannot say it.
  errors: {
    keyPath: "id",
    indexes: [
      { name: "by_version", on: "versionId" },
      { name: "by_project", on: "projectId" },
      { name: "by_priority", on: "priority" },
      { name: "by_at", on: "at" },
    ],
  },
  comments: {
    keyPath: "id",
    indexes: [
      { name: "by_version", on: "versionId" },
      { name: "by_at", on: "at" },
    ],
  },
};

// Carrier master data: entered once, reused on every later VOB for that payer.
// One list, consumed by both prefill and learn-from-call, so the two cannot drift.
export const CARRIER_FIELDS = ["payerId", "insPhone", "claimAddr", "tfl", "tflCorr"];

// Where each field's prefilled value may come from. Order of authority is the
// order of this table: patient beats case beats carrier beats prior.
export const PREFILL_TIER = {
  patient: ["lastName", "firstName", "dob"],
  case: ["insName", "policyId", "groupId", "planType", "planName", "projectName", "category"],
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
export const NEVER_PREFILL = ["today", "termDate", "repName", "callRef", "authNum", "authDates", "note", "verifiedBy",
  "requestDate", "verifType", "username", "requestMode"];

// Fields that change every call and would bury the signal in a "what changed"
// summary. They are still stored on every version.
export const PER_CALL_FIELDS = ["today", "repName", "callRef", "authNum", "note", "verifiedBy",
  "requestDate", "requestMode", "verifType", "username"];

// ---------------------------------------------------------------------------
// Where each field's value comes from.
//
// This is the colour coding on the client's own blank template, made executable.
// It is the spine the rest of the app hangs off: it decides what gets filled from
// our records, what the operator must get from the rep, what is never checked
// against the call at all, and which handful of fields are checked hardest.
//
//   onFile     red text on the template. We already hold it — the patient file or
//              the carrier master. Filled automatically and never chased as "the
//              rep didn't say it". Still fails the record if the call CONTRADICTS
//              it: a carrier record saying 90-day filing against a rep saying 180
//              is the single most valuable thing this app finds.
//
//   internal   yellow highlight. The employee's own judgement or our own clock.
//              Never verified against the call — there is nothing in the call to
//              verify it against.
//
//   ask        green highlight. The reason the call is being made. Extracted from
//              the transcript where possible, required, verified normally.
//
//   askStrict  green highlight with red text. The money and the authorization
//              rules. Same as `ask`, but a wrong value here costs the practice
//              money or has them treating without cover, so these get the higher
//              auto-fill bar, the qualifier guard, the arithmetic identities, and
//              individual sign-off rather than a bulk accept.
//
//   unclassed  uncoloured on the template. Captured when available, required of
//              nobody.
// ---------------------------------------------------------------------------

const CLASSES = {
  // insName sits here rather than in `ask` for the same reason as the patient's
  // name: it is how we knew which number to dial. Nobody asks the rep who they
  // work for. It is still hard-required at save, alongside the patient name.
  onFile: ["lastName", "firstName", "dob", "insName", "insPhone", "claimAddr", "payerId", "tfl", "tflCorr"],
  // The bookkeeping fields belong here for the reason the class exists: there is
  // nothing in a phone call to verify a project name or a request date against, so
  // grading them would only ever produce noise.
  // `initialTx` is here rather than in `ask` because the practice owns that date,
  // not the payer — the rep is never asked when treatment starts, so grading it
  // against the call would mark every record "not heard".
  // `pat` is typed by hand into the summary and belongs to nobody but the person
  // filling the form, so — like the note beside it — there is nothing in the call
  // to grade it against.
  // `authStatus` is the outcome of a workflow step, usually obtained through a payer
  // portal hours after the call ended — there is nothing in the transcript to grade
  // it against. `vobRequired` is ours to decide before anyone dials.
  internal: ["today", "note", "pat", "projectName", "category", "requestMode", "requestDate", "verifType",
    "username", "initialTx", "authStatus", "vobRequired"],
  ask: [
    "policyId", "groupId", "serviceType", "planType", "planName", "network", "networkInd", "coverage",
    "effDate", "termDate", "copayAmt", "visitLimit", "visitUsed", "authWindow", "repName", "callRef",
  ],
  askStrict: [
    "dedApply", "dedInd", "dedMet", "dedRem",
    "coins", "coinsAmt", "covPct",
    "oop", "oopMet", "oopRem",
    "authEval", "authTx", "referral", "pcpRef",
  ],
};

export const FIELD_CLASS = Object.fromEntries(
  Object.entries(CLASSES).flatMap(([cls, keys]) => keys.map((k) => [k, cls])));

export const classOf = (key) => FIELD_CLASS[key] || "unclassed";
export const isOnFile = (key) => classOf(key) === "onFile";
export const isInternal = (key) => classOf(key) === "internal";
export const isStrict = (key) => classOf(key) === "askStrict";
export const isAsked = (key) => { const c = classOf(key); return c === "ask" || c === "askStrict"; };
export const keysOfClass = (cls) => CLASSES[cls] ? [...CLASSES[cls]] : [];

// Everything the rep is expected to provide. `completeness.js` derives its
// required list from this, so "Still to ask" means literally that.
export const ASKED_FIELDS = [...CLASSES.ask, ...CLASSES.askStrict];

export const tierOf = (key) => {
  for (const [tier, keys] of Object.entries(PREFILL_TIER)) if (keys.includes(key)) return tier;
  if (REFERENCE_FIELDS.includes(key)) return "reference";
  return "none";
};
