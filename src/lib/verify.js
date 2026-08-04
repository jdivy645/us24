// Transcript ↔ form verification engine. Pure functions, no React.
//
// A check ends in one of four states:
//   found     the typed value was heard
//   mismatch  the call says something DIFFERENT (or the opposite, for yes/no)
//   missing   the typed value was never heard
//   quiet     the topic never came up (yes/no + enum only — never fails a record)
//
// Gates: "hard" fields must be found; "contra" fields fail only on a contradiction
// (they are answer selects — silence means the rep never covered it, not an error);
// "soft" fields are advisory and never affect the verdict.
import { ANCHORS, HEAD_IX, OWN_Q, SIB_Q, MTYPE, TOPIC_TOKENS, FAMILY, KEYWORDS, KEYWORD_WINDOW } from "./anchors.js";

export const VERIFY_FIELDS = [
  { key: "lastName", label: "Last name", type: "name", gate: "hard" },
  { key: "firstName", label: "First name", type: "name", gate: "hard" },
  { key: "dob", label: "Date of birth", type: "date", gate: "hard" },
  { key: "insName", label: "Insurance", type: "tokens", gate: "hard" },
  { key: "policyId", label: "Policy ID", type: "id", gate: "hard" },
  { key: "groupId", label: "Group ID", type: "id", gate: "hard" },
  { key: "payerId", label: "Payer ID", type: "id", gate: "hard" },
  { key: "effDate", label: "Effective date", type: "date", gate: "hard" },
  { key: "planType", label: "Plan type", type: "tokens", gate: "hard" },
  { key: "coverage", label: "Coverage", type: "tokens", gate: "hard" },
  { key: "hra", label: "HCA/HRA", type: "money", gate: "hard" },
  { key: "copayAmt", label: "Co-pay amount", type: "money", gate: "hard" },
  { key: "covPct", label: "Coverage %", type: "percent", gate: "hard" },
  { key: "coinsAmt", label: "Co-insurance %", type: "percent", gate: "hard" },
  { key: "dedInd", label: "Deductible (individual)", type: "money", gate: "hard" },
  { key: "dedMet", label: "Deductible met", type: "money", gate: "hard" },
  { key: "dedRem", label: "Deductible remaining", type: "money", gate: "hard" },
  { key: "oop", label: "Out of pocket max", type: "money", gate: "hard" },
  { key: "oopMet", label: "OOP met", type: "money", gate: "hard" },
  { key: "oopRem", label: "OOP remaining", type: "money", gate: "hard" },
  { key: "visitLimit", label: "Visit limitation", type: "tokens", gate: "hard" },
  { key: "visitUsed", label: "Visits used", type: "number", gate: "hard" },
  { key: "authNum", label: "Authorization #", type: "id", gate: "hard" },
  { key: "authHow", label: "How to obtain auth", type: "tokens", gate: "hard" },
  { key: "authWindow", label: "Auth window", type: "tokens", gate: "hard" },
  { key: "tfl", label: "Timely filing — claims", type: "tokens", gate: "hard" },
  { key: "tflCorr", label: "Timely filing — corrected", type: "tokens", gate: "hard" },
  { key: "repName", label: "Insurance rep", type: "name", gate: "hard" },
  { key: "callRef", label: "Call reference", type: "id", gate: "hard" },
  { key: "secName", label: "Secondary insurance", type: "tokens", gate: "hard" },
  { key: "secPolicy", label: "Secondary policy ID", type: "id", gate: "hard" },
  // answer selects — contradiction fails, silence is quiet
  { key: "network", label: "Network status", type: "enum", gate: "contra" },
  { key: "copay", label: "Co-pay", type: "yesno", gate: "contra" },
  { key: "coins", label: "Co-insurance", type: "yesno", gate: "contra" },
  { key: "dedApply", label: "Deductible applies", type: "yesno", gate: "contra" },
  { key: "authEval", label: "Auth — initial eval", type: "yesno", gate: "contra" },
  { key: "authTx", label: "Auth — treatment", type: "yesno", gate: "contra" },
  { key: "referral", label: "Referral required", type: "yesno", gate: "contra" },
  { key: "pcpRef", label: "PCP referral", type: "yesno", gate: "contra" },
  { key: "hasSec", label: "Secondary on file", type: "yesno", gate: "contra" },
  // advisory
  { key: "insPhone", label: "Payer phone", type: "phone", gate: "soft" },
  { key: "authDates", label: "Auth coverage dates", type: "tokens", gate: "soft" },
  { key: "claimAddr", label: "Claim mailing address", type: "tokens", gate: "soft" },
];

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const SKIP = new Set(["", "NA", "NONE", "TBD", "TBA", "CURRENT", "UNKNOWN", "PENDING", "NOTPROVIDED"]);
export const isSkipped = (value) => SKIP.has(norm(value));

const STOP = new Set(["the", "and", "for", "with", "from", "per", "of", "to", "is", "are", "days", "day", "months", "month", "a", "an"]);
const FILLER = new Set(["of", "the"]);
const UNITS_W = new Set(["day", "days", "week", "weeks", "month", "months", "year", "years", "visit", "visits", "session", "sessions"]);

// Form-side only: the rep says the words the form abbreviates.
const SYNONYM = {
  dos: [["date", "of", "service"], ["dates", "of", "service"], ["service", "date"]],
  dob: [["date", "of", "birth"]],
  mn: [["medically", "necessary"], ["medical", "necessity"], ["no", "visit", "limit"], ["unlimited"]],
  inn: [["in", "network"], ["participating"], ["contracted"]],
  oon: [["out", "of", "network"], ["non", "participating"]],
  tfl: [["timely", "filing"], ["filing", "limit"], ["filing", "deadline"]],
  pcp: [["primary", "care"], ["primary", "care", "physician"]],
  oop: [["out", "of", "pocket"]],
  hra: [["health", "reimbursement"]],
  eval: [["evaluation"]],
  auth: [["authorization"], ["prior", "authorization"], ["precertification"]],
  tx: [["treatment"]],
  ov: [["office", "visit"]],
};

const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NATO = { alpha: "a", bravo: "b", charlie: "c", delta: "d", echo: "e", foxtrot: "f", golf: "g", hotel: "h", india: "i", juliet: "j", kilo: "k", lima: "l", mike: "m", november: "n", oscar: "o", papa: "p", quebec: "q", romeo: "r", sierra: "s", tango: "t", uniform: "u", victor: "v", whiskey: "w", xray: "x", yankee: "y", zulu: "z" };

const smallNum = (t) => {
  if (t in UNITS) return { n: UNITS[t], k: "unit" };
  if (t in TEENS) return { n: TEENS[t], k: "teen" };
  if (t in TENS) return { n: TENS[t], k: "tens" };
  if (t in ORDS) return { n: ORDS[t], k: ORDS[t] < 10 ? "unit" : "big" };
  return null;
};

/* ------------------------------------------------------------------ *
 * Transcript preprocessing
 * ------------------------------------------------------------------ */

function tokenize(text) {
  const raw = [];
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|[a-z0-9]+/gi)) {
    let t = m[0].toLowerCase().replace(/,/g, "");
    const om = t.match(/^(\d+)(st|nd|rd|th)$/);
    if (om) t = om[1];
    raw.push({ t, start: m.index, end: m.index + m[0].length });
  }
  // spelled-out runs: "y u s u f f" -> "yusuff"
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    if (/^[a-z]$/.test(raw[i].t)) {
      let j = i;
      while (j < raw.length && /^[a-z]$/.test(raw[j].t)) j++;
      if (j - i >= 3) {
        out.push({ t: raw.slice(i, j).map((x) => x.t).join(""), start: raw[i].start, end: raw[j - 1].end });
        i = j - 1;
        continue;
      }
    }
    out.push(raw[i]);
  }
  return out;
}

