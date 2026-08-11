// Reading a real spreadsheet: header detection, fuzzy column mapping, and the
// coercions that stop Excel quietly destroying the data on the way in.
//
// Pure — no SheetJS here, so this is testable without a binary fixture. xlsxRead.js
// is the browser-only shell that produces the cell grid.
import { HEAD } from "../data/fields.js";

const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Real spreadsheets say "Member ID", not "policyId".
export const HEADER_SYNONYMS = {
  lastName: ["lastname", "last", "patientlastname", "lname", "surname", "memberlastname"],
  firstName: ["firstname", "first", "patientfirstname", "fname", "givenname"],
  dob: ["dob", "dateofbirth", "birthdate", "birthday", "bdate"],
  insName: ["insurance", "insurancename", "payer", "payername", "carrier", "primaryinsurance", "plan"],
  insPhone: ["insurancephone", "payerphone", "providerservices", "providerservicesphone", "phone"],
  policyId: ["policyid", "memberid", "memberno", "membernumber", "subscriberid", "insuranceid", "memberidnumber", "id"],
  groupId: ["groupid", "groupno", "groupnumber", "grp", "grpno", "group"],
  // "Plan name" used to fall to planType, because there was no primary plan-name
  // field to put it in. There is now, and a roster's "Plan Name" column means it.
  planType: ["plantype", "product", "coverageplan"],
  planName: ["planname", "plandescription", "productname"],
  projectName: ["project", "projectname", "client", "clientname", "account"],
  category: ["category", "categoryname", "worktype"],
  requestDate: ["requestdate", "receiveddate", "daterequested", "requested"],
  initialTx: ["initialtreatment", "initialtreatmentdate", "startofcare", "socdate", "treatmentstartdate"],
  payerId: ["payerid", "payorid", "edi", "edipayerid"],
  claimAddr: ["claimaddress", "claimmailingaddress", "mailingaddress", "address"],
  tfl: ["tfl", "timelyfiling", "timelyfilinglimit", "filinglimit"],
  tflCorr: ["tflcorrected", "timelyfilingcorrected", "correctedclaims"],
  serviceType: ["servicetype", "service", "discipline"],
};

// Bare words that belong to a stronger column when one exists. Without this an
// unlabelled "ID" column steals policyId from "Member ID".
const WEAK = new Set(["id", "phone", "plan", "group", "address", "service"]);

/* ------------------------------------------------------------ header row */

