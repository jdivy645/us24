// Field registry shared by the form, preview, PDF, storage and Excel export.
export const F = ["lastName", "firstName", "dob", "today", "insName", "insPhone", "policyId", "groupId", "planType", "serviceType", "network", "coverage", "effDate", "termDate", "payerId", "hra", "copay", "copayAmt", "covPct", "coins", "coinsAmt", "dedApply", "dedInd", "dedMet", "dedRem", "oop", "oopMet", "oopRem", "visitLimit", "visitUsed", "authEval", "authTx", "referral", "pcpRef", "authHow", "authWindow", "authNum", "authDates", "tfl", "tflCorr", "claimAddr", "repName", "callRef", "verifiedBy", "primary", "hasSec", "secName", "secPlan", "secPolicy", "secEff", "secDed", "secVisit", "secUsed", "note"];

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
export const initialForm = () => ({
  ...blank(),
  today: todayISO(),
  termDate: "CURRENT",
  serviceType: "PT",
});

// "Clear form" in the original blanks every field (selects included), then
// restores only termDate and today.
export const clearedForm = () => ({
  ...blank(),
  termDate: "CURRENT",
  today: todayISO(),
});

const SAMPLE = {
  lastName: "YUSUFF", firstName: "TAJUDEEN", dob: "1957-12-31",
  insName: "AETNA", insPhone: "800-624-0756", policyId: "101619535700", groupId: "000003-TX",
  planType: "HMO AETNA MEDICARE DUAL CARE", serviceType: "PT", network: "IN NETWORK", coverage: "INN BENEFITS WITH AUTH",
  effDate: "2026-03-01", termDate: "CURRENT", payerId: "60054", hra: "NA",
  copay: "NO", copayAmt: "$0.00", covPct: "100%", coins: "NO", coinsAmt: "0%",
  dedApply: "NO", dedInd: "NA", oop: "NA", visitLimit: "MN (medically necessary)", authEval: "YES", authTx: "YES",
  referral: "NO", pcpRef: "NO", authHow: "Through Holista portal", tfl: "120 DAYS FROM DOS", tflCorr: "180 DAYS FROM DOS",
  repName: "CLARK Y", callRef: "358428114", primary: "AETNA", hasSec: "NO",
  note: "Patient is 100% covered by Aetna as per member's plan.",
};

export const sampleForm = () =>
  Object.fromEntries(F.map((k) => [k, k === "today" ? todayISO() : SAMPLE[k] || ""]));

// Trimmed snapshot of the form — the equivalent of collect() in the original.
export const collect = (form) =>
  Object.fromEntries(F.map((k) => [k, (form[k] || "").trim()]));

export const HEAD = { _savedAt: "Saved At", lastName: "Last Name", firstName: "First Name", dob: "DOB", today: "Verification Date", insName: "Insurance", insPhone: "Payer Phone", policyId: "Policy ID", groupId: "Group ID", planType: "Plan Type", serviceType: "Service Type", network: "Network Status", coverage: "Coverage", effDate: "Effective Date", termDate: "Termination Date", payerId: "Payer ID", hra: "HCA/HRA", copay: "Co-pay", copayAmt: "Co-pay Amount", covPct: "Coverage %", coins: "Co-insurance", coinsAmt: "Co-insurance %", dedApply: "Deductible Applies", dedInd: "Deductible Individual", dedMet: "Deductible Met", dedRem: "Deductible Remaining", oop: "Out of Pocket", oopMet: "OOP Met", oopRem: "OOP Remaining", visitLimit: "Visit Limitation", visitUsed: "Visits Used", authEval: "Auth Initial Eval", authTx: "Auth Treatment", referral: "Referral Required", pcpRef: "PCP Referral", authHow: "How To Obtain Auth", authWindow: "Auth Window From DOS", authNum: "Authorization #", authDates: "Auth Coverage Dates", tfl: "TFL Claims", tflCorr: "TFL Corrected", claimAddr: "Claim Mailing Address", repName: "Insurance Rep", callRef: "Call Reference", verifiedBy: "Verified By", primary: "Primary Payer", hasSec: "Secondary On File", secName: "Secondary Insurance", secPlan: "Secondary Plan", secPolicy: "Secondary Policy ID", secEff: "Secondary Effective Date", secDed: "Secondary Deductible", secVisit: "Secondary Visit Limit", secUsed: "Secondary Used Limit", note: "Additional Info", _file: "PDF File", _verdict: "Verdict", _matched: "Matched", _total: "Checked", _missing: "Missing Fields", _mismatch: "Contradicted Fields", _blankCount: "Blank Required", _required: "Required Count", _blank: "Blank Required Fields", _transcript: "Transcript", _audioFile: "Audio File", _source: "Evidence Source" };