function numberize(src) {
  const toks = [];
  const isNumish = (x) => x && (smallNum(x.t) !== null || x.t === "oh" || /^\d/.test(x.t));
  for (let i = 0; i < src.length; i++) {
    const tok = src[i];
    // decimals count as numbers, but are kept out of the digit stream so they
    // can never be glued into an ID or phone match
    if (/^\d/.test(tok.t)) { toks.push({ ...tok, num: true, dec: tok.t.includes(".") }); continue; }
    if ((tok.t === "a" || tok.t === "an") && src[i + 1] && (src[i + 1].t === "hundred" || src[i + 1].t === "thousand")) {
      toks.push({ t: src[i + 1].t === "hundred" ? "100" : "1000", start: tok.start, end: src[i + 1].end, num: true });
      i++;
      continue;
    }
    if ((tok.t === "double" || tok.t === "triple") && src[i + 1]) {
      const nx = src[i + 1], sn = smallNum(nx.t);
      const digit = /^\d$/.test(nx.t) ? nx.t : sn && sn.n < 10 ? String(sn.n) : nx.t === "oh" ? "0" : null;
      if (digit !== null) { toks.push({ t: digit.repeat(tok.t === "double" ? 2 : 3), start: tok.start, end: nx.end, num: true }); i++; continue; }
    }
    if (tok.t === "oh") {
      if (isNumish(src[i - 1]) || isNumish(src[i + 1])) toks.push({ t: "0", start: tok.start, end: tok.end, num: true });
      else toks.push({ ...tok });
      continue;
    }
    const sn = smallNum(tok.t);
    if (!sn) { toks.push({ ...tok }); continue; }

    // read one spoken number group: [tens+unit] [hundred [rest]] [thousand [rest]]
    let n = sn.n, end = tok.end, j = i + 1;
    const readSmall = () => {
      const a = src[j] && smallNum(src[j].t);
      if (!a || a.n >= 100) return null;
      let val = a.n, e = src[j].end;
      j++;
      if (a.k === "tens" && src[j]) {
        const b = smallNum(src[j].t);
        if (b && b.k === "unit" && b.n > 0) { val += b.n; e = src[j].end; j++; }
      }
      return { val, e };
    };
    if (sn.k === "tens" && src[j]) {
      const u = smallNum(src[j].t);
      if (u && u.k === "unit" && u.n > 0) { n += u.n; end = src[j].end; j++; }
    }
    if (src[j] && src[j].t === "hundred") {
      n *= 100; end = src[j].end; j++;
      if (src[j] && src[j].t === "and" && src[j + 1] && smallNum(src[j + 1].t)) j++;
      const r = readSmall();
      if (r) { n += r.val; end = r.e; }
    }
    if (src[j] && src[j].t === "thousand") {
      n *= 1000; end = src[j].end; j++;
      if (src[j] && src[j].t === "and" && src[j + 1] && smallNum(src[j + 1].t)) j++;
      const h = src[j] && smallNum(src[j].t);
      if (h && src[j + 1] && src[j + 1].t === "hundred") {
        n += h.n * 100; end = src[j + 1].end; j += 2;
        const r2 = readSmall();
        if (r2) { n += r2.val; end = r2.e; }
      } else {
        const r = readSmall();
        if (r) { n += r.val; end = r.e; }
      }
    }
    toks.push({
      t: String(n), start: tok.start, end, num: true,
      ...(tok.t === "zero" && n === 0 ? { zeroWord: true } : {}),
      ...(tok.t in ORDS ? { ord: true } : {}),
    });
    i = j - 1;
  }
  return toks;
}

// "nineteen fifty seven" -> 1957, but keep the parts so "an eighty twenty split"
// still matches 80 and 20.
function mergeYears(toks) {
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i], b = toks[i + 1];
    if (a.num && (a.t === "19" || a.t === "20") && b.num && b.t.length === 2 && !a.alts && !b.alts) {
      toks[i] = { t: a.t + b.t, start: a.start, end: b.end, num: true, alts: [a.t, b.t] };
      toks.splice(i + 1, 1);
    }
  }
  return toks;
}

const CONTRAST = new Set(["but", "however", "although", "though", "whereas", "otherwise", "instead", "except", "unless"]);
const WEAK_CUT = new Set(["and", "or", "plus", "also", "then", "so", "now", "okay", "ok", "alright", "next", "actually"]);
const Q_START = new Set(["is", "are", "do", "does", "did", "can", "will", "would", "what", "how", "any", "was", "were"]);
const AGREE = new Set(["yes", "yeah", "yep", "yup", "no", "nope", "correct", "right", "exactly", "absolutely", "sure", "uh", "huh", "mhm", "that", "s", "it", "ok", "okay"]);

function segment(text, toks) {
  const cuts = new Set([0]);
  const hard = new Set([0]);
  for (let i = 1; i < toks.length; i++) {
    const gap = text.slice(toks[i - 1].end, toks[i].start);
    if (/[.?!;\n]|—|--/.test(gap)) { cuts.add(i); hard.add(i); continue; }
    if (CONTRAST.has(toks[i].t)) { cuts.add(i); hard.add(i); continue; }
  }
  // weak cuts only where both sides carry a topic
  const hardArr = [...hard].sort((a, b) => a - b);
  const segEnd = (i) => { for (const h of hardArr) if (h > i) return h; return toks.length; };
  for (let i = 1; i < toks.length; i++) {
    if (hard.has(i)) continue;
    const gap = text.slice(toks[i - 1].end, toks[i].start);
    if (!gap.includes(",") && !WEAK_CUT.has(toks[i].t)) continue;
    let lo = 0;
    for (const h of hardArr) if (h <= i) lo = h;
    const hi = segEnd(i);
    const has = (a, b) => { for (let k = a; k < b; k++) if (TOPIC_TOKENS.has(toks[k].t)) return true; return false; };
    if (has(lo, i) && has(i, hi)) cuts.add(i);
  }
  // runaway guard, measured from the previous cut so a long greeting can't shift
  // every later clause boundary
  const ordered = [...cuts].sort((a, b) => a - b);
  for (let k = 0; k < ordered.length; k++) {
    const from = ordered[k], to = k + 1 < ordered.length ? ordered[k + 1] : toks.length;
    for (let i = from + 35; i < to; i += 35) cuts.add(i);
  }

  const starts = [...cuts].sort((a, b) => a - b);
  const clauses = [];
  for (let c = 0; c < starts.length; c++) {
    const i0 = starts[c], i1 = c + 1 < starts.length ? starts[c + 1] : toks.length;
    if (i1 <= i0) continue;
    const endGap = i1 < toks.length ? text.slice(toks[i1 - 1].end, toks[i1].start) : text.slice(toks[i1 - 1].end);
    const words = [];
    for (let k = i0; k < i1; k++) { toks[k].ci = clauses.length; words.push(toks[k].t); }
    const q = /\?/.test(endGap) || Q_START.has(words[0]);
    const answer = words.length <= 4 && words.every((w) => AGREE.has(w));
    clauses.push({
      i0, i1, words,
      kind: answer ? "answer" : q ? "q" : "stmt",
      contrast: CONTRAST.has(words[0]),
    });
  }
  return clauses;
}

