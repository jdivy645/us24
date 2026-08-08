import { useState } from "react";
import { BYPASS_REASONS } from "../lib/bypass.js";

// Each input carries its own verification state, so a contradiction is visible
// where the value is typed rather than only in a panel beside it.
//
// Four provenance states are told apart on sight. The dashed border is the key
// move: nothing else in the form is dashed, so "a machine wrote this and nobody
// has checked it" reads across the whole page at a glance.
const GLYPH = {
  ok: "✓", attested: "✓·", autofill: "◆", filedisagree: "⚑",
  conflict: "✗", contested: "!", echo: "↩", carrier: "†", bypassed: "—",
};

const clamp = (s, n = 130) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

function Status({ s, set, onKeep, onAccept, onReject, onUseSuggestion, onShowInCall }) {
  if (!s) return null;
  const heard = s.heard != null ? String(s.heard).replace(/\s+/g, " ").trim() : "";

  // Read from the call, nobody has looked. The quote is shown at zero click cost:
  // reading it is the thing actually wanted, so it must be free.
  if (s.kind === "autofill") {
    return (
      <div className="fs auto">
        <span className="fs-quote">Rep said “{clamp(s.quote)}”</span>
        {s.unplaced && <span className="fs-weak">one reading only — worth a look</span>}
        <button type="button" className="btn btn-dark btn-xs" onClick={() => onAccept([s.key])}>Accept</button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => onReject(s.key)}>Clear</button>
        {onShowInCall && <button type="button" className="btn btn-ghost btn-xs" onClick={() => onShowInCall(s)}>Show in call</button>}
      </div>
    );
  }
  if (s.kind === "attested") {
    return <div className="fs kept">Read from the call{s.by ? `, accepted by ${s.by}` : ", accepted"} — “{clamp(s.quote, 80)}”</div>;
  }
  // Our records say one thing and the rep said another. Neither is overwritten.
  if (s.kind === "filedisagree") {
    return (
      <div className="fs bad">
        <span>On file <b>“{s.onFile}”</b> · call says <b>“{clamp(s.heard, 60)}”</b></span>
        <button type="button" className="btn btn-dark btn-xs" onClick={() => set(s.key, s.heard)}>Use the call</button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => onKeep(s.key, s.heard, s.onFile)}>Keep the file value</button>
      </div>
    );
  }
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
  // Below the bar to write in, but the operator should still see it.
  if (s.suggestion) {
    return (
      <div className="fs warn">
        <span>Call may say <b>“{s.suggestion.value}”</b> — {s.suggestion.why}</span>
        <button type="button" className="btn btn-dark btn-xs" onClick={() => onUseSuggestion(s.suggestion)}>Use it</button>
      </div>
    );
  }
  if (s.kind === "neutral" || s.kind === "ok") return null;
  if (s.kind === "bypassed") return <div className="fs muted">Bypassed — {s.detail}</div>;
  if (s.kind === "carrier") return <div className="fs muted">{s.detail || "carrier data"} — not from this call</div>;
  if (s.kind === "echo") return <div className="fs warn">You said this; the rep never confirmed it.</div>;
  if (s.kind === "notheard") return <div className="fs warn">{s.elsewhere ? "Said in the call, but about something else." : "Not heard on the call."}</div>;
  if (s.kind === "required") return <div className="fs bad">Required.</div>;
  return null;
}

// One strip per form section. The unit of attention is the section, because that
// is how a VOB form is actually read — and because a per-field accept on 38 fields
// trains a click-through reflex within a week, which produces a record carrying 38
// attestations that are all false.
//
// The money and authorization fields are carved out and signed for individually:
// a wrong value there costs a denial or treatment without cover.
function SectionHead({ title, keys, states, onAccept, onClearSection }) {
  const items = keys.map((k) => states?.get(k)).filter((s) => s && s.kind === "autofill");
  const bulk = items.filter((s) => !s.strict);
  const missing = keys.map((k) => states?.get(k)).filter((s) => s && s.kind === "required").length;
  return (
    <div className="section-label sec-head">
      <span>{title}</span>
      {items.length > 0 && (
        <span className="sec-actions">
          <span className="sec-count">{items.length} from the call</span>
          {bulk.length > 0 && (
            <button type="button" className="btn btn-dark btn-xs" onClick={() => onAccept(bulk.map((s) => s.key))}>
              Accept {bulk.length}
            </button>
          )}
          {items.length > bulk.length && (
            <span className="hint">{items.length - bulk.length} to check one by one</span>
          )}
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onClearSection(items.map((s) => s.key))}>Clear</button>
        </span>
      )}
      {missing > 0 && <span className="sec-missing">{missing} still to ask</span>}
    </div>
  );
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

