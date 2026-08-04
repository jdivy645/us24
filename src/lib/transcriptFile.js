import { vobName, downloadText } from "./files.js";
import { fmtDate } from "../data/fields.js";
import { spansFromChecks } from "./verify.js";
import { recordCompleteness } from "./completeness.js";

const RULE = "=".repeat(76);
const THIN = "-".repeat(76);
const col = (label, val) => `${label.padEnd(11)}: ${val || "—"}`;
const row = (a, b) => `${String(a).padEnd(45)}${b || ""}`;

// Confirmed details are wrapped in »guillemets«, contradictions in ‹‹these›› —
// neither can occur in speech-derived or pasted text.
const markBody = (transcript, checks) => {
  const spans = spansFromChecks(checks);
  let out = "", pos = 0;
  for (const s of spans) {
    const [a, b] = s.kind === "bad" ? ["‹‹", "››"] : ["»", "«"];
    out += transcript.slice(pos, s.start) + a + transcript.slice(s.start, s.end) + b;
    pos = s.end;
  }
  return out + transcript.slice(pos);
};

export function buildTranscriptTxt(v, transcript, result) {
  const name = `${v.lastName || ""}${v.lastName && v.firstName ? ", " : ""}${v.firstName || ""}`;
  const comp = recordCompleteness(v);
  const mismatches = result.checks.filter((c) => c.status === "mismatch");
  const notHeard = result.checks.filter((c) => c.status === "missing" && !c.soft);

  const verdictLine =
    result.verdict === "APPROVED" || result.verdict === "REJECTED"
      ? `${result.verdict}  (${result.matched} of ${result.total} details confirmed against the call)`
      : result.verdict === "UNVERIFIED"
        ? "UNVERIFIED  (no key form details were available to check)"
        : "NO AUDIO  (no recording or transcript for this verification)";

  const lines = [
    "US24 SOLUTIONS — VERIFICATION CALL TRANSCRIPT",
    RULE,
    row(col("Patient", name), col("DOB", fmtDate(v.dob))),
    row(col("Payer", `${v.insName || "—"}${v.payerId ? `  (Payer ID ${v.payerId})` : ""}`), col("Policy", v.policyId)),
    row(col("Call date", fmtDate(v.today)), col("Rep", v.repName)),
    col("Call ref", v.callRef),
    col("Source", v._source),
    col("VERDICT", verdictLine),
    col("FORM", comp.incomplete
      ? `INCOMPLETE  (${comp.required - comp.count} of ${comp.required} required fields answered)`
      : `COMPLETE  (all ${comp.required} required fields answered)`),
  ];
  if (mismatches.length) lines.push(col("CONFLICT", mismatches.map((c) => c.label).join(", ")));
  if (notHeard.length) lines.push(col("NOT HEARD", notHeard.map((c) => c.label).join(", ")));

  if (transcript) {
    lines.push("", THIN, "TRANSCRIPT  (confirmed »like this«, contradicted ‹‹like this››)", THIN, markBody(transcript, result.checks));
  }

  lines.push("", THIN, "VERIFICATION SUMMARY", THIN, `${"FIELD".padEnd(28)}${"FORM SAYS".padEnd(28)}RESULT`);
  const fmtCheck = (c) => `${c.label.padEnd(28)}${(c.value || "—").padEnd(28)}` +
    (c.status === "found" ? "CONFIRMED"
      : c.status === "mismatch" ? `MISMATCH — call says "${c.heard}"`
        : c.status === "elsewhere" ? "NOT SAID ABOUT THIS FIELD"
          : c.status === "quiet" ? "not discussed"
            : "NOT HEARD");
  result.checks.filter((c) => !c.soft).forEach((c) => lines.push(fmtCheck(c)));
  const soft = result.checks.filter((c) => c.soft);
  if (soft.length) {
    lines.push("-- advisory (not counted) --");
    soft.forEach((c) => lines.push(fmtCheck(c)));
  }

  if (comp.incomplete) {
    lines.push("", THIN, `MISSING FROM FORM  (${comp.count} required field(s) left blank — record saved anyway)`, THIN);
    for (let i = 0; i < comp.blank.length; i += 2) lines.push(row(comp.blank[i], comp.blank[i + 1]));
  }

  lines.push("", THIN,
    result.verdict === "APPROVED"
      ? `VERDICT: APPROVED — all ${result.total} checked details matched the call.`
      : result.verdict === "REJECTED"
        ? `VERDICT: REJECTED — ${mismatches.length} contradicted, ${notHeard.length} not heard.`
        : result.verdict === "UNVERIFIED"
          ? "VERDICT: UNVERIFIED — the form had no key details to check against the transcript."
          : "VERDICT: NO AUDIO — no recording or transcript for this verification.",
    comp.incomplete
      ? `FORM: INCOMPLETE — ${comp.count} required field(s) were left blank.`
      : `FORM: COMPLETE — all ${comp.required} required fields were answered.`,
    "US24 Solutions — Confidential.");
  return lines.join("\n");
}

export function downloadTranscriptTxt(v, transcript, result) {
  const fn = `${vobName(v)}_TRANSCRIPT.txt`;
  downloadText(buildTranscriptTxt(v, transcript, result), fn);
  return fn;
}