export function prepTranscript(text) {
  const toks = mergeYears(numberize(tokenize(text)));
  // Numbers separated by speech get a break in the stream, so digits from two
  // unrelated numbers can never combine into a "matching" ID.
  let digitStream = "";
  const digitMap = [];
  let prevNum = false;
  for (const tok of toks) {
    if (!tok.num || tok.dec) {
      if (prevNum) { digitStream += "|"; digitMap.push(null); prevNum = false; }
      continue;
    }
    for (const c of tok.t) { digitStream += c; digitMap.push(tok); }
    prevNum = true;
  }
  const clauses = segment(text, toks);
  return { text, toks, clauses, digitStream, digitMap, punct: /[.?!]/.test(text) };
}

// The same transcript is prepped by App's memo, TranscriptView and the .txt export.
let _cache = { text: null, prep: null };
export const getPrep = (t) => (_cache.text === t ? _cache.prep : (_cache = { text: t, prep: prepTranscript(t) }).prep);

const valueTokens = (value) => prepTranscript(value).toks.map((x) => x.t);

/* ------------------------------------------------------------------ *
 * Presence matchers
 * ------------------------------------------------------------------ */

const NONE = { found: false, spans: [] };
const span = (a, b) => ({ start: a.start, end: (b || a).end });
const numEq = (a, b) => /^\d+(\.\d+)?$/.test(a) && /^\d+(\.\d+)?$/.test(b) && Number(a) === Number(b);
const tokIsNum = (tok, s) => tok.num && (numEq(tok.t, s) || (tok.alts || []).some((a) => numEq(a, s)));
const tokEq = (a, b) => a === b || numEq(a, b) || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

function digitSearch(prep, digits) {
  if (!digits) return NONE;
  const i = prep.digitStream.indexOf(digits);
  if (i < 0) return NONE;
  return { found: true, spans: [span(prep.digitMap[i], prep.digitMap[i + digits.length - 1])] };
}

// a number spoken as one token, or as a short run that concatenates ("one twenty")
function findNum(prep, numStr) {
  const hit = prep.toks.find((x) => tokIsNum(x, numStr));
  if (hit) return { found: true, spans: [span(hit)], tok: hit };
  const toks = prep.toks;
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i].num || toks[i].dec || toks[i].ord) continue;
    let j = i;
    while (j < toks.length && toks[j].num && !toks[j].dec && !toks[j].ord) j++;
    if (j - i >= 2 && j - i <= 3) {
      let cat = "";
      for (let k = i; k < j; k++) cat += toks[k].t;
      if (numEq(cat, numStr)) return { found: true, spans: [span(toks[i], toks[j - 1])], tok: toks[i] };
    }
    i = j - 1;
  }
  return NONE;
}

const moneyNums = (value) => {
  const v = String(value).replace(/,/g, "");
  const all = v.match(/\d+(?:\.\d+)?/g);
  if (!all) return [];
  if (all.length === 1) return all;
  const near = v.match(/\$\s*(\d+(?:\.\d+)?)/) || v.match(/(\d+(?:\.\d+)?)\s*%/);
  return near ? [near[1]] : [];
};

// A zero only counts when it is spoken AS an amount — otherwise every stray "0"
// in a policy-number readout would confirm a $0.00 co-pay.
function findZero(prep) {
  for (let i = 0; i < prep.toks.length; i++) {
    const tk = prep.toks[i];
    if (!tk.num || Number(tk.t) !== 0) continue;
    if ((prep.toks[i - 1] && prep.toks[i - 1].num) || (prep.toks[i + 1] && prep.toks[i + 1].num)) continue;
    const nx = prep.toks[i + 1];
    const cue = (nx && /^(dollars?|percent|bucks|cents?)$/.test(nx.t)) ||
      /\$\s*$/.test(prep.text.slice(Math.max(0, tk.start - 2), tk.start)) ||
      /^\s*%/.test(prep.text.slice(tk.end, tk.end + 2));
    if (cue) return { found: true, spans: [span(tk, nx || tk)], tok: tk };
  }
  return NONE;
}

// "there is no copay" answers a $0.00 co-pay just as well as the digit does
const ZERO_TOPIC = { copayAmt: "copay", coinsAmt: "coins", dedInd: "dedApply", oop: "dedApply" };

function matchAmount(prep, value, key) {
  const nums = moneyNums(value);
  if (!nums.length) return matchTokens(prep, value);
  const n = nums[0];
  if (Number(n) === 0) {
    const said = ZERO_TOPIC[key] && decideYesNo(prep).get(ZERO_TOPIC[key]);
    if (said && said.pol === "NO") return { found: true, spans: [said.span] };
    return findZero(prep);
  }
  const variants = [n];
  if (n.includes(".")) variants.push(String(Number(n.split(".")[0])));
  for (const x of variants) {
    const r = findNum(prep, x);
    if (r.found) return r;
  }
  return NONE;
}

function matchId(prep, value) {
  const digits = String(value).replace(/\D/g, "");
  const letters = String(value).toLowerCase().match(/[a-z]+/g) || [];
  if (!digits) return matchTokens(prep, value);
  const variants = [digits];
  const stripped = digits.replace(/^0+/, "");
  if (stripped !== digits && stripped.length >= 4) variants.push(stripped);
  for (const d of variants) {
    const r = digitSearch(prep, d);
    if (!r.found) continue;
    // weak digit evidence (<4) must be backed by the letter part
    if (digits.length < 4 && letters.length) {
      const spelled = spelledLetters(prep);
      const ok = letters.every((L) => prep.toks.some((x) => x.t === L) || spelled.includes(L));
      if (!ok) return NONE;
    }
    return r;
  }
  return NONE;
}

function matchPhone(prep, value) {
  const digits = String(value).replace(/\D/g, "");
  const variants = [digits];
  if (digits.length === 11 && digits[0] === "1") variants.push(digits.slice(1));
  for (const d of variants) {
    const r = digitSearch(prep, d);
    if (r.found) return r;
  }
  return NONE;
}

function partEq(tok, part) {
  if (/^\d/.test(part)) return tokIsNum(tok, part);
  return tok.t === part || (part.length > 3 && tok.t.length >= 3 && part.startsWith(tok.t));
}

function seqMatch(prep, seq) {
  const toks = prep.toks;
  for (let i = 0; i < toks.length; i++) {
    let pos = i, ok = true, last = null;
    for (let s = 0; s < seq.length; s++) {
      // skip a stray "of"/"the" unless it IS the part we want
      if (pos < toks.length && FILLER.has(toks[pos].t) && s > 0 && !partEq(toks[pos], seq[s])) pos++;
      if (pos >= toks.length || !partEq(toks[pos], seq[s])) { ok = false; break; }
      last = toks[pos];
      pos++;
    }
    if (ok) return { found: true, spans: [span(toks[i], last)] };
  }
  return NONE;
}

