import { dash, fmtDate } from "../data/fields.js";

const Pair = ({ label, value }) => (
  <div className="dp">
    <span className="k">{label}</span>
    <span className="v">{dash(value)}</span>
  </div>
);

export default function PreviewDoc({ v }) {
  const name = (v.lastName || v.firstName)
    ? `${v.lastName || ""}${v.lastName && v.firstName ? ", " : ""}${v.firstName || ""}`
    : "—";
  const pct = v.covPct || ((v.copay === "NO" && v.coins === "NO") ? "100%" : "");
  const stamp = pct ? `PATIENT RESPONSIBILITY COVERED: ${pct}` : "BENEFITS VERIFIED";

  return (
    <div id="doc" className="doc">
      <div className="doc-head">
        <div className="doc-logo">US<span>24</span> SOLUTIONS</div>
        <div className="doc-sub">Innovative Technology Driven</div>
        <div className="doc-title">
          <h1>Pre-Authorization &amp; Benefits Determination</h1>
          <div className="stamp">{stamp}</div>
        </div>
      </div>
      <div className="doc-body">
        {v.note && (
          <div style={{ background: "var(--warn-bg)", borderLeft: "3px solid var(--accent)", padding: "8px 11px", borderRadius: "0 5px 5px 0", marginBottom: 14, fontWeight: 600 }}>
            {v.note}
          </div>
        )}

        <div className="doc-sec">
          <div className="doc-sec-t">Patient</div>
          <div className="doc-row">
            <Pair label="Patient name" value={name} />
            <Pair label="Date of birth" value={fmtDate(v.dob)} />
            <Pair label="Verification date" value={fmtDate(v.today)} />
            <Pair label="Verified by" value={v.verifiedBy} />
          </div>
        </div>

        <div className="doc-sec">
          <div className="doc-sec-t">Insurance &amp; plan</div>
          <div className="doc-row">
            <Pair label="Insurance" value={v.insName} />
            <Pair label="Payer phone" value={v.insPhone} />
            <Pair label="Policy ID" value={v.policyId} />
            <Pair label="Group ID" value={v.groupId} />
            <Pair label="Plan type" value={v.planType} />
            <Pair label="Service type" value={v.serviceType} />
            <Pair label="Network status" value={v.network} />
            <Pair label="Coverage" value={v.coverage} />
            <Pair label="Effective date" value={fmtDate(v.effDate)} />
            <Pair label="Termination date" value={v.termDate} />
            <Pair label="Payer ID" value={v.payerId} />
            <Pair label="HCA / HRA" value={v.hra} />
          </div>
        </div>

        <div className="doc-sec">
          <div className="doc-sec-t">Patient financial responsibility</div>
          <div className="doc-row">
            <Pair label="Co-pay" value={v.copay} />
            <Pair label="Co-pay amount" value={v.copayAmt} />
            <Pair label="Co-insurance" value={v.coins} />
            <Pair label="Co-insurance %" value={v.coinsAmt} />
            <Pair label="Deductible applies" value={v.dedApply} />
            <Pair label="Deductible (ind.)" value={v.dedInd} />
            <Pair label="Deductible met" value={v.dedMet} />
            <Pair label="Deductible remaining" value={v.dedRem} />
            <Pair label="Out of pocket max" value={v.oop} />
            <Pair label="OOP met" value={v.oopMet} />
            <Pair label="OOP remaining" value={v.oopRem} />
            <Pair label="Coverage %" value={v.covPct} />
          </div>
        </div>

        <div className="doc-sec">
          <div className="doc-sec-t">Visits &amp; authorization</div>
          <div className="doc-row">
            <Pair label="Visit limitation" value={v.visitLimit} />
            <Pair label="Visits used" value={v.visitUsed} />
            <Pair label="Auth — initial eval" value={v.authEval} />
            <Pair label="Auth — treatment" value={v.authTx} />
            <Pair label="Referral required" value={v.referral} />
            <Pair label="PCP referral" value={v.pcpRef} />
            <Pair label="Authorization #" value={v.authNum} />
            <Pair label="Auth coverage dates" value={v.authDates} />
          </div>
          <div className="doc-row one" style={{ marginTop: 4 }}>
            <Pair label="How to obtain authorization" value={v.authHow} />
            <Pair label="Auth request window from DOS" value={v.authWindow} />
          </div>
        </div>

        <div className="doc-sec">
          <div className="doc-sec-t">Claims &amp; call record</div>
          <div className="doc-row">
            <Pair label="Timely filing — claims" value={v.tfl} />
            <Pair label="Timely filing — corrected" value={v.tflCorr} />
            <Pair label="Primary payer" value={v.primary} />
            <Pair label="Secondary" value={v.hasSec} />
            <Pair label="Insurance rep" value={v.repName} />
            <Pair label="Call reference" value={v.callRef} />
          </div>
          <div className="doc-row one" style={{ marginTop: 4 }}>
            <Pair label="Claim mailing address" value={v.claimAddr} />
          </div>
        </div>

        {v.hasSec === "YES" && (
          <div className="doc-sec">
            <div className="doc-sec-t">Secondary insurance</div>
            <div className="doc-row">
              <Pair label="Insurance" value={v.secName} />
              <Pair label="Plan name" value={v.secPlan} />
              <Pair label="Policy ID" value={v.secPolicy} />
              <Pair label="Effective date" value={fmtDate(v.secEff)} />
              <Pair label="Deductible" value={v.secDed} />
              <Pair label="Visit limit" value={v.secVisit} />
              <Pair label="Used limit" value={v.secUsed} />
              <Pair label="" value="" />
            </div>
          </div>
        )}

        <div className="doc-foot">
          <span>US24 Solutions — Confidential. Benefits quoted are not a guarantee of payment.</span>
          <span>Ref {v.callRef || "—"}</span>
        </div>
      </div>
    </div>
  );
}
