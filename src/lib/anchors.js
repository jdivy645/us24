// Where each field's subject is discussed in a call, as literal lowercase token
// phrases (prepTranscript splits "co-pay" into "co"+"pay", so compounds are listed).
// m = how to read a value near the anchor. "none" fields are never accused of a
// mismatch — speech mangles names and prose too badly to call anyone wrong.
export const ANCHORS = {
  dob: { m: "date", heads: [["date", "of", "birth"], ["birth", "date"], ["birthday"], ["dob"], ["born"]] },

  policyId: { m: "id", g: "id", q: ["member", "policy", "subscriber", "insured"],
    heads: [["member", "id"], ["member", "number"], ["policy", "id"], ["policy", "number"], ["subscriber", "id"], ["subscriber", "number"], ["id", "number"], ["member"]] },
  groupId: { m: "id", g: "id", q: ["group"], heads: [["group", "id"], ["group", "number"], ["group"]] },
  payerId: { m: "id", g: "id", q: ["payer", "payor", "electronic", "edi"],
    heads: [["payer", "id"], ["payor", "id"], ["payer", "number"], ["electronic", "payer"], ["edi"]] },
  authNum: { m: "id", g: "id", q: ["authorization", "auth", "cert", "certification"],
    heads: [["authorization", "number"], ["auth", "number"], ["authorization", "id"], ["cert", "number"]] },
  callRef: { m: "id", g: "id", q: ["reference", "call", "confirmation", "tracking", "ticket"],
    heads: [["reference", "number"], ["call", "reference"], ["confirmation", "number"], ["tracking", "number"], ["ticket", "number"], ["reference"], ["ref"]] },
  secPolicy: { m: "id", g: "id", q: ["secondary"], heads: [["secondary", "id"], ["secondary", "policy"], ["secondary", "member"]] },

  effDate: { m: "date", q: ["effective", "active", "started", "begins", "inception"],
    heads: [["effective", "date"], ["effective"], ["active", "since"], ["inception"]] },

  copayAmt: { m: "money", g: "cost", q: ["copay", "copayment", "pay"],
    heads: [["copay"], ["copays"], ["copayment"], ["co", "pay"], ["co", "payment"]] },
  coinsAmt: { m: "percent", g: "cost", q: ["coinsurance", "insurance"],
    heads: [["coinsurance"], ["co", "insurance"]] },
  covPct: { m: "percent", g: "cost", q: ["covered", "coverage", "covers", "pays", "paid", "benefit"],
    heads: [["covered", "at"], ["covered"], ["coverage"], ["covers"], ["plan", "pays"], ["benefit", "level"]] },
  hra: { m: "money", heads: [["hra"], ["hca"], ["health", "reimbursement"], ["reimbursement", "account"]] },

  dedInd: { m: "money", g: "ded", base: true, q: ["individual", "single", "member", "annual", "yearly", "calendar"],
    heads: [["deductible"], ["deductibles"]] },
  dedMet: { m: "money", g: "ded", q: ["met", "satisfied", "applied", "toward", "towards", "used"],
    heads: [["deductible"], ["deductibles"]] },
  dedRem: { m: "money", g: "ded", q: ["remaining", "remains", "left", "balance", "outstanding", "unmet", "still"],
    heads: [["deductible"], ["deductibles"]] },

  oop: { m: "money", g: "oop", base: true, q: ["maximum", "max", "limit", "annual", "individual", "single"],
    heads: [["out", "of", "pocket"], ["oop"]] },
  oopMet: { m: "money", g: "oop", q: ["met", "satisfied", "applied", "used"], heads: [["out", "of", "pocket"], ["oop"]] },
  oopRem: { m: "money", g: "oop", q: ["remaining", "remains", "left", "balance", "outstanding", "unmet", "still"],
    heads: [["out", "of", "pocket"], ["oop"]] },

  visitLimit: { m: "count", g: "visit", base: true, q: ["limit", "limitation", "allowed", "maximum", "max", "per", "cap"],
    heads: [["visit", "limit"], ["visit", "limitation"], ["visits", "per"], ["visits"], ["visit"]] },
  visitUsed: { m: "count", g: "visit", q: ["used", "utilized", "consumed", "far", "already", "rendered"],
    heads: [["visits", "used"], ["visits"], ["used"]] },

  authWindow: { m: "duration", g: "window", q: ["auth", "authorization", "request", "submit", "obtain", "prior"],
    heads: [["auth", "window"], ["request", "within"], ["submit", "within"], ["prior", "authorization"]] },
  tfl: { m: "duration", g: "window", q: ["claim", "claims", "file", "filing", "timely", "bill", "billing"],
    heads: [["timely", "filing"], ["filing", "limit"], ["file", "claims"], ["claims", "must"], ["tfl"]] },
  tflCorr: { m: "duration", g: "window", q: ["corrected", "correction", "corrections", "resubmit", "resubmission", "rebill"],
    heads: [["corrected", "claim"], ["corrected", "claims"], ["corrections"], ["resubmission"]] },

  insPhone: { m: "phone", heads: [["phone", "number"], ["phone"], ["call", "us", "at"], ["reach", "us", "at"], ["provider", "services"]] },

  // yes/no + enum topics — the decision comes from clause polarity, not a value
  network: { m: "enum2", heads: [["network"], ["participating"], ["contracted"]] },
  copay: { m: "yesno", heads: [["copay"], ["copays"], ["copayment"], ["co", "pay"], ["co", "payment"]] },
  coins: { m: "yesno", heads: [["coinsurance"], ["co", "insurance"], ["co", "ins"]] },
  dedApply: { m: "yesno", heads: [["deductible"], ["deductibles"]] },
  // "evaluation"/"treatment" alone are ordinary coverage words — only an auth
  // word may open the topic, and the qualifier then decides which of the two.
  authEval: { m: "yesno", g: "auth", q: ["eval", "evaluation", "initial", "assessment"],
    heads: [["authorization"], ["auth"], ["precert"], ["precertification"], ["preauthorization"]] },
  authTx: { m: "yesno", g: "auth", q: ["treatment", "treatments", "ongoing", "subsequent", "therapy", "visits"],
    heads: [["authorization"], ["auth"], ["precert"], ["precertification"], ["preauthorization"]] },
  referral: { m: "yesno", heads: [["referral"], ["referrals"]] },
  pcpRef: { m: "yesno", heads: [["pcp"], ["primary", "care"]] },
  hasSec: { m: "yesno", heads: [["secondary"], ["supplemental"], ["supplement"], ["cob"], ["other", "insurance"], ["other", "coverage"]] },

  // never accused of a mismatch — speech mangles these
  lastName: { m: "none" }, firstName: { m: "none" }, repName: { m: "none" },
  insName: { m: "none" }, planType: { m: "none" }, coverage: { m: "none" },
  authHow: { m: "none" }, secName: { m: "none" }, authDates: { m: "none" }, claimAddr: { m: "none" },
};

