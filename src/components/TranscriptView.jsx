import { checkTranscript, spansFromChecks } from "../lib/verify.js";
import { dash } from "../data/fields.js";

// Every status checkTranscript can emit needs a glyph and a class here. When one
// is missing it falls through to a red ✗ — which is how a perfect nine-field
// auto-fill came to display as nine failures. display.test.js pins this.
const TICK = {
  found: "✓", attested: "✓", autofill: "◆", carrier: "†", bypassed: "—",
  echo: "↩", mismatch: "≠", missing: "✗", elsewhere: "✗", quiet: "·",
};

const ROW = {
  found: "", attested: "ok", autofill: "auto", carrier: "quiet", bypassed: "quiet",
  echo: "miss", mismatch: "bad", missing: "miss", elsewhere: "miss", quiet: "quiet",
};

const NOTE = {
  autofill: "read from the call — not checked yet",
  attested: "read from the call, accepted",
  carrier: "from our records, not this call",
  bypassed: "bypassed",
  echo: "our side said it, the rep did not",
  elsewhere: "not said about this field",
};

export function Checklist({ checks }) {
  if (!checks.length) return <p className="hint">No filled fields to verify yet.</p>;
  return (
    <div className="vlist">
      {checks.map((c) => (
        <div key={c.key} className={"vitem " + (ROW[c.status] || "miss") + (c.soft ? " soft" : "")}>
          <span className="tick">{TICK[c.status] || "✗"}</span>
          <span className="vlabel">{c.label}</span>
          <span className="vval">{dash(c.value)}</span>
          {c.status === "mismatch" && <span className="vheard">call says “{c.heard}”</span>}
          {NOTE[c.status] && <span className="vheard">{NOTE[c.status]}</span>}
        </div>
      ))}
    </div>
  );
}

export default function TranscriptView({ v, transcript, result, meta, ranges }) {
  const res = result || checkTranscript(v, transcript, meta, { ranges });
  const spans = spansFromChecks(res.checks);
  const parts = [];
  let pos = 0;
  spans.forEach((s, i) => {
    if (s.start > pos) parts.push(transcript.slice(pos, s.start));
    parts.push(
      <mark
        key={i}
        className={"hl" + (s.kind === "bad" ? " bad" : "")}
        title={s.kind === "bad" ? `${s.label}: form says “${s.value}”, call says “${s.heard}”` : s.label}
      >
        {transcript.slice(s.start, s.end)}
      </mark>
    );
    pos = s.end;
  });
  if (pos < transcript.length) parts.push(transcript.slice(pos));
  return (
    <div>
      <Checklist checks={res.checks} />
      <div className="transcript-box">{parts.length ? parts : <span className="hint">No transcript captured.</span>}</div>
    </div>
  );
}
