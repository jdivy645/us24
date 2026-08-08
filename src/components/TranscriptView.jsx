import { checkTranscript, spansFromChecks } from "../lib/verify.js";
import { dash } from "../data/fields.js";

const TICK = { found: "✓", mismatch: "≠", missing: "✗", elsewhere: "✗", quiet: "·" };

export function Checklist({ checks }) {
  if (!checks.length) return <p className="hint">No filled fields to verify yet.</p>;
  return (
    <div className="vlist">
      {checks.map((c) => (
        <div key={c.key} className={"vitem" + (c.status === "missing" || c.status === "elsewhere" ? " miss" : "") + (c.status === "mismatch" ? " bad" : "") + (c.status === "quiet" ? " quiet" : "") + (c.soft ? " soft" : "")}>
          <span className="tick">{TICK[c.status] || "✗"}</span>
          <span className="vlabel">{c.label}</span>
          <span className="vval">{dash(c.value)}</span>
          {c.status === "mismatch" && <span className="vheard">call says “{c.heard}”</span>}
          {c.status === "elsewhere" && <span className="vheard">not said about this field</span>}
        </div>
      ))}
    </div>
  );
}

export default function TranscriptView({ v, transcript, result, meta }) {
  const res = result || checkTranscript(v, transcript, meta);
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