function matchDate(prep, value) {
  let y, m, d, mm;
  if ((mm = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/))) [, y, m, d] = mm;
  else if ((mm = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, m, d, y] = mm;
  else if ((mm = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/))) { [, m, d] = mm; y = "20" + mm[3]; }
  else return matchTokens(prep, value);
  const M = String(Number(m)), D = String(Number(d)), Y = String(Number(y)), YY = String(Number(y) % 100);
  const month = MONTHS[Number(m) - 1];
  for (const seq of [[M, D, Y], [month, D, Y], [D, month, Y], [month, D, YY], [M, D, YY], [month, D], [D, month]]) {
    const r = seqMatch(prep, seq);
    if (r.found) return r;
  }
  // digits read straight through ("oh three oh one twenty twenty six"). The match
  // must be the WHOLE numeric run, so it can't be sliced out of an ID readout.
  const pad2 = (x) => String(x).padStart(2, "0");
  for (const ds of [`${M}${D}${Y}`, `${pad2(m)}${pad2(d)}${Y}`, `${pad2(m)}${pad2(d)}${pad2(YY)}`]) {
    let from = 0, i;
    while ((i = prep.digitStream.indexOf(ds, from)) >= 0) {
      from = i + 1;
      const a = prep.digitMap[i], b = prep.digitMap[i + ds.length - 1];
      if (!a || !b) continue;
      const ia = prep.toks.indexOf(a), ib = prep.toks.indexOf(b);
      // must begin a spoken number and span few tokens, so a date pattern can't
      // be sliced out of a long digit-by-digit readout
      const runStart = !prep.toks[ia - 1] || !prep.toks[ia - 1].num;
      if (runStart && ib - ia + 1 <= 8) return { found: true, spans: [span(a, b)] };
    }
  }
  return NONE;
}

// letters spelled out one by one, NATO words included ("W as in whiskey")
function spelledLetters(prep) {
  if (prep._spelled != null) return prep._spelled;
  let s = "";
  for (const tok of prep.toks) {
    if (/^[a-z]$/.test(tok.t)) s += tok.t;
    else if (NATO[tok.t]) s += NATO[tok.t];
    else if (tok.t.length >= 3 && /^[a-z]+$/.test(tok.t) && s && !NATO[tok.t]) s += "|";
  }
  prep._spelled = s;
  return s;
}

// Bounded Levenshtein distance — a real edit distance, so "clark"/"clerk" (1
// substitution) and "yusuff"/"yusuf" (1 deletion) both measure correctly.
const lev1 = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
};

function matchName(prep, value) {
  const words = String(value).toLowerCase().match(/[a-z]+/g) || [];
  const need = words.filter((w) => w.length >= 2);
  const list = need.length ? need : words;
  if (!list.length) return NONE;
  const spelled = spelledLetters(prep);
  const spans = [];
  for (const w of list) {
    const hit = prep.toks.find((x) => !x.num && (
      x.t === w ||
      (w.length >= 5 && x.t.length >= 5 && (x.t.startsWith(w.slice(0, 5)) || w.startsWith(x.t.slice(0, 5)))) ||
      (w.length >= 5 && x.t.length >= 4 && x.t[0] === w[0] && lev1(x.t, w, w.length >= 8 ? 2 : 1))
    ));
    if (hit) { spans.push(span(hit)); continue; }
    if (w.length >= 3 && spelled.includes(w)) continue; // spelled out
    return NONE;
  }
  return { found: true, spans };
}

function matchTokens(prep, value) {
  const vt = valueTokens(value);
  let sig = vt.filter((t) => /^\d/.test(t) || (t.length >= 3 && !STOP.has(t)));
  if (!sig.length) sig = vt;
  if (!sig.length) return NONE;
  const numSig = sig.filter((t) => /^\d/.test(t));
  const wordSig = sig.filter((t) => !/^\d/.test(t));
  const spans = [];
  let numHits = 0, wordHits = 0, numTok = null;

  for (const t of numSig) {
    const r = findNum(prep, t);
    if (r.found) { numHits++; spans.push(...r.spans); numTok = numTok || r.tok; }
  }
  for (const t of wordSig) {
    const hit = prep.toks.find((x) => !x.num && tokEq(x.t, t));
    if (hit) { wordHits++; spans.push(span(hit)); continue; }
    for (const phrase of SYNONYM[t] || []) {
      const r = seqMatch(prep, phrase);
      if (r.found) { wordHits++; spans.push(...r.spans); break; }
    }
  }
  if (numHits < numSig.length) return NONE; // every number in the value must be heard
  if (wordSig.length >= 3) return wordHits >= Math.ceil(wordSig.length * 0.5) ? { found: true, spans } : NONE;
  if (wordHits > 0) return { found: true, spans };
  if (!numSig.length) return NONE;
  // a lone number only counts inside a clause that names the subject
  if (numTok && numTok.ci != null) {
    const cl = prep.clauses[numTok.ci];
    const ok = cl && cl.words.some((w) => UNITS_W.has(w) || wordSig.some((t) => tokEq(w, t)) ||
      (SYNONYM[wordSig[0]] || []).some((p) => p.includes(w)));
    if (ok) return { found: true, spans };
  }
  return NONE;
}

// "not in network" / "out of network" must not read as a confirmed IN NETWORK
function matchEnum(prep, value) {
  const seq = valueTokens(value);
  const r = seqMatch(prep, seq);
  if (!r.found) return r;
  const start = r.spans[0].start;
  const idx = prep.toks.findIndex((t) => t.start === start);
  const before = idx > 0 ? prep.toks[idx - 1].t : "";
  if (before === "not" && seq[0] === "in") return NONE;
  if (before === "non" || before === "out") return NONE;
  return r;
}

/* ------------------------------------------------------------------ *
 * Yes/no + enum: decide what the CALL said, then compare
 * ------------------------------------------------------------------ */

