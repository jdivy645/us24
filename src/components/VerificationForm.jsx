import { useState } from "react";
import { BYPASS_REASONS } from "../lib/bypass.js";

// Each input carries its own verification state, so a contradiction is visible
// where the value is typed rather than only in a panel beside it.
const GLYPH = { ok: "✓", conflict: "✗", contested: "!", echo: "↩", carrier: "†", bypassed: "—" };

function Status({ s, set, onKeep }) {
  if (!s || s.kind === "neutral" || s.kind === "ok") return null;
  const heard = s.heard != null ? String(s.heard).replace(/\s+/g, " ").trim() : "";
  if (s.kind === "conflict" || s.kind === "contested") {
    if (s.acked) return <div className="fs kept">Keeping your value — the call said “{heard}”.</div>;
    return (
      <div className="fs bad">
        <span>Call {s.confidence === "low" ? "may say" : "says"} <b>“{heard}”</b></span>
        <button type="button" className="btn btn-dark btn-xs" onClick={() => set(s.key, heard)}>Use it</button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => onKeep(s.key, heard, s.value)}>Keep mine</button>
      </div>
    );
  }
  if (s.kind === "bypassed") return <div className="fs muted">Bypassed — {s.detail}</div>;
  if (s.kind === "carrier") return <div className="fs muted">{s.detail || "carrier data"} — not from this call</div>;
  if (s.kind === "echo") return <div className="fs warn">You said this; the rep never confirmed it.</div>;
  if (s.kind === "notheard") return <div className="fs warn">{s.elsewhere ? "Said in the call, but about something else." : "Not heard on the call."}</div>;
  if (s.kind === "required") return <div className="fs bad">Required.</div>;
  return null;
}

function Bypass({ id, state, onBypass, onClear }) {
  const [open, setOpen] = useState(false);
  if (state?.kind === "bypassed") {
    return <button type="button" className="na-btn on" title={state.detail} onClick={() => onClear(id)}>N/A ×</button>;
  }
  return (
    <span className="na-wrap">
      <button type="button" className="na-btn" aria-expanded={open} onClick={() => setOpen(!open)}>N/A ▾</button>
      {open && (
        <span className="na-pop">
          {Object.entries(BYPASS_REASONS).map(([k, label]) => (
            <button type="button" key={k} onClick={() => { onBypass(id, k); setOpen(false); }}>{label}</button>
          ))}
        </span>
      )}
    </span>
  );
}

function Field({ id, label, req, state, set, onKeep, onBypass, onClearBypass, full, children }) {
  const kind = state?.kind || "neutral";
  return (
    <div className={"f f-" + kind + (full ? " full" : "")}>
      <label htmlFor={"f-" + id}>
        {label}{req && <> <span className="req">*</span></>}
        {GLYPH[kind] && <span className={"f-glyph g-" + kind}>{GLYPH[kind]}</span>}
        <Bypass id={id} state={state} onBypass={onBypass} onClear={onClearBypass} />
      </label>
      {children}
      <Status s={state} set={set} onKeep={onKeep} />
    </div>
  );
}

function Text({ form, set, states, onKeep, onBypass, onClearBypass, id, label, req, type = "text", placeholder, full }) {
  const state = states?.get(id);
  return (
    <Field id={id} label={label} req={req} state={state} set={set} onKeep={onKeep}
      onBypass={onBypass} onClearBypass={onClearBypass} full={full}>
      <input
        id={"f-" + id}
        type={type}
        placeholder={placeholder}
        value={form[id]}
        disabled={state?.kind === "bypassed"}
        onChange={(e) => set(id, e.target.value)}
      />
    </Field>
  );
}

function Sel({ form, set, states, onKeep, onBypass, onClearBypass, id, label, options }) {
  const state = states?.get(id);
  return (
    <Field id={id} label={label} state={state} set={set} onKeep={onKeep}
      onBypass={onBypass} onClearBypass={onClearBypass}>
      <select id={"f-" + id} value={form[id]} disabled={state?.kind === "bypassed"} onChange={(e) => set(id, e.target.value)}>
        <option value="">— select —</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </Field>
  );
}