// Qualifiers belonging to a sibling concept the form does not track — they veto
// every member of the group ("family deductible" is not the individual one).
const FOREIGN = {
  ded: ["family", "household", "embedded", "aggregate"],
  oop: ["family", "household", "embedded", "aggregate"],
  visit: ["combined", "shared", "chiropractic", "speech", "occupational"],
  window: ["appeal", "appeals", "reconsideration", "grievance", "dispute"],
  cost: ["specialist", "emergency", "urgent", "inpatient", "hospital"],
  id: [], auth: [],
};

// firstToken -> [{key, phrase}], longest phrase first
export const HEAD_IX = new Map();
export const OWN_Q = new Map();
export const SIB_Q = new Map();
export const MTYPE = new Map();
export const TOPIC_TOKENS = new Set();

for (const [key, spec] of Object.entries(ANCHORS)) {
  MTYPE.set(key, spec.m);
  OWN_Q.set(key, new Set(spec.q || []));
  for (const phrase of spec.heads || []) {
    const head = phrase[0];
    if (!HEAD_IX.has(head)) HEAD_IX.set(head, []);
    HEAD_IX.get(head).push({ key, phrase });
    TOPIC_TOKENS.add(head);
  }
}
for (const list of HEAD_IX.values()) list.sort((a, b) => b.phrase.length - a.phrase.length);

// siblings' qualifiers are derived, never hand-written, so the lists can't drift
for (const [key, spec] of Object.entries(ANCHORS)) {
  const sib = new Set(spec.g ? FOREIGN[spec.g] || [] : []);
  if (spec.g) {
    for (const [k2, s2] of Object.entries(ANCHORS)) {
      if (k2 === key || s2.g !== spec.g) continue;
      for (const q of s2.q || []) sib.add(q);
    }
  }
  for (const q of spec.q || []) sib.delete(q);
  SIB_Q.set(key, sib);
}