const phraseIn = (words, phrase) => {
  for (let i = 0; i + phrase.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < phrase.length; k++) if (words[i + k] !== phrase[k]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
};

const NEG_PHRASES = [["not", "applicable"], ["does", "not", "apply"], ["doesn", "t", "apply"], ["no", "longer", "applies"],
  ["is", "waived"], ["not", "required"], ["doesn", "t", "require"], ["don", "t", "require"], ["not", "needed"],
  ["not", "necessary"], ["no", "cost"], ["no", "charge"], ["zero", "dollar"], ["free", "of", "charge"], ["not", "covered"], ["no", "prior"]];
const POS_PHRASES = [["is", "required"], ["does", "require"], ["we", "require"], ["will", "need"], ["must", "obtain"],
  ["mandatory"], ["subject", "to"], ["does", "have"], ["do", "have"], ["there", "is", "a"], ["they", "have", "a"], ["carries", "a"]];
const MET_PHRASES = [["has", "been", "met"], ["been", "met"], ["already", "met"], ["fully", "met"], ["is", "satisfied"], ["has", "met"]];
const NEG_W = new Set(["no", "nope", "nah", "not", "none", "never", "nothing", "without", "waived", "waive", "exempt", "excluded", "nil"]);
const NEG_CONTR = new Set(["don", "doesn", "isn", "aren", "wasn", "weren", "hasn", "haven", "didn", "won", "couldn", "shouldn", "wouldn", "cannot"]);
const POS_W = new Set(["required", "requires", "require", "applies", "apply", "applicable", "needed", "needs", "need", "mandatory", "necessary", "yes", "does", "do"]);
const EVAL_Q = new Set(["eval", "evaluation", "initial", "assessment", "evaluations"]);
const TX_Q = new Set(["treatment", "treatments", "ongoing", "subsequent", "therapy", "continued", "visits"]);

// Every polarity signal in the clause, with the token it sits at. A clause can
// hold several ("a twenty dollar copay with no referral required"), so they are
// claimed per topic rather than stamped across the whole sentence.
function polarityMarkers(cl, toks, text) {
  const w = cl.words, out = [];
  const at = (k) => cl.i0 + k;
  for (const p of NEG_PHRASES) {
    for (let i = 0; i + p.length <= w.length; i++) {
      let ok = true;
      for (let k = 0; k < p.length; k++) if (w[i + k] !== p[k]) { ok = false; break; }
      if (ok) out.push({ i: at(i), pol: "NO", strength: 3 });
    }
  }
  for (const p of POS_PHRASES) {
    for (let i = 0; i + p.length <= w.length; i++) {
      let ok = true;
      for (let k = 0; k < p.length; k++) if (w[i + k] !== p[k]) { ok = false; break; }
      if (ok) out.push({ i: at(i), pol: "YES", strength: 3 });
    }
  }
  for (let k = 0; k < w.length; k++) {
    if (NEG_W.has(w[k])) out.push({ i: at(k), pol: "NO", strength: 3 });
    else if (NEG_CONTR.has(w[k]) && w[k + 1] === "t") out.push({ i: at(k), pol: "NO", strength: 3 });
    else if (POS_W.has(w[k])) out.push({ i: at(k), pol: "YES", strength: 2 });
  }
  // an amount is itself an answer: "$25 copay" => YES, "$0 copay"/"zero" => NO
  for (let i = cl.i0; i < cl.i1; i++) {
    const tk = toks[i];
    if (!tk.num) continue;
    if ((toks[i - 1] && toks[i - 1].num) || (toks[i + 1] && toks[i + 1].num)) continue; // digit-by-digit readout
    const nx = toks[i + 1];
    const cue = tk.zeroWord || (nx && /^(dollars?|percent|bucks|cents?)$/.test(nx.t)) ||
      /\$\s*$/.test(text.slice(Math.max(0, tk.start - 2), tk.start)) || /^\s*%/.test(text.slice(tk.end, tk.end + 2));
    if (Number(tk.t) === 0) { if (cue) out.push({ i, pol: "NO", strength: 3 }); }
    else if (Number(tk.t) > 0) out.push({ i, pol: "YES", strength: cue ? 2 : 1 });
  }
  return out;
}

// which yes/no topics a clause mentions -> key => the anchor words' own span.
// The span stays tight (not the whole clause) so it can't swallow a nearby
// amount that another field needs to inspect.
function clauseAnchors(cl, toks) {
  const found = new Map();
  for (let i = cl.i0; i < cl.i1; i++) {
    const list = HEAD_IX.get(toks[i].t);
    if (!list) continue;
    for (const { key, phrase } of list) {
      const m = MTYPE.get(key);
      if (m !== "yesno" && m !== "enum2") continue;
      let ok = true;
      for (let k = 0; k < phrase.length; k++) if (!toks[i + k] || toks[i + k].t !== phrase[k]) { ok = false; break; }
      if (ok && !found.has(key)) found.set(key, { start: toks[i].start, end: toks[i + phrase.length - 1].end, i });
    }
  }
  return found;
}

// Each polarity signal belongs to the topic it sits closest to, so a negation
// about one subject cannot contradict another in the same sentence.
function resolveClause(it) {
  const out = new Map();
  const keys = [...it.anchors.keys()];
  if (!keys.length) return out;
  for (const m of it.markers) {
    let bd = Infinity;
    for (const key of keys) bd = Math.min(bd, Math.abs(it.anchors.get(key).i - m.i));
    if (bd > 12) continue; // too far away to be about this topic
    // two topics can share one anchor word ("authorization" covers eval and
    // treatment) — the marker then applies to both
    for (const key of keys) {
      if (Math.abs(it.anchors.get(key).i - m.i) !== bd) continue;
      const cur = out.get(key);
      if (!cur || m.strength > cur.strength || (m.strength === cur.strength && bd < cur.d)) {
        out.set(key, { pol: m.pol, strength: m.strength, d: bd });
      } else if (m.strength === cur.strength && m.pol !== cur.pol && bd === cur.d) {
        out.set(key, { pol: null, strength: m.strength, d: bd });
      }
    }
  }
  return out;
}

export function decideYesNo(prep) {
  if (prep._yn) return prep._yn;
  const { clauses, toks } = prep;
  const info = clauses.map((cl) => {
    const it = {
      cl,
      anchors: clauseAnchors(cl, toks),
      markers: polarityMarkers(cl, toks, prep.text),
      hasEval: cl.words.some((w) => EVAL_Q.has(w)),
      hasTx: cl.words.some((w) => TX_Q.has(w)),
      met: MET_PHRASES.some((p) => phraseIn(cl.words, p)),
      applyPred: cl.words.some((w) => w === "applies" || w === "apply" || w === "applicable" || w === "waived" || w === "required"),
      money: (() => { for (let i = cl.i0; i < cl.i1; i++) if (toks[i].num) return true; return false; })(),
    };
    it.resolved = resolveClause(it);
    return it;
  });

  const ev = new Map(); // key -> [{pol, strength, specific, idx, span}]
  const push = (key, o) => { if (!ev.has(key)) ev.set(key, []); ev.get(key).push(o); };

  for (let c = 0; c < info.length; c++) {
    const it = info[c];
    let anchors = it.anchors, resolved = it.resolved;

    if (it.cl.kind === "q") continue; // the manager's question is not evidence
    if (it.cl.kind === "answer") {
      // "correct" / "that's right" takes the polarity of what it answers
      let ant = null;
      for (let k = c - 1; k >= 0 && c - k <= 2; k--) if (info[k].anchors.size && info[k].resolved.size) { ant = info[k]; break; }
      if (!ant) continue;
      // A bare "no" AGREES with a negative statement ("no copay?" — "no").
      // It only contradicts when the statement was positive.
      const neg = it.cl.words.some((w) => NEG_W.has(w));
      anchors = ant.anchors;
      resolved = new Map();
      for (const [key, r] of ant.resolved) {
        if (!r.pol) continue;
        const pol = neg && r.pol === "YES" ? "NO" : r.pol;
        resolved.set(key, { pol, strength: 3, d: 0 });
      }
    } else if (it.cl.contrast && !anchors.size) {
      // "…but not the eval" inherits the subject and overrides it
      for (let k = c - 1; k >= 0; k--) if (info[k].anchors.size && info[k].resolved.size) { anchors = info[k].anchors; break; }
      if (anchors !== it.anchors) {
        resolved = new Map();
        const keys = [...anchors.keys()];
        for (const m of it.markers) for (const key of keys) {
          const cur = resolved.get(key);
          if (!cur || m.strength > cur.strength) resolved.set(key, { pol: m.pol, strength: m.strength, d: 0 });
        }
      }
    }
    if (!anchors.size || !resolved.size) continue;

    for (const [key, spanOf] of anchors) {
      const r = resolved.get(key);
      if (!r || !r.pol) continue;
      const { pol, strength } = r;
      // "the deductible has been met" answers the balance, not whether one applies
      if (key === "dedApply" && it.met && !it.money && !it.applyPred) continue;
      if (key === "authEval" || key === "authTx") {
        const specific = (it.hasEval && !it.hasTx) || (it.hasTx && !it.hasEval);
        if (specific) {
          const only = it.hasEval ? "authEval" : "authTx";
          if (key !== only) continue;
          push(key, { pol, strength, specific: true, idx: c, span: spanOf });
          continue;
        }
        push(key, { pol, strength, specific: false, idx: c, span: spanOf });
        continue;
      }
      push(key, { pol, strength, specific: true, idx: c, span: spanOf });
    }
  }

  const out = new Map();
  for (const [key, list] of ev) {
    let pool = list.filter((e) => e.specific);
    if (!pool.length) pool = list;
    const top = Math.max(...pool.map((e) => e.strength));
    pool = pool.filter((e) => e.strength === top);
    const yes = pool.some((e) => e.pol === "YES"), no = pool.some((e) => e.pol === "NO");
    if (yes && no) continue; // the call says both — decide nothing
    const last = pool[pool.length - 1];
    out.set(key, { pol: last.pol, span: last.span });
  }
  prep._yn = out;
  return out;
}

/* ------------------------------------------------------------------ *
 * Mismatch detection — only for checks that were NOT found
 * ------------------------------------------------------------------ */

const WIN = { money: [10, 4], percent: [8, 4], count: [8, 4], duration: [10, 4], date: [10, 4], id: [12, 4], phone: [12, 4] };
const MIN_TOKENS = 25, TAIL_GUARD = 3, MISMATCH_MIN = 0.55, AMBIG_GAP = 0.15, MAX_HITS = 8;
const HEDGE = new Set(["approximately", "about", "around", "roughly", "maybe", "think", "believe", "check", "sure", "either", "up", "or"]);

function scanAnchors(prep) {
  if (prep._sites) return prep._sites;
  const toks = prep.toks, sites = [];
  for (let i = 0; i < toks.length; i++) {
    const list = HEAD_IX.get(toks[i].t);
    if (!list) continue;
    let best = null;
    for (const { key, phrase } of list) {
      let ok = true;
      for (let k = 0; k < phrase.length; k++) if (!toks[i + k] || toks[i + k].t !== phrase[k]) { ok = false; break; }
      if (!ok) continue;
      if (!best || phrase.length > best.len) best = { len: phrase.length, keys: new Set([key]) };
      else if (phrase.length === best.len) best.keys.add(key);
    }
    if (best) sites.push({ i, j: i + best.len, keys: best.keys, text: toks.slice(i, i + best.len).map((x) => x.t).join(" ") });
  }
  prep._sites = sites;
  return sites;
}

function scanCands(prep) {
  if (prep._cands) return prep._cands;
  const toks = prep.toks, text = prep.text;
  const nums = [], runs = [], dates = [];
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (!tk.num && !tk.t.includes(".")) continue;
    const before = text.slice(Math.max(0, tk.start - 2), tk.start);
    const after = text.slice(tk.end, tk.end + 2);
    const n1 = toks[i + 1], n2 = toks[i + 2];
    const dollar = /\$\s*$/.test(before) || (n1 && /^dollars?$|^bucks$/.test(n1.t));
    const pct = /^\s*%/.test(after) || (n1 && (n1.t === "percent" || (n1.t === "per" && n2 && n2.t === "cent")));
    const unit = (n1 && UNITS_W.has(n1.t)) || (n1 && (n1.t === "business" || n1.t === "calendar") && n2 && UNITS_W.has(n2.t));
    nums.push({ ti: i, val: Number(tk.t), s: tk.start, e: (dollar || pct || unit) && n1 ? n1.end : tk.end, dollar, pct, unit });
  }
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i].num) continue;
    let j = i, digits = "";
    while (j < toks.length && toks[j].num) { digits += toks[j].t; j++; }
    runs.push({ ti0: i, ti1: j - 1, digits, s: toks[i].start, e: toks[j - 1].end });
    i = j - 1;
  }
  const monthIx = (t) => MONTHS.indexOf(t);
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i], b = toks[i + 1], c = toks[i + 2];
    if (!b) continue;
    const yOf = (tk) => tk && tk.num && (tk.t.length === 4 || tk.t.length === 2) ? Number(tk.t.length === 2 ? "20" + tk.t : tk.t) : null;
    if (!a.num && monthIx(a.t) >= 0 && b.num && Number(b.t) >= 1 && Number(b.t) <= 31) {
      const y = yOf(c);
      dates.push({ m: monthIx(a.t) + 1, d: Number(b.t), y, s: a.start, e: (y ? c.end : b.end), ti: i });
    } else if (a.num && b.num && Number(a.t) >= 1 && Number(a.t) <= 12 && Number(b.t) >= 1 && Number(b.t) <= 31) {
      const y = yOf(c);
      dates.push({ m: Number(a.t), d: Number(b.t), y, s: a.start, e: (y ? c.end : b.end), ti: i });
    }
  }
  prep._cands = { nums, runs, dates };
  return prep._cands;
}

