import { HEAD, fmtDate } from "../data/fields.js";

// What is already on file for this patient and payer.
//
// The deductible and out-of-pocket figures are shown here rather than written into
// the form on purpose. They are precisely what the call exists to establish — a
// prefilled figure that survives to save is an unverified claim wearing a verified
// badge. Copy buttons give all of the speed with none of that risk.

export default function PrefillBar({ prefill, onLookup, onApply, onClear, onCopy, onHistory }) {
  if (!prefill) {
    return (
      <div className="pf">
        <span className="pf-k">On file</span>
        <button className="btn btn-ghost btn-sm" onClick={onLookup}>Look up this patient</button>
        <span className="hint">Fills the name, plan and payer details from earlier verifications.</span>
      </div>
    );
  }

  const { patient, carrier, matchedCase, priorVersion, reference, candidates, isSameCase } = prefill;
  const nothing = !patient && !carrier;

  return (
    <div className="pf pf-open">
      <div className="pf-row">
        <span className="pf-k">On file</span>
        {nothing && <span className="hint">Nothing yet — this will be the first verification for them.</span>}
        {patient && <span className="pf-chip">{patient.lastName}, {patient.firstName}{patient.dob ? ` · ${fmtDate(patient.dob)}` : ""}</span>}
        {carrier && <span className="pf-chip">{carrier.name}{carrier.payerId ? ` · payer ${carrier.payerId}` : ""}</span>}
        {matchedCase && (
          <span className="pf-chip">
            {matchedCase.serviceType} · {matchedCase.versionCount} previous
            {!isSameCase && <b title="Plan details will be reused; this discipline keeps its own history"> (other discipline)</b>}
          </span>
        )}
        <span className="spacer" />
        {!nothing && <button className="btn btn-dark btn-sm" onClick={onApply}>Use what&rsquo;s on file</button>}
        <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear prefilled</button>
        {matchedCase && onHistory && <button className="btn btn-ghost btn-sm" onClick={onHistory}>History</button>}
      </div>

      {candidates?.length > 0 && (
        <p className="hint warn-text">
          Also on file with a similar name: {candidates.map((c) => `${c.lastName}, ${c.firstName}`).join("; ")} — check you have the right patient.
        </p>
      )}

      {reference && (
        <div className="pf-row">
          <span className="pf-k" title="From the last call — shown for comparison, never filled in">
            Last call {reference.on ? fmtDate(reference.on) : ""}
          </span>
          {reference.items.map((i) => (
            <button key={i.key} className="pf-ref" onClick={() => onCopy(i.key, i.value)} title="Click to use this value">
              {HEAD[i.key]} <b>{i.value}</b>
            </button>
          ))}
          <span className="hint">Click a figure to reuse it — the rep still has to confirm it.</span>
        </div>
      )}

      {priorVersion?.verify?.verdict && (
        <p className="hint">Last verification: {priorVersion.verify.verdict}{priorVersion.file ? ` · ${priorVersion.file}` : ""}</p>
      )}
    </div>
  );
}
