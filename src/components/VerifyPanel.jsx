import { Checklist } from "./TranscriptView.jsx";

const ORDER = { mismatch: 0, missing: 1, found: 2, quiet: 3 };

export default function VerifyPanel({ result, comp, hasTranscript }) {
  const { checks, matched, total, mismatched } = result;
  const sorted = [...checks].sort((a, b) =>
    (a.soft ? 9 : ORDER[a.status]) - (b.soft ? 9 : ORDER[b.status]));

  let pill;
  if (mismatched.length) pill = <span className="pill bad">{mismatched.length} CONTRADICTED</span>;
  else if (!hasTranscript) pill = <span className="pill na">NO TRANSCRIPT</span>;
  else if (total > 0 && matched === total) pill = <span className="pill ok">ALL HEARD {matched}/{total}</span>;
  else pill = <span className="pill warn">{matched}/{total} HEARD</span>;

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