const DUR = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, year: 365, years: 365 };

function normForm(m, value) {
  const v = String(value);
  if (m === "money" || m === "percent") {
    const n = moneyNums(v);
    return n.length === 1 ? Number(n[0]) : null;
  }
  if (m === "count") return /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
  if (m === "duration") {
    const mm = v.toLowerCase().replace(/,/g, "").match(/(\d+)\s*(day|days|week|weeks|month|months|year|years)/);
    return mm ? Number(mm[1]) * DUR[mm[2]] : null;
  }
  if (m === "date") {
    let x;
    if ((x = v.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return { y: +x[1], m: +x[2], d: +x[3] };
    if ((x = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return { y: +x[3], m: +x[1], d: +x[2] };
    return null;
  }
  if (m === "id") { const d = v.replace(/\D/g, ""); return d.length >= 4 ? d : null; }
  if (m === "phone") { let d = v.replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10 ? d : null; }
  return null;
}

function candidatesFor(prep, key, m, formNorm) {
  const { nums, runs, dates } = scanCands(prep);
  const out = [];
  if (m === "money") for (const n of nums) out.push({ ...n, norm: n.val, cue: n.dollar });
  else if (m === "percent") for (const n of nums) { if (n.pct) out.push({ ...n, norm: n.val, cue: true }); }
  else if (m === "count") for (const n of nums) out.push({ ...n, norm: n.val, cue: n.unit });
  else if (m === "duration") for (const n of nums) {
    if (!n.unit) continue;
    const u = prep.toks[n.ti + 1] && DUR[prep.toks[n.ti + 1].t] ? prep.toks[n.ti + 1].t : (prep.toks[n.ti + 2] || {}).t;
    if (!DUR[u]) continue;
    out.push({ ...n, norm: n.val * DUR[u], cue: true });
  }
  else if (m === "id" || m === "phone") for (const r of runs) {
    const want = String(formNorm).length;
    if (r.digits.length < 4) continue;
    if (m === "phone" ? r.digits.length !== 10 : Math.abs(r.digits.length - want) > 1) continue;
    out.push({ ti: r.ti0, s: r.s, e: r.e, norm: r.digits, cue: true });
  }
  else if (m === "date") for (const d of dates) out.push({ ti: d.ti, s: d.s, e: d.e, norm: { y: d.y, m: d.m, d: d.d }, cue: true, noYear: !d.y });
  return out;
}

const sameValue = (m, a, b) => {
  if (m === "date") return a.m === b.m && a.d === b.d && (!b.y || !a.y || a.y === b.y);
  return String(a) === String(b) || Number(a) === Number(b);
};

const fmtHeard = (prep, c) => prep.text.slice(c.s, c.e).trim();

function findMismatch(prep, f, value, confirmed) {
  const spec = ANCHORS[f.key];
  const m = spec && spec.m;
  if (!m || m === "none" || m === "yesno" || m === "enum2") return null;
  if (prep.toks.length < MIN_TOKENS) return null;
  const formNorm = normForm(m, value);
  if (formNorm == null) return null;

  const sites = scanAnchors(prep).filter((s) => s.keys.has(f.key));
  if (!sites.length) return null;
  const usable = sites.filter((s) => s.j <= prep.toks.length - TAIL_GUARD).slice(0, MAX_HITS);
  if (!usable.length) return null;

  const cands = candidatesFor(prep, f.key, m, formNorm);
  if (!cands.length) return null;
  const own = OWN_Q.get(f.key) || new Set(), sib = SIB_Q.get(f.key) || new Set();
  const [fwd, back] = WIN[m] || [10, 4];
  const allSites = scanAnchors(prep);
  const fam = FAMILY[m];
  const scored = [];

  for (const site of usable) {
    for (const c of cands) {
      const dist = c.ti >= site.j ? c.ti - site.j : site.i - c.ti;
      if (c.ti >= site.j ? dist > fwd : dist > back) continue;
      if (sameValue(m, formNorm, c.norm)) continue; // agrees — not a mismatch

      // qualifier arbitration inside the group
      const lo = Math.max(0, Math.min(site.i, c.ti) - 2), hi = Math.min(prep.toks.length, Math.max(site.j, c.ti) + 3);
      let dOwn = Infinity, dSib = Infinity;
      for (let k = lo; k < hi; k++) {
        const t = prep.toks[k].t;
        if (own.has(t)) dOwn = Math.min(dOwn, Math.abs(k - c.ti));
        if (sib.has(t)) dSib = Math.min(dSib, Math.abs(k - c.ti));
      }
      if (dSib < dOwn) continue;
      if (!spec.base && spec.g && dOwn === Infinity) continue;
      if (spec.base && dSib !== Infinity) continue;

      // a nearer anchor of the same family owns this number
      let nearest = null, nd = Infinity;
      for (const s2 of allSites) {
        let sameFam = false;
        for (const k2 of s2.keys) if (FAMILY[MTYPE.get(k2)] === fam) { sameFam = true; break; }
        if (!sameFam) continue;
        const d2 = c.ti >= s2.j ? c.ti - s2.j : s2.i - c.ti;
        if (d2 >= 0 && d2 < nd) { nd = d2; nearest = s2; }
      }
      if (nearest && !nearest.keys.has(f.key)) continue;

      // already highlighted green for a different field
      if (confirmed.some((x) => c.s >= x.start && c.e <= x.end)) continue;
      // a hedged number is not a contradiction ("not sure, maybe five hundred")
      let hedged = false;
      for (let k = Math.min(site.j, c.ti); k < Math.max(site.i, c.ti); k++) if (HEDGE.has(prep.toks[k].t)) { hedged = true; break; }
      if (hedged) continue;
      // a bare number with no unit/currency cue and no qualifier is too weak to accuse
      if (FAMILY[m] === "num" && !c.cue && dOwn === Infinity) continue;

      let score = 1 - 0.04 * dist;
      if (dOwn !== Infinity) score += 0.25;
      if (c.cue) score += 0.2;
      if (c.ti < site.i) score -= 0.2;
      if (c.noYear) score -= 0.15;
      if (prep.punct) {
        const a = prep.toks[Math.min(site.j, c.ti) - 1], b = prep.toks[Math.max(site.i, c.ti)];
        if (a && b && /[.?!]/.test(prep.text.slice(a.end, b.start))) score -= 0.25;
      }
      scored.push({ ...c, score, site });
    }
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best.score < MISMATCH_MIN) return null;
  const rival = scored.find((x) => !sameValue(m, x.norm, best.norm));
  if (rival && best.score - rival.score < AMBIG_GAP) return null;
  return { heard: fmtHeard(prep, best), heardSpans: [{ start: best.s, end: best.e }], anchorText: best.site.text, score: best.score };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

// Was the call actually talking about this field where the value was spoken?
// A value heard somewhere unrelated does not fill the field.
// token index -> the fields whose keyword starts there. Longer phrases win the
// tokens they cover, so "insurance" inside "secondary insurance" belongs to the
// secondary field rather than the primary one.
const ALL_KEYWORDS = Object.entries(KEYWORDS)
  .flatMap(([key, phrases]) => phrases.map((phrase) => ({ key, phrase })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

function keywordIndex(prep) {
  if (prep._kw) return prep._kw;
  const map = new Map();
  const covered = new Array(prep.toks.length).fill(0);
  let len = null;
  for (const { key, phrase } of ALL_KEYWORDS) {
    if (phrase.length !== len) len = phrase.length; // same-length phrases don't block each other
    for (let i = 0; i + phrase.length <= prep.toks.length; i++) {
      let ok = true;
      for (let k = 0; k < phrase.length; k++) if (prep.toks[i + k].t !== phrase[k]) { ok = false; break; }
      if (!ok) continue;
      let blocked = false;
      for (let k = 0; k < phrase.length; k++) if (covered[i + k] > phrase.length) { blocked = true; break; }
      if (blocked) continue;
      for (let k = 0; k < phrase.length; k++) covered[i + k] = Math.max(covered[i + k], phrase.length);
      if (!map.has(i)) map.set(i, new Set());
      map.get(i).add(key);
    }
  }
  prep._kw = map;
  return map;
}

// A keyword that comes BEFORE the value introduces it ("the patient is X");
// one that merely follows is much weaker evidence ("X for this member").
const POST_PENALTY = 6;
const proximity = (i, ti) => (i <= ti ? ti - i : i - ti + POST_PENALTY);

// Every place this value could have been spoken, so a second mention about a
// different field can still be found ("insurance is Aetna … secondary is Aetna").
function occurrences(prep, f, value) {
  const out = [];
  const digits = String(value).replace(/\D/g, "");
  if ((f.type === "id" || f.type === "phone") && digits.length >= 4) {
    let from = 0, i;
    while ((i = prep.digitStream.indexOf(digits, from)) >= 0) {
      const tk = prep.digitMap[i];
      if (tk) out.push(prep.toks.indexOf(tk));
      from = i + 1;
    }
    return out;
  }
  const vt = valueTokens(value).filter((t) => t.length >= 3 || /^\d/.test(t));
  const first = vt[0];
  if (!first) return out;
  prep.toks.forEach((tk, ix) => {
    if (/^\d/.test(first) ? tokIsNum(tk, first) : (!tk.num && tokEq(tk.t, first))) out.push(ix);
  });
  return out;
}

function spokenAboutField(prep, key, spans) {
  if (!KEYWORDS[key] || !spans.length) return true; // no keyword list — nothing to check against
  const index = keywordIndex(prep);
  // Judge each occurrence on its own: one of them being spoken about this field
  // is enough, and distances from different occurrences must never be mixed.
  for (const s of spans) {
    const ti = prep.toks.findIndex((t) => t.end > s.start);
    if (ti < 0) continue;
    let own = Infinity, other = Infinity;
    for (const [i, keys] of index) {
      const d = proximity(i, ti);
      if (keys.has(key)) own = Math.min(own, d);
      else other = Math.min(other, d);
    }
    if (own > KEYWORD_WINDOW) continue; // this field's subject was not nearby
    if (own > other) continue;          // another subject introduced these words
    return true;
  }
  return false;
}

// How many times could this value have been said? Digit values are counted in the
// digit stream, word values by matching tokens.
function countOccurrences(prep, value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length >= 4) {
    let n = 0, from = 0, i;
    while ((i = prep.digitStream.indexOf(digits, from)) >= 0) { n++; from = i + 1; }
    return n;
  }
  const vt = valueTokens(value).filter((t) => t.length >= 3 || /^\d/.test(t));
  if (!vt.length) return 1;
  const first = vt[0];
  let n = 0;
  for (const tok of prep.toks) {
    if (/^\d/.test(first) ? tokIsNum(tok, first) : (!tok.num && tokEq(tok.t, first))) n++;
  }
  return n;
}

function matchPresence(prep, f, value) {
  switch (f.type) {
    case "id": return matchId(prep, value);
    case "phone": return matchPhone(prep, value);
    case "money": case "percent": case "number": return matchAmount(prep, value, f.key);
    case "date": return matchDate(prep, value);
    case "name": return matchName(prep, value);
    case "enum": return matchEnum(prep, value);
    default: return matchTokens(prep, value);
  }
}

export function checkTranscript(v, transcript) {
  const t = (transcript || "").trim();
  const prep = t ? getPrep(t) : null;
  const yn = prep ? decideYesNo(prep) : null;
  const checks = [];

  for (const f of VERIFY_FIELDS) {
    const value = String(v[f.key] || "").trim();
    if (!value || isSkipped(value)) continue;
    const base = { key: f.key, label: f.label, value, gate: f.gate, soft: f.gate === "soft" };
    if (!prep) { checks.push({ ...base, status: "missing", found: false, spans: [] }); continue; }

    if (f.type === "yesno" || (f.type === "enum" && f.gate === "contra")) {
      const said = yn.get(f.key);
      const want = f.type === "yesno" ? value.toUpperCase() : (value.toUpperCase().startsWith("IN") ? "YES" : "NO");
      if (f.type === "enum") {
        const r = matchPresence(prep, f, value);
        if (r.found) { checks.push({ ...base, status: "found", found: true, spans: r.spans }); continue; }
        const opp = matchEnum(prep, value.toUpperCase().startsWith("IN") ? "OUT OF NETWORK" : "IN NETWORK");
        if (opp.found) { checks.push({ ...base, status: "mismatch", found: false, spans: [], heard: value.toUpperCase().startsWith("IN") ? "OUT OF NETWORK" : "IN NETWORK", heardSpans: opp.spans }); continue; }
        checks.push({ ...base, status: "quiet", found: false, spans: [] });
        continue;
      }
      if (!said) { checks.push({ ...base, status: "quiet", found: false, spans: [] }); continue; }
      if (said.pol === want) checks.push({ ...base, status: "found", found: true, spans: [said.span] });
      else checks.push({ ...base, status: "mismatch", found: false, spans: [], heard: said.pol, heardSpans: [said.span], anchorText: f.label });
      continue;
    }

    const r = matchPresence(prep, f, value);
    if (r.found && !spokenAboutField(prep, f.key, r.spans)) {
      // the first mention was about something else — is there another one that
      // the call really did state for this field?
      let moved = null;
      for (const ix of occurrences(prep, f, value)) {
        const s = [{ start: prep.toks[ix].start, end: prep.toks[ix].end }];
        if (spokenAboutField(prep, f.key, s)) { moved = s; break; }
      }
      if (!moved) {
        checks.push({ ...base, status: "elsewhere", found: false, spans: [], heardSpans: r.spans });
        continue;
      }
      r.spans = moved;
    }
    checks.push({ ...base, status: r.found ? "found" : "missing", found: r.found, spans: r.spans });
  }

  // One spoken value cannot confirm several different fields. If "Jacqueline" is
  // said once, it can be the last name OR the insurer — not both. Keep as many
  // claims as there are actual occurrences, preferring fields whose topic was
  // discussed nearby, and fail the rest.
  if (prep) {
    const groups = new Map();
    for (const c of checks) {
      if (c.status !== "found" || !c.spans.length) continue;
      const f = VERIFY_FIELDS.find((x) => x.key === c.key);
      if (f.type === "yesno" || f.type === "enum") continue; // these carry their own anchors
      const key = norm(c.value);
      if (key.length < 2) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    for (const [, group] of groups) {
      if (group.length < 2) continue;
      const said = countOccurrences(prep, group[0].value);
      if (group.length <= said) continue;
      const sites = scanAnchors(prep);
      const rank = (c) => {
        const near = sites.some((s) => s.keys.has(c.key) &&
          c.spans.some((sp) => Math.abs(prep.text.slice(0, sp.start).length - prep.text.slice(0, prep.toks[s.i].start).length) < 120));
        return near ? 0 : 1;
      };
      group.sort((a, b) => rank(a) - rank(b));
      for (const c of group.slice(Math.max(1, said))) {
        c.status = "missing";
        c.found = false;
        c.spans = [];
        c.note = "the same words were already used for another field";
      }
    }
  }

  // 80% coverage ↔ "you're responsible for twenty percent"
  const cov = checks.find((c) => c.key === "covPct"), coi = checks.find((c) => c.key === "coinsAmt");
  if (cov && coi && Number(String(cov.value).replace(/\D/g, "")) + Number(String(coi.value).replace(/\D/g, "")) === 100) {
    for (const [a, b] of [[cov, coi], [coi, cov]]) {
      if (a.status === "found" && b.status === "missing") { b.status = "found"; b.found = true; b.spans = a.spans; }
    }
  }

  if (prep) {
    const confirmed = checks.filter((c) => c.found).flatMap((c) => c.spans);
    for (const c of checks) {
      if (c.status !== "missing" && c.status !== "elsewhere") continue;
      const f = VERIFY_FIELDS.find((x) => x.key === c.key);
      const mm = findMismatch(prep, f, c.value, confirmed);
      if (mm) Object.assign(c, { status: "mismatch", ...mm });
    }
  }

  const graded = checks.filter((c) => c.gate !== "soft");
  const missing = graded.filter((c) => c.gate === "hard" && (c.status === "missing" || c.status === "elsewhere")).map((c) => c.key);
  const mismatched = graded.filter((c) => c.status === "mismatch").map((c) => c.key);
  const counted = graded.filter((c) => c.status !== "quiet");
  const matched = counted.filter((c) => c.status === "found").length;

  if (!t) return { checks, matched: 0, total: counted.length, missing: [], mismatched: [], unconfirmed: 0, verdict: "NO AUDIO" };
  return {
    checks, matched, total: counted.length, missing, mismatched,
    unconfirmed: missing.length + mismatched.length,
    verdict: (missing.length || mismatched.length) ? "REJECTED" : counted.length ? "APPROVED" : "UNVERIFIED",
  };
}

// Highlight ranges: green for confirmed, red for contradicted. Red wins overlaps.
export function spansFromChecks(checks) {
  const all = [];
  for (const c of checks) {
    if (c.status === "found") for (const s of c.spans) all.push({ ...s, label: c.label, kind: "ok" });
    if (c.status === "mismatch") for (const s of c.heardSpans || []) all.push({ ...s, label: c.label, kind: "bad", value: c.value, heard: c.heard });
  }
  all.sort((a, b) => a.start - b.start || (a.kind === "bad" ? -1 : 1));
  const out = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      if (s.kind === last.kind) { last.end = Math.max(last.end, s.end); continue; }
      // different colours: keep both, giving the overlap to the red one so a
      // confirmed value is never repainted as contradicted, or vice versa
      if (last.kind === "ok") {
        last.end = Math.min(last.end, s.start);
        if (last.end <= last.start) out.pop();
        out.push({ ...s });
      } else if (s.end > last.end) {
        out.push({ ...s, start: last.end });
      }
      continue;
    }
    out.push({ ...s });
  }
  return out.filter((s) => s.end > s.start);
}

export function findMatches(transcript, v) {
  return spansFromChecks(checkTranscript(v, transcript).checks);
}
