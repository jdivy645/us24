import { useLayoutEffect, useRef, useState } from "react";
import { buildVobDoc } from "../lib/vobTemplate.js";
import { LOGO_PNG } from "../assets/logo.js";

// The on-screen twin of lib/pdf.js. Both render buildVobDoc() and nothing else,
// so this file never names a form field — adding a row is a one-line edit in
// vobTemplate.js and both outputs follow.

const SCALES = [1, 0.94, 0.88, 0.82];

const Line = ({ line }) => {
  if (line.gap) return <div className="vob-gap" />;
  const body = (line.value != null && line.value !== "" ? line.value : line.text) || "";
  return (
    <div className={"vob-l" + (line.muted ? " muted" : "")}>
      {line.label && <b>{line.label}</b>}
      {line.label && body ? " " : ""}
      <span>{body}{line.mark}</span>
    </div>
  );
};

export default function PreviewDoc({ v, meta }) {
  const doc = buildVobDoc(v, meta || {});
  const boxRef = useRef(null);
  const innerRef = useRef(null);
  const [step, setStep] = useState(0);

  // Mirror the PDF's shrink-to-one-page behaviour.
  useLayoutEffect(() => {
    const box = boxRef.current, inner = innerRef.current;
    if (!box || !inner) return;
    let i = 0;
    while (i < SCALES.length - 1 && inner.scrollHeight * (SCALES[i] / SCALES[step]) > box.clientHeight) i++;
    if (i !== step) setStep(i);
  });

  return (
    <div id="doc" className="vob" ref={boxRef} style={{ "--vob-scale": SCALES[step] }}>
      <div ref={innerRef}>
        <header className="vob-head">
          {LOGO_PNG
            ? <img className="vob-logo-img" src={LOGO_PNG} alt="US24 Solutions" />
            : (
              <div className="vob-logo">
                <div className="vob-mark">US<span>24</span> SOLUTIONS</div>
                <div className="vob-tag">{doc.tagline}</div>
              </div>
            )}
          <div className="vob-pat">{doc.patBox}</div>
        </header>

        <h1 className="vob-title">{doc.title}</h1>

        <table className="vob-tbl">
          <tbody>
            {doc.rows.map((r, i) => (
              <tr key={r.id} className={i % 2 === 0 ? "shade" : undefined}>
                {r.cells.map((c, j) => (
                  <td key={j} colSpan={r.cells.length === 1 ? 2 : 1}>
                    {c.lines.map((l, k) => <Line key={k} line={l} />)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {doc.footnotes.map((n) => <p key={n} className="vob-note">{n}</p>)}
        <p className="vob-foot">{doc.footer}</p>
      </div>
    </div>
  );
}