// money/percent/count/duration compete for the same numbers; ids compete with ids
export const FAMILY = { money: "num", percent: "num", count: "num", duration: "num", id: "id", phone: "id", date: "date" };

// Words that show the call was actually TALKING ABOUT this field. A typed value
// only counts as confirmed when it was spoken near one of these — otherwise a
// name mentioned once in the call would "confirm" every field it was typed into.
export const KEYWORDS = {
  lastName: [["name"], ["patient"], ["member"], ["subscriber"], ["insured"], ["spelled"], ["spell"], ["surname"]],
  firstName: [["name"], ["patient"], ["member"], ["subscriber"], ["insured"], ["spelled"], ["spell"]],
  repName: [["name"], ["speaking"], ["this", "is"], ["rep"], ["representative"], ["agent"], ["assisted"], ["helping"]],
  dob: [["date", "of", "birth"], ["birth"], ["birthday"], ["dob"], ["born"]],
  insName: [["insurance"], ["payer"], ["payor"], ["carrier"], ["plan"], ["calling"], ["policy"], ["coverage"], ["benefits"]],
  planType: [["plan"], ["product"], ["hmo"], ["ppo"], ["epo"], ["pos"], ["medicare"], ["medicaid"], ["policy"], ["coverage"]],
  coverage: [["benefit"], ["benefits"], ["coverage"], ["covered"], ["covers"]],
  policyId: [["member"], ["policy"], ["subscriber"], ["identification"]],
  groupId: [["group"]],
  payerId: [["payer"], ["payor"], ["edi"], ["electronic"]],
  authNum: [["authorization"], ["auth"], ["cert"], ["certification"], ["reference"]],
  callRef: [["reference"], ["ref"], ["confirmation"], ["tracking"], ["ticket"], ["call"]],
  secName: [["secondary", "insurance"], ["secondary", "carrier"], ["secondary", "payer"], ["secondary", "coverage"],
    ["other", "insurance"], ["other", "coverage"], ["secondary"], ["supplemental"], ["supplement"], ["cob"]],
  secPolicy: [["secondary", "policy"], ["secondary", "member"], ["secondary", "id"], ["secondary"], ["supplemental"]],
  effDate: [["effective"], ["active"], ["started"], ["begins"], ["inception"], ["since"]],
  insPhone: [["phone"], ["reach", "us"], ["provider", "line"], ["provider", "services"], ["contact"]],
  copayAmt: [["copay"], ["copays"], ["copayment"], ["co", "pay"], ["co", "payment"]],
  coinsAmt: [["coinsurance"], ["co", "insurance"], ["co", "ins"]],
  covPct: [["covered"], ["coverage"], ["covers"], ["pays"], ["paid"], ["benefit"]],
  hra: [["hra"], ["hca"], ["health", "reimbursement"], ["reimbursement"], ["spending"]],
  dedInd: [["deductible"], ["deductibles"]],
  dedMet: [["deductible"], ["deductibles"], ["met"], ["satisfied"]],
  dedRem: [["deductible"], ["deductibles"], ["remaining"], ["balance"]],
  oop: [["out", "of", "pocket"], ["oop"], ["maximum"], ["max"]],
  oopMet: [["out", "of", "pocket"], ["oop"], ["met"], ["satisfied"]],
  oopRem: [["out", "of", "pocket"], ["oop"], ["remaining"], ["balance"]],
  visitLimit: [["visit"], ["visits"], ["limit"], ["limitation"], ["limited"], ["session"], ["sessions"], ["cap"]],
  visitUsed: [["visit"], ["visits"], ["used"], ["utilized"], ["rendered"]],
  authHow: [["portal"], ["submit"], ["obtain"], ["fax"], ["website"], ["online"], ["request"], ["authorization"], ["auth"]],
  authWindow: [["auth"], ["authorization"], ["request"], ["submit"], ["within"], ["prior"], ["advance"]],
  tfl: [["timely"], ["filing"], ["claim"], ["claims"], ["tfl"], ["billing"]],
  tflCorr: [["corrected"], ["correction"], ["corrections"], ["resubmit"], ["resubmission"], ["rebill"], ["timely"], ["filing"]],
};

export const KEYWORD_WINDOW = 15;
