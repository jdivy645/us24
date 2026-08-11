// Field registry shared by the form, preview, PDF, storage and Excel export.
//
// Order is the export order and the iteration order everywhere else, so the
// bookkeeping fields that say WHICH piece of work this is come first, then the
// verification itself in the order the client's own template reads.
export const F = ["projectName", "category", "requestMode", "verifType", "vobRequired", "lastName", "firstName", "dob", "requestDate", "today", "insName", "insPhone", "policyId", "groupId", "planType", "planName", "serviceType", "network", "networkInd", "coverage", "effDate", "termDate", "payerId", "hra", "copay", "copayAmt", "covPct", "coins", "coinsAmt", "dedApply", "dedInd", "dedMet", "dedRem", "oop", "oopMet", "oopRem", "visitLimit", "visitUsed", "initialTx", "authEval", "authTx", "authAfter", "referral", "pcpRef", "authHow", "authWindow", "authNum", "authDates", "authStatus", "tfl", "tflCorr", "claimAddr", "repName", "callRef", "username", "verifiedBy", "primary", "hasSec", "secName", "secPlan", "secPolicy", "secEff", "secDed", "secVisit", "secUsed", "pat", "note"];

// Closed sets for the bookkeeping selects. Exported so the form, the import
// mapper and the requirement config all offer the same words.
export const REQUEST_MODES = ["CALL", "FAX", "WEBSITE"];
export const VERIF_TYPES = ["INITIAL", "RE-VERIFICATION"];
export const AUTH_STATUSES = ["PENDING", "APPROVED", "DENIED"];
export const YES_NO = ["YES", "NO"];

// Carried from one record to the next when the form is cleared. A day's work is
// usually one project and one operator; retyping those on every patient is how a
// batch of thirty records ends up with four different spellings of the project.
export const STICKY = ["projectName", "category", "requestMode", "username"];

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const fmtDate = (s) => {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, dd] = s.split("-");
    return `${m}/${dd}/${y}`;
  }
  return s;
};

export const dash = (v) => (v ? v : "—");

const blank = () => Object.fromEntries(F.map((k) => [k, ""]));

// Answer-bearing selects start blank on purpose: a pre-picked default would count
// as "answered" for completeness and would be verified against the call even
// though nobody chose it. Only non-answer fields keep a default.
//
// termDate used to default to "CURRENT", which was a verify.js SKIP token — so
// the field arrived pre-filled AND silently exempt from both checks. It now starts
// blank; effRange() still prints "TO CURRENT" for a blank or negative value.
// requestMode and verifType carry defaults where the answer-bearing selects do not:
// they are internal bookkeeping, never checked against the call, and CALL/INITIAL is
// what the great majority of records are. buildPrefill() flips verifType to
// RE-VERIFICATION as soon as a prior case for this patient and policy is found.
//
// requestDate deliberately starts blank. Defaulting it to today would make every
// record show a turnaround of zero days, which is worse than asking for it.
export const initialForm = () => ({
  ...blank(),
  today: todayISO(),
  serviceType: "PT",
  requestMode: "CALL",
  verifType: "INITIAL",
  vobRequired: "YES",
});

// `keep` carries the sticky bookkeeping fields forward between records in a batch.
export const clearedForm = (keep = {}) => ({
  ...blank(),
  today: todayISO(),
  requestMode: "CALL",
  verifType: "INITIAL",
  vobRequired: "YES",
  ...Object.fromEntries(STICKY.map((k) => [k, keep[k] || ""]).filter(([, v]) => v)),
});

const SAMPLE = {
  projectName: "DEMO", category: "VOB", requestMode: "CALL", verifType: "INITIAL", username: "DEMO USER",
  lastName: "YUSUFF", firstName: "TAJUDEEN", dob: "1957-12-31",
  insName: "AETNA", insPhone: "800-624-0756", policyId: "101619535700", groupId: "000003-TX",
  planType: "HMO AETNA MEDICARE DUAL CARE", planName: "AETNA MEDICARE DUAL CARE PLAN (HMO D-SNP)",
  serviceType: "PT", network: "IN NETWORK", coverage: "INN BENEFITS WITH AUTH",
  effDate: "2026-03-01", termDate: "CURRENT", payerId: "60054", hra: "NA",
  copay: "NO", copayAmt: "$0.00", covPct: "100%", coins: "NO", coinsAmt: "0%",
  dedApply: "NO", dedInd: "NA", oop: "NA", visitLimit: "MN (medically necessary)", visitUsed: "0",
  authWindow: "14 DAYS", authEval: "YES", authTx: "YES",
  referral: "NO", pcpRef: "NO", authHow: "Through Holista portal", tfl: "120 DAYS FROM DOS", tflCorr: "180 DAYS FROM DOS",
  repName: "CLARK Y", callRef: "358428114", primary: "AETNA", hasSec: "NO",
  note: "Patient is 100% covered by Aetna as per member's plan.",
};

