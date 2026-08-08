import { Checklist } from "./TranscriptView.jsx";

// What the operator most needs to act on, first. Every status needs an entry —
// a missing one yields NaN and the sort silently becomes arbitrary for exactly
// the rows that matter. display.test.js pins this.
const ORDER = {
  mismatch: 0, autofill: 1, echo: 2, missing: 3, elsewhere: 3,
  attested: 4, found: 5, carrier: 6, bypassed: 7, quiet: 8,
};

export default function VerifyPanel({ result, comp, hasTranscript }) {
  const { checks, matched, total, mismatched, attested = [], autofilled = [] } = result;
  const sorted = [...checks].sort((a, b) =>
    (a.soft ? 9 : ORDER[a.status] ?? 9) - (b.soft ? 9 : ORDER[b.status] ?? 9));

  // Machine-read values are counted, not dropped. Reporting "0/9 HEARD" straight
  // after a perfect nine-field fill told the operator it had failed.
  const machine = attested.length + autofilled.length;

  let pill;
  if (mismatched.length) pill = <span className="pill bad">{mismatched.length} CONTRADICTED</span>;
  else if (!hasTranscript) pill = <span className="pill na">NO TRANSCRIPT</span>;
  else if (autofilled.length) pill = <span className="pill warn">{autofilled.length} TO CHECK</span>;
  else if (total > 0 && matched + machine === total) pill = <span className="pill ok">ALL CONFIRMED {total}</span>;
  else pill = <span className="pill warn">{matched + machine}/{total} CONFIRMED</span>;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div>
          <h2>Call verification</h2>
          <p>Every filled detail must match the call; required fields are tracked too.</p>
        </div>
        <div className="pill-row">
          {comp.incomplete
            ? <span className="pill warn">FORM {comp.answered}/{comp.required}</span>
            : <span className="pill ok">FORM COMPLETE</span>}
          {machine > 0 && <span className="pill auto" title="Read from the call rather than typed">{machine} FROM CALL</span>}
          {pill}
        </div>
      </div>
      <div className="card-body">
        {comp.incomplete ? (
          <div className="vgap">
            <div className="vgap-head">Still to ask — {comp.blank.length} required field{comp.blank.length > 1 ? "s" : ""}</div>
            <div className="vgap-list">
              {comp.blank.map((f) => <span key={f.key} className="vchip">{f.label}</span>)}
            </div>
          </div>
        ) : (
          <p className="hint" style={{ marginBottom: 10 }}>All {comp.required} required fields answered.</p>
        )}
        {!hasTranscript && checks.length > 0 && (
          <p className="hint" style={{ marginBottom: 10 }}>Attach the call transcript to check these against what the payer said.</p>
        )}
        <Checklist checks={sorted} />
      </div>
    </div>
  );
}