export default function VerificationForm({ form, set, states, onKeep, onBypass, onClearBypass, onGenerateNote, onSave, onPreviewPDF, onClear, onLoadSample }) {
  const P = { form, set, states, onKeep, onBypass, onClearBypass };
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Verification details</h2>
          <p>Fill what the payer confirmed. Each field is checked against the call as you type.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onLoadSample}>Load sample</button>
      </div>
      <div className="card-body">

        <div className="section-label">Patient</div>
        <div className="grid">
          <Text {...P} id="lastName" label="Last name" req />
          <Text {...P} id="firstName" label="First name" req />
          <Text {...P} id="dob" label="Date of birth" type="date" />
          <Text {...P} id="today" label="Verification date" type="date" />
        </div>

        <div className="section-label">Insurance</div>
        <div className="grid">
          <Text {...P} id="insName" label="Insurance name" req />
          <Text {...P} id="insPhone" label="Payer phone" />
          <Text {...P} id="policyId" label="Policy ID" />
          <Text {...P} id="groupId" label="Group ID" />
          <Text {...P} id="planType" label="Plan type" />
          <Sel {...P} id="serviceType" label="Service type" options={["PT", "OT", "ST", "PT/OT", "Chiropractic", "Other"]} />
          <Sel {...P} id="network" label="Network status (group)" options={["IN NETWORK", "OUT OF NETWORK"]} />
          <Sel {...P} id="networkInd" label="Network status (ind. provider)" options={["IN NETWORK", "OUT OF NETWORK"]} />
          <Text {...P} id="coverage" label="Coverage" placeholder="INN BENEFITS WITH AUTH" />
          <Text {...P} id="effDate" label="Effective date" type="date" />
          <Text {...P} id="termDate" label="Termination date" placeholder="NO" />
          <Text {...P} id="payerId" label="Payer ID" />
          <Text {...P} id="hra" label="HSA / HRA amount" />
        </div>

        <div className="section-label">Patient financials</div>
        <div className="grid-3">
          <Sel {...P} id="copay" label="Co-pay" options={["NO", "YES"]} />
          <Text {...P} id="copayAmt" label="Co-pay amount" placeholder="$0.00" />
          <Text {...P} id="covPct" label="Coverage %" placeholder="100%" />
          <Sel {...P} id="coins" label="Co-insurance" options={["NO", "YES"]} />
          <Text {...P} id="coinsAmt" label="Co-insurance %" />
          <Sel {...P} id="dedApply" label="Deductible applies" options={["NO", "YES"]} />
          <Text {...P} id="dedInd" label="Deductible (individual)" placeholder="$0.00" />
          <Text {...P} id="dedMet" label="Deductible met" />
          <Text {...P} id="dedRem" label="Deductible remaining" />
          <Text {...P} id="oop" label="Out of pocket max" placeholder="$0.00" />
          <Text {...P} id="oopMet" label="OOP met" />
          <Text {...P} id="oopRem" label="OOP remaining" />
        </div>

        <div className="section-label">Visits &amp; authorization</div>
        <div className="grid">
          <Text {...P} id="visitLimit" label="Visit limitation" placeholder="MN (medically necessary)" />
          <Text {...P} id="visitUsed" label="Visits used" />
          <Sel {...P} id="authEval" label="Auth required — initial eval" options={["YES", "NO"]} />
          <Sel {...P} id="authTx" label="Auth required — treatment" options={["YES", "NO"]} />
          <Text {...P} id="authAfter" label="Auth required after visit #" placeholder="5" />
          <Sel {...P} id="referral" label="Referral required" options={["NO", "YES"]} />
          <Sel {...P} id="pcpRef" label="PCP referral for approval" options={["NO", "YES"]} />
          <Text {...P} id="authHow" label="How to obtain authorization" />
          <Text {...P} id="authWindow" label="Auth request window from DOS" />
          <Text {...P} id="authNum" label="Authorization #" />
          <Text {...P} id="authDates" label="Auth coverage dates" />
        </div>

        <div className="section-label">Claims &amp; call record</div>
        <div className="grid">
          <Text {...P} id="tfl" label="Timely filing — claims" placeholder="120 DAYS FROM DOS" />
          <Text {...P} id="tflCorr" label="Timely filing — corrected" placeholder="180 DAYS FROM DOS" />
          <Text {...P} id="claimAddr" label="Claim mailing address" full />
          <Text {...P} id="repName" label="Insurance rep name" />
          <Text {...P} id="callRef" label="Call reference #" />
          <Text {...P} id="verifiedBy" label="Verified by (your team)" />
          <Text {...P} id="primary" label="Primary payer" />
        </div>

        <div className="section-label">Secondary insurance</div>
        <div className="grid">
          <Sel {...P} id="hasSec" label="Secondary on file" options={["NO", "YES"]} />
          <Text {...P} id="secName" label="Secondary insurance name" />
          <Text {...P} id="secPlan" label="Plan name" />
          <Text {...P} id="secPolicy" label="Policy ID" />
          <Text {...P} id="secEff" label="Effective date" type="date" />
          <Text {...P} id="secDed" label="Deductible" placeholder="$0.00" />
          <Text {...P} id="secVisit" label="Visit limit" />
          <Text {...P} id="secUsed" label="Used limit" />
        </div>

        <div className="section-label">Summary note</div>
        <div className="f">
          <label>
            Additional info
            <button type="button" className="na-btn" onClick={onGenerateNote}>Generate from benefits</button>
          </label>
          <textarea
            id="f-note"
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Left blank, this is written from the deductible, co-pay and coinsurance you entered."
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