function Field({ id, label, req, state, P, full, children }) {
  const kind = state?.kind || "neutral";
  return (
    <div className={"f f-" + kind + (full ? " full" : "")}>
      <label htmlFor={"f-" + id}>
        {label}{req && <> <span className="req">*</span></>}
        {GLYPH[kind] && <span className={"f-glyph g-" + kind}>{GLYPH[kind]}</span>}
        <Bypass id={id} state={state} onBypass={P.onBypass} onClear={P.onClearBypass} />
      </label>
      {children}
      <Status
        s={state} set={P.set} onKeep={P.onKeep}
        onAccept={P.onAccept} onReject={P.onReject}
        onUseSuggestion={P.onUseSuggestion} onShowInCall={P.onShowInCall}
      />
    </div>
  );
}

function Text({ P, id, label, req, type = "text", placeholder, full }) {
  const state = P.states?.get(id);
  return (
    <Field id={id} label={label} req={req} state={state} P={P} full={full}>
      <input
        id={"f-" + id}
        type={type}
        placeholder={placeholder}
        value={P.form[id]}
        disabled={state?.kind === "bypassed"}
        onChange={(e) => P.set(id, e.target.value)}
      />
    </Field>
  );
}

function Sel({ P, id, label, options }) {
  const state = P.states?.get(id);
  return (
    <Field id={id} label={label} state={state} P={P}>
      <select id={"f-" + id} value={P.form[id]} disabled={state?.kind === "bypassed"} onChange={(e) => P.set(id, e.target.value)}>
        <option value="">— select —</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </Field>
  );
}

// The keys each section owns, so a whole section can be signed for at once.
const SECTIONS = {
  patient: ["lastName", "firstName", "dob", "today"],
  insurance: ["insName", "insPhone", "policyId", "groupId", "planType", "serviceType",
    "network", "networkInd", "coverage", "effDate", "termDate", "payerId", "hra"],
  financials: ["copay", "copayAmt", "covPct", "coins", "coinsAmt", "dedApply",
    "dedInd", "dedMet", "dedRem", "oop", "oopMet", "oopRem"],
  auth: ["visitLimit", "visitUsed", "authEval", "authTx", "authAfter", "referral",
    "pcpRef", "authHow", "authWindow", "authNum", "authDates"],
  claims: ["tfl", "tflCorr", "claimAddr", "repName", "callRef", "verifiedBy", "primary"],
  secondary: ["hasSec", "secName", "secPlan", "secPolicy", "secEff", "secDed", "secVisit", "secUsed"],
};