// Client spreadsheets open with a title row and a blank one at least as often as
// they start with the headers, so the header row is found rather than assumed.
export function detectHeaderRow(grid, scan = 10) {
  let best = 0, bestScore = -1;
  for (let r = 0; r < Math.min(scan, grid.length); r++) {
    const cells = (grid[r] || []).map(norm).filter(Boolean);
    if (!cells.length) continue;
    let score = 0;
    for (const cell of cells) {
      for (const list of Object.values(HEADER_SYNONYMS)) {
        if (list.includes(cell) || list.some((syn) => !WEAK.has(syn) && cell.includes(syn))) { score++; break; }
      }
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore > 0 ? best : 0;
}

/* --------------------------------------------------------------- mapping */

// Exact synonym first, then containment — and the weak words only get a column
// once nothing stronger has claimed that field.
export function mapHeaders(headers) {
  const cells = headers.map(norm);
  const mapping = {};
  const taken = new Set();

  const claim = (key, i) => { if (mapping[key] === undefined && !taken.has(i)) { mapping[key] = i; taken.add(i); } };

  for (const [key, syns] of Object.entries(HEADER_SYNONYMS)) {
    const strong = syns.filter((s) => !WEAK.has(s));
    cells.forEach((c, i) => { if (c && strong.includes(c)) claim(key, i); });
  }
  for (const [key, syns] of Object.entries(HEADER_SYNONYMS)) {
    const strong = syns.filter((s) => !WEAK.has(s));
    cells.forEach((c, i) => { if (c && strong.some((s) => c.includes(s))) claim(key, i); });
  }
  for (const [key, syns] of Object.entries(HEADER_SYNONYMS)) {
    const weak = syns.filter((s) => WEAK.has(s));
    cells.forEach((c, i) => { if (c && weak.includes(c)) claim(key, i); });
  }

  const unmapped = headers
    .map((h, i) => ({ index: i, header: h }))
    .filter((c) => String(c.header || "").trim() && !taken.has(c.index));
  return { mapping, unmapped };
}

// The app's own Excel log re-imported. Very likely what "import from the database"
// actually means: restore or merge from the shared OneDrive file.
export function mapOwnExport(headers) {
  const byLabel = Object.fromEntries(Object.entries(HEAD).map(([k, label]) => [norm(label), k]));
  const mapping = {};
  headers.forEach((h, i) => {
    const key = byLabel[norm(h)];
    if (key && !key.startsWith("_") && mapping[key] === undefined) mapping[key] = i;
  });
  return mapping;
}

/* ------------------------------------------------------------- coercions */

// Excel turns a long numeric member ID into 1.0161953570012e+14. Prefer what the
// sheet DISPLAYS whenever the raw value is a big number — that is the single most
// common way this kind of import silently corrupts data.
export function coerceId(raw, formatted) {
  const shown = String(formatted ?? "").trim();
  if (typeof raw === "number") {
    if (shown && /[^\d.]/.test(shown)) return shown;
    if (shown && !/e\+/i.test(shown)) return shown.replace(/\.0+$/, "");
    return raw.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
  }
  const s = String(raw ?? "").trim();
  if (!s) return shown;
  return /e\+/i.test(s) && shown ? shown : s.replace(/\.0+$/, "");
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function coerceDate(raw, formatted) {
  const issues = [];
  const fail = () => ({ value: "", issues: [...issues, "unreadable date"] });

  if (raw instanceof Date && !isNaN(raw)) return { value: iso(raw.getFullYear(), raw.getMonth() + 1, raw.getDate()), issues };
  if (typeof raw === "number" && raw > 0 && raw < 80000) {
    const d = new Date(EXCEL_EPOCH + raw * 86400000);
    return { value: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), issues };
  }

  const s = String(raw ?? formatted ?? "").trim();
  if (!s) return { value: "", issues };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return { value: iso(+m[1], +m[2], +m[3]), issues };
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    let [, a, b, y] = m;
    a = +a; b = +b; y = +y;
    if (y < 100) y += y < 50 ? 2000 : 1900;
    // Day > 12 settles the order; otherwise assume US and flag it.
    let mo = a, day = b;
    if (a > 12 && b <= 12) { mo = b; day = a; }
    else if (a <= 12 && b <= 12) issues.push("ambiguous date — read as US month/day");
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return fail();
    return { value: iso(y, mo, day), issues };
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) { const d = new Date(t); return { value: iso(d.getFullYear(), d.getMonth() + 1, d.getDate()), issues }; }
  return fail();
}

export function coercePhone(raw) {
  const d = String(raw ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(raw ?? "").trim();
}

export const coerceName = (raw) => String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// A single "Patient Name" column, in either order.
export function splitName(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { lastName: "", firstName: "", guessed: false };
  if (s.includes(",")) {
    const [last, first = ""] = s.split(",");
    return { lastName: coerceName(last), firstName: coerceName(first), guessed: false };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { lastName: coerceName(parts[0]), firstName: "", guessed: true };
  return { lastName: coerceName(parts[parts.length - 1]), firstName: coerceName(parts.slice(0, -1).join(" ")), guessed: true };
}

/* ------------------------------------------------------------------ rows */

const DATE_KEYS = new Set(["dob"]);
const ID_KEYS = new Set(["policyId", "groupId", "payerId"]);
const NAME_KEYS = new Set(["lastName", "firstName"]);

// Never rejects a sheet. Every row comes back with what could be read plus what
// went wrong with it, so the review step can show the problems and let the
// operator decide.
export function parseRows({ raw, formatted, headerRow, mapping, kind = "patients", existingKeys = new Set() }) {
  const out = [];
  const seen = new Set();

  for (let r = headerRow + 1; r < raw.length; r++) {
    const rawRow = raw[r] || [], fmtRow = (formatted || [])[r] || [];
    const values = {};
    const issues = [];

    for (const [key, col] of Object.entries(mapping)) {
      const rv = rawRow[col], fv = fmtRow[col];
      if (DATE_KEYS.has(key)) {
        const d = coerceDate(rv, fv);
        values[key] = d.value;
        for (const i of d.issues) issues.push({ level: "warn", field: key, msg: i });
      } else if (ID_KEYS.has(key)) values[key] = coerceId(rv, fv);
      else if (key === "insPhone") values[key] = coercePhone(rv ?? fv);
      else if (NAME_KEYS.has(key)) values[key] = coerceName(rv ?? fv);
      else values[key] = String(rv ?? fv ?? "").trim();
    }

    if (!Object.values(values).some((x) => String(x).trim())) continue;  // blank row

    let action = "import";
    if (kind === "patients") {
      if (!values.lastName && !values.policyId) { action = "skip"; issues.push({ level: "error", msg: "no name and no member ID" }); }
      else if (!values.dob) { action = "warn"; issues.push({ level: "warn", field: "dob", msg: "no date of birth — imported as provisional" }); }
      const key = `${values.lastName}|${values.firstName}|${values.dob}`;
      if (seen.has(key)) issues.push({ level: "warn", msg: "duplicate of an earlier row in this sheet" });
      seen.add(key);
      if (existingKeys.has(key)) { action = action === "skip" ? "skip" : "conflict"; issues.push({ level: "warn", msg: "already on file" }); }
    } else if (!values.insName) {
      action = "skip";
      issues.push({ level: "error", msg: "no carrier name" });
    }

    out.push({ i: r, values, issues, action });
  }
  return out;
}

// Look at the mapped columns and say what the sheet is.
export function detectKind(mapping) {
  if (mapping.dob !== undefined || mapping.lastName !== undefined) return "patients";
  if (mapping.payerId !== undefined || mapping.tfl !== undefined || mapping.claimAddr !== undefined) return "carriers";
  return "patients";
}
