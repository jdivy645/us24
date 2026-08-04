function Text({ form, set, errs, id, label, req, type = "text", placeholder, full }) {
  return (
    <div className={"f" + (full ? " full" : "")}>
      <label>{label}{req && <> <span className="req">*</span></>}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={form[id]}
        onChange={(e) => set(id, e.target.value)}
        className={errs && errs.has(id) ? "err" : undefined}
      />
    </div>
  );
}

function Sel({ form, set, id, label, options }) {
  return (
    <div className="f">
      <label>{label}</label>
      <select value={form[id]} onChange={(e) => set(id, e.target.value)}>
        <option value="">— select —</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

export default function VerificationForm({ form, set, errs, onSave, onPreviewPDF, onClear, onLoadSample }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Verification details</h2>
          <p>Fill what the payer confirmed. Blank fields print as “—”.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onLoadSample}>Load sample</button>
      </div>
      <div className="card-body">

        <div className="section-label">Patient</div>
        <div className="grid">
          <Text form={form} set={set} errs={errs} id="lastName" label="Last name" req />
          <Text form={form} set={set} errs={errs} id="firstName" label="First name" req />
          <Text form={form} set={set} id="dob" label="Date of birth" type="date" />
          <Text form={form} set={set} id="today" label="Verification date" type="date" />
        </div>

        <div className="section-label">Insurance</div>
        <div className="grid">
          <Text form={form} set={set} errs={errs} id="insName" label="Insurance name" req />
          <Text form={form} set={set} id="insPhone" label="Payer phone" />
          <Text form={form} set={set} id="policyId" label="Policy ID" />
          <Text form={form} set={set} id="groupId" label="Group ID" />
          <Text form={form} set={set} id="planType" label="Plan type" />
          <Sel form={form} set={set} id="serviceType" label="Service type" options={["PT", "OT", "ST", "PT/OT", "Chiropractic", "Other"]} />
          <Sel form={form} set={set} id="network" label="Network status" options={["IN NETWORK", "OUT OF NETWORK"]} />
          <Text form={form} set={set} id="coverage" label="Coverage" />
          <Text form={form} set={set} id="effDate" label="Effective date" type="date" />
          <Text form={form} set={set} id="termDate" label="Termination date" />
          <Text form={form} set={set} id="payerId" label="Payer ID" />
          <Text form={form} set={set} id="hra" label="HCA / HRA amount" placeholder="NA" />
        </div>

        <div className="section-label">Patient financials</div>
        <div className="grid-3">
          <Sel form={form} set={set} id="copay" label="Co-pay" options={["NO", "YES"]} />
          <Text form={form} set={set} id="copayAmt" label="Co-pay amount" placeholder="$0.00" />
          <Text form={form} set={set} id="covPct" label="Coverage %" placeholder="100%" />
          <Sel form={form} set={set} id="coins" label="Co-insurance" options={["NO", "YES"]} />
          <Text form={form} set={set} id="coinsAmt" label="Co-insurance %" />
          <Sel form={form} set={set} id="dedApply" label="Deductible applies" options={["NO", "YES"]} />
          <Text form={form} set={set} id="dedInd" label="Deductible (individual)" placeholder="NA" />
          <Text form={form} set={set} id="dedMet" label="Deductible met" />
          <Text form={form} set={set} id="dedRem" label="Deductible remaining" />
          <Text form={form} set={set} id="oop" label="Out of pocket max" placeholder="NA" />
          <Text form={form} set={set} id="oopMet" label="OOP met" />
          <Text form={form} set={set} id="oopRem" label="OOP remaining" />
        </div>

        <div className="section-label">Visits &amp; authorization</div>
        <div className="grid">
          <Text form={form} set={set} id="visitLimit" label="Visit limitation" placeholder="MN (medically necessary)" />
          <Text form={form} set={set} id="visitUsed" label="Visits used" />
          <Sel form={form} set={set} id="authEval" label="Auth required — initial eval" options={["YES", "NO"]} />
          <Sel form={form} set={set} id="authTx" label="Auth required — treatment" options={["YES", "NO"]} />
          <Sel form={form} set={set} id="referral" label="Referral required" options={["NO", "YES"]} />
          <Sel form={form} set={set} id="pcpRef" label="PCP referral for approval" options={["NO", "YES"]} />
          <Text form={form} set={set} id="authHow" label="How to obtain authorization" />
          <Text form={form} set={set} id="authWindow" label="Auth request window from DOS" />
          <Text form={form} set={set} id="authNum" label="Authorization #" />
          <Text form={form} set={set} id="authDates" label="Auth coverage dates" />
        </div>

        <div className="section-label">Claims &amp; call record</div>
        <div className="grid">
          <Text form={form} set={set} id="tfl" label="Timely filing — claims" placeholder="120 DAYS FROM DOS" />
          <Text form={form} set={set} id="tflCorr" label="Timely filing — corrected" placeholder="180 DAYS FROM DOS" />
          <Text form={form} set={set} id="claimAddr" label="Claim mailing address" full />
          <Text form={form} set={set} id="repName" label="Insurance rep name" />
          <Text form={form} set={set} id="callRef" label="Call reference #" />
          <Text form={form} set={set} id="verifiedBy" label="Verified by (your team)" />
          <Text form={form} set={set} id="primary" label="Primary payer" />
        </div>

        <div className="section-label">Secondary insurance</div>
        <div className="grid">
          <Sel form={form} set={set} id="hasSec" label="Secondary on file" options={["NO", "YES"]} />
          <Text form={form} set={set} id="secName" label="Secondary insurance name" />
          <Text form={form} set={set} id="secPlan" label="Plan name" />
          <Text form={form} set={set} id="secPolicy" label="Policy ID" />
          <Text form={form} set={set} id="secEff" label="Effective date" type="date" />
          <Text form={form} set={set} id="secDed" label="Deductible" placeholder="NA" />
          <Text form={form} set={set} id="secVisit" label="Visit limit" />
          <Text form={form} set={set} id="secUsed" label="Used limit" />
        </div>

        <div className="section-label">Summary note</div>
        <div className="f">
          <label>Additional information (prints in the highlighted banner)</label>
          <textarea
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="e.g. Patient is 100% covered by Aetna as per member's plan."
          />
        </div>

      </div>
      <div className="actionbar">
        <button className="btn btn-primary" onClick={onSave}>Save &amp; generate PDF</button>
        <button className="btn btn-dark" onClick={onPreviewPDF}>Preview PDF only</button>
        <div className="spacer"></div>
        <button className="btn btn-ghost" onClick={onClear}>Clear form</button>
      </div>
    </div>
  );
}