export default function VerificationForm(props) {
  const {
    form, set, states, onKeep, onBypass, onClearBypass, onGenerateNote,
    onAccept, onReject, onUseSuggestion, onShowInCall, onClearSection,
    onSave, onPreviewPDF, onClear, onLoadSample,
  } = props;
  const P = { form, set, states, onKeep, onBypass, onClearBypass, onAccept, onReject, onUseSuggestion, onShowInCall };
  const Head = ({ title, k }) => (
    <SectionHead title={title} keys={SECTIONS[k]} states={states} onAccept={onAccept} onClearSection={onClearSection} />
  );
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

        <Head title="Patient" k="patient" />
        <div className="grid">
          <Text P={P} id="lastName" label="Last name" req />
          <Text P={P} id="firstName" label="First name" req />
          <Text P={P} id="dob" label="Date of birth" type="date" />
          <Text P={P} id="today" label="Verification date" type="date" />
        </div>

        <Head title="Insurance" k="insurance" />
        <div className="grid">
          <Text P={P} id="insName" label="Insurance name" req />
          <Text P={P} id="insPhone" label="Payer phone" />
          <Text P={P} id="policyId" label="Policy ID" />
          <Text P={P} id="groupId" label="Group ID" />
          <Text P={P} id="planType" label="Plan type" />
          <Sel P={P} id="serviceType" label="Service type" options={["PT", "OT", "ST", "PT/OT", "Chiropractic", "Other"]} />
          <Sel P={P} id="network" label="Network status (group)" options={["IN NETWORK", "OUT OF NETWORK"]} />
          <Sel P={P} id="networkInd" label="Network status (ind. provider)" options={["IN NETWORK", "OUT OF NETWORK"]} />
          <Text P={P} id="coverage" label="Coverage" placeholder="INN BENEFITS WITH AUTH" />
          <Text P={P} id="effDate" label="Effective date" type="date" />
          <Text P={P} id="termDate" label="Termination date" placeholder="NO" />
          <Text P={P} id="payerId" label="Payer ID" />
          <Text P={P} id="hra" label="HSA / HRA amount" />
        </div>

        <Head title="Patient financials" k="financials" />
        <div className="grid-3">
          <Sel P={P} id="copay" label="Co-pay" options={["NO", "YES"]} />
          <Text P={P} id="copayAmt" label="Co-pay amount" placeholder="$0.00" />
          <Text P={P} id="covPct" label="Coverage %" placeholder="100%" />
          <Sel P={P} id="coins" label="Co-insurance" options={["NO", "YES"]} />
          <Text P={P} id="coinsAmt" label="Co-insurance %" />
          <Sel P={P} id="dedApply" label="Deductible applies" options={["NO", "YES"]} />
          <Text P={P} id="dedInd" label="Deductible (individual)" placeholder="$0.00" />
          <Text P={P} id="dedMet" label="Deductible met" />
          <Text P={P} id="dedRem" label="Deductible remaining" />
          <Text P={P} id="oop" label="Out of pocket max" placeholder="$0.00" />
          <Text P={P} id="oopMet" label="OOP met" />
          <Text P={P} id="oopRem" label="OOP remaining" />
        </div>

        <Head title="Visits & authorization" k="auth" />
        <div className="grid">
          <Text P={P} id="visitLimit" label="Visit limitation" placeholder="MN (medically necessary)" />
          <Text P={P} id="visitUsed" label="Visits used" />
          <Sel P={P} id="authEval" label="Auth required — initial eval" options={["YES", "NO"]} />
          <Sel P={P} id="authTx" label="Auth required — treatment" options={["YES", "NO"]} />
          <Text P={P} id="authAfter" label="Auth required after visit #" placeholder="5" />
          <Sel P={P} id="referral" label="Referral required" options={["NO", "YES"]} />
          <Sel P={P} id="pcpRef" label="PCP referral for approval" options={["NO", "YES"]} />
          <Text P={P} id="authHow" label="How to obtain authorization" />
          <Text P={P} id="authWindow" label="Auth request window from DOS" />
          <Text P={P} id="authNum" label="Authorization #" />
          <Text P={P} id="authDates" label="Auth coverage dates" />
        </div>

        <Head title="Claims & call record" k="claims" />
        <div className="grid">
          <Text P={P} id="tfl" label="Timely filing — claims" placeholder="120 DAYS FROM DOS" />
          <Text P={P} id="tflCorr" label="Timely filing — corrected" placeholder="180 DAYS FROM DOS" />
          <Text P={P} id="claimAddr" label="Claim mailing address" full />
          <Text P={P} id="repName" label="Insurance rep name" />
          <Text P={P} id="callRef" label="Call reference #" />
          <Text P={P} id="verifiedBy" label="Verified by (your team)" />
          <Text P={P} id="primary" label="Primary payer" />
        </div>

        <Head title="Secondary insurance" k="secondary" />
        <div className="grid">
          <Sel P={P} id="hasSec" label="Secondary on file" options={["NO", "YES"]} />
          <Text P={P} id="secName" label="Secondary insurance name" />
          <Text P={P} id="secPlan" label="Plan name" />
          <Text P={P} id="secPolicy" label="Policy ID" />
          <Text P={P} id="secEff" label="Effective date" type="date" />
          <Text P={P} id="secDed" label="Deductible" placeholder="$0.00" />
          <Text P={P} id="secVisit" label="Visit limit" />
          <Text P={P} id="secUsed" label="Used limit" />
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