// The dates move with the clock, so the demo record is never stale-dated. The
// initial treatment date sits a week out — a plausible start of care.
const AHEAD = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const SAMPLE_DATES = { today: () => todayISO(), requestDate: () => todayISO(), initialTx: () => AHEAD(7) };

export const sampleForm = () =>
  Object.fromEntries(F.map((k) => [k, SAMPLE_DATES[k] ? SAMPLE_DATES[k]() : SAMPLE[k] || ""]));

// Trimmed snapshot of the form — the equivalent of collect() in the original.
export const collect = (form) =>
  Object.fromEntries(F.map((k) => [k, (form[k] || "").trim()]));

export const HEAD = { _savedAt: "Saved At", projectName: "Project", category: "Category", requestMode: "Request Mode", verifType: "Verification Type", vobRequired: "VOB Required", lastName: "Last Name", firstName: "First Name", dob: "DOB", requestDate: "Request Date", today: "Verification Date", insName: "Insurance", insPhone: "Payer Phone", policyId: "Policy ID", groupId: "Group ID", planType: "Plan Type", planName: "Plan Name", serviceType: "Service Type", network: "Network Status (Group)", networkInd: "Network Status (Ind Prov)", coverage: "Coverage", effDate: "Effective Date", termDate: "Termination Date", payerId: "Payer ID", hra: "HCA/HRA", copay: "Co-pay", copayAmt: "Co-pay Amount", covPct: "Coverage %", coins: "Co-insurance", coinsAmt: "Co-insurance %", dedApply: "Deductible Applies", dedInd: "Deductible Individual", dedMet: "Deductible Met", dedRem: "Deductible Remaining", oop: "Out of Pocket", oopMet: "OOP Met", oopRem: "OOP Remaining", visitLimit: "Visit Limitation", visitUsed: "Visits Used", initialTx: "Initial Treatment Date", authEval: "Auth Initial Eval", authTx: "Auth Treatment", authAfter: "Auth After Visit #", referral: "Referral Required", pcpRef: "PCP Referral", authHow: "How To Obtain Auth", authWindow: "Auth Window From DOS", authNum: "Authorization #", authDates: "Auth Coverage Dates", authStatus: "Authorization Outcome", tfl: "TFL Claims", tflCorr: "TFL Corrected", claimAddr: "Claim Mailing Address", repName: "Insurance Rep", callRef: "Call Reference", username: "Entered By", verifiedBy: "Verified By", primary: "Primary Payer", hasSec: "Secondary On File", secName: "Secondary Insurance", secPlan: "Secondary Plan", secPolicy: "Secondary Policy ID", secEff: "Secondary Effective Date", secDed: "Secondary Deductible", secVisit: "Secondary Visit Limit", secUsed: "Secondary Used Limit", pat: "PAT", note: "Additional Info", _file: "PDF File", _verdict: "Verdict", _matched: "Matched", _total: "Checked", _missing: "Missing Fields", _mismatch: "Contradicted Fields", _blankCount: "Blank Required", _required: "Required Count", _blank: "Blank Required Fields", _transcript: "Transcript", _audioFile: "Audio File", _source: "Evidence Source", _contested: "Rep Contradicted Self", _echoed: "Said By Us, Not Confirmed", _bypassed: "Bypassed Fields", _bypassReasons: "Bypass Reasons", _carrier: "Carrier-Sourced Fields", _attested: "Machine-Read, Human-Accepted", _autofillEdited: "Machine Value Corrected", _extractQuotes: "Call Quotes For Accepted Values", _typed: "Typed By Operator",
  // Written after the record is saved, so they live on the version envelope rather
  // than in the form snapshot — the snapshot is what was verified against the call
  // and must not move afterwards.
  _status: "Status", _qaName: "QA By", _submittedAt: "Submitted At", _qaAt: "QA At",
  _errorCount: "Error Count", _openCount: "Open Findings", _topPriority: "Highest Priority",
  _score: "Quality Score", _correctedAt: "Corrected At", _errors: "QA Errors",
  _comments: "Comments", _authRequired: "Authorization Required" };
