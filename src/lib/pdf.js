import { jsPDF } from "jspdf";
import { buildVobDoc } from "./vobTemplate.js";
import { LOGO_PNG } from "../assets/logo.js";
import { vobName } from "./files.js";

// Renders the document model from vobTemplate.js as the client's production
// layout: a bordered two-column table, alternating row shading, one page.
//
// Drawn directly rather than through jspdf-autotable, which cannot mix a bold
// label and a normal value inside one cell without willDrawCell hooks plus manual
// row-height math — at which point you have written this layout engine anyway.

const NAVY = [27, 58, 107], ORANGE = [232, 118, 31], INK = [15, 27, 45];
const MUTED = [128, 140, 158], LINE = [150, 168, 192], SHADE = [223, 233, 244];

const M = 36;                 // page margin
const HEAD_H = 96;            // logo band + title
const FOOT_H = 34;

// Tried in order until the body fits on one page. Scale 0 is the normal case;
// the rest absorb an unusually long claim address or Additional Info.
const SCALES = [
  { font: 8.0, lead: 10.0, pad: 4.5 },
  { font: 7.5, lead: 9.2, pad: 4.0 },
  { font: 7.0, lead: 8.6, pad: 3.5 },
  { font: 6.5, lead: 8.0, pad: 3.0 },
];

// Wraps `value` after a bold label of width `lw`: the first line shares the row
// with the label, the rest use the cell's full width.
function wrapMixed(doc, value, firstW, fullW) {
  const text = String(value || "");
  if (!text) return [];
  const first = doc.splitTextToSize(text, Math.max(firstW, 12));
  if (first.length <= 1) return first;
  // The value did not fit beside the label — keep line 1, re-wrap the remainder.
  const head = first[0];
  const rest = text.slice(head.length).replace(/^\s+/, "");
  return rest ? [head, ...doc.splitTextToSize(rest, fullW)] : [head];
}

// Draws one "Label: value" line. Returns the height consumed. With measure=true
// it computes that height without touching the page.
function richLine(doc, x, y, w, line, S, measure) {
  if (line.gap) return S.lead * 0.5;

  doc.setFontSize(S.font);
  doc.setFont("helvetica", "bold");
  const label = line.label || "";
  const lw = label ? doc.getTextWidth(label) + 4 : 0;
  const body = (line.value != null && line.value !== "" ? line.value : line.text || "") + (line.mark || "");
  doc.setFont("helvetica", "normal");
  const parts = wrapMixed(doc, body, w - lw, w);

  if (!measure) {
    if (label) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...INK);
      doc.text(label, x, y);
    }
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...(line.muted ? MUTED : INK));
    if (parts[0]) doc.text(parts[0], x + lw, y);
    for (let i = 1; i < parts.length; i++) doc.text(parts[i], x, y + i * S.lead);
  }
  return Math.max(1, parts.length) * S.lead;
}

const cellHeight = (doc, cell, w, S) =>
  cell.lines.reduce((h, l) => h + richLine(doc, 0, 0, w, l, S, true), 0);

function rowHeight(doc, row, W, S) {
  const cw = row.cells.length === 1 ? W - S.pad * 2 : W / 2 - S.pad * 2;
  return Math.max(...row.cells.map((c) => cellHeight(doc, c, cw, S))) + S.pad * 2;
}

const bodyHeight = (doc, model, W, S) =>
  model.rows.reduce((h, r) => h + rowHeight(doc, r, W, S), 0);

function drawHeader(doc, model, W) {
  const cx = M + W / 2;
  if (LOGO_PNG) {
    const lw = 170, lh = 44;
    try { doc.addImage(LOGO_PNG, "PNG", cx - lw / 2, 24, lw, lh); } catch { drawWordmark(doc, cx); }
  } else {
    drawWordmark(doc, cx);
  }

  // Patient responsibility, and the payer it is against, boxed at the top right.
  //
  // Two boxes rather than one line: they answer different questions and a filing
  // clerk looks for them separately. Both are drawn to the width of the wider so
  // the pair reads as a stack rather than as two ragged labels.
  doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  const boxes = [model.patBox, model.insBox].filter(Boolean);
  const bw = Math.max(...boxes.map((t) => doc.getTextWidth(t))) + 14;
  doc.setDrawColor(...INK); doc.setLineWidth(0.8);
  doc.setTextColor(...INK);
  boxes.forEach((text, i) => {
    const y = 24 + i * 22;
    doc.rect(M + W - bw, y, bw, 18);
    doc.text(text, M + W - bw / 2, y + 12, { align: "center" });
  });

  // Title, centred and underlined.
  doc.setFontSize(13); doc.setTextColor(...NAVY);
  doc.text(model.title, cx, 78, { align: "center" });
  const tw = doc.getTextWidth(model.title);
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.7);
  doc.line(cx - tw / 2, 81, cx + tw / 2, 81);
}

// Fallback when no logo asset is present: the wordmark set in type.
function drawWordmark(doc, cx) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  const a = "US", b = "24", c = " SOLUTIONS";
  const total = doc.getTextWidth(a + b + c);
  let x = cx - total / 2;
  doc.setTextColor(...NAVY); doc.text(a, x, 42); x += doc.getTextWidth(a);
  doc.setTextColor(...ORANGE); doc.text(b, x, 42); x += doc.getTextWidth(b);
  doc.setTextColor(...NAVY); doc.text(c, x, 42);
  doc.setFont("helvetica", "bolditalic"); doc.setFontSize(7.5); doc.setTextColor(...INK);
  doc.text("Innovative Technology Driven", cx, 54, { align: "center" });
  doc.setDrawColor(...ORANGE); doc.setLineWidth(0.7);
  doc.line(cx - total / 2, 57, cx + total / 2, 57);
}

// Does this record fit, and by how much?
//
// Exported because the thing that guarded it did not work. The old test asserted
// `getNumberOfPages() === 1`, which is true of every document this file has ever
// produced — nothing here calls addPage(). Content that does not fit is simply
// drawn past the bottom edge and disappears. Three rounds of new rows went in
// under a green test that could not fail.
export function measurePDF(v, meta = {}) {
  const model = buildVobDoc(v, meta);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const PH = doc.internal.pageSize.getHeight();
  const W = doc.internal.pageSize.getWidth() - M * 2;
  const avail = PH - HEAD_H - FOOT_H - M;
  const heights = SCALES.map((s) => bodyHeight(doc, model, W, s));
  const i = heights.findIndex((h) => h <= avail);
  const used = i === -1 ? SCALES.length - 1 : i;
  return {
    avail, heights, scale: used, fits: i !== -1,
    height: heights[used],
    overflow: Math.max(0, heights[used] - avail),
    rows: model.rows.length,
  };
}

// Builds the document without saving it — the testable half.
export function buildPDF(v, meta = {}) {
  const model = buildVobDoc(v, meta);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const W = PW - M * 2;
  const avail = PH - HEAD_H - FOOT_H - M;

  const S = SCALES.find((s) => bodyHeight(doc, model, W, s) <= avail) || SCALES[SCALES.length - 1];

  drawHeader(doc, model, W);

  let y = HEAD_H;
  doc.setLineWidth(0.5);
  model.rows.forEach((row, i) => {
    const h = rowHeight(doc, row, W, S);
    const span = row.cells.length === 1;

    if (i % 2 === 0) {
      doc.setFillColor(...SHADE);
      doc.rect(M, y, W, h, "F");
    }
    doc.setDrawColor(...LINE);
    doc.rect(M, y, W, h);
    if (!span) doc.line(M + W / 2, y, M + W / 2, y + h);

    const cw = span ? W - S.pad * 2 : W / 2 - S.pad * 2;
    row.cells.forEach((cell, j) => {
      let cy = y + S.pad + S.font;
      const cx = M + (j === 0 ? S.pad : W / 2 + S.pad);
      for (const line of cell.lines) cy += richLine(doc, cx, cy, cw, line, S, false);
    });
    y += h;
  });

  // Footnote for values marked as carrier/portal sourced.
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  let fy = y + 10;
  for (const n of model.footnotes) { doc.text(n, M, fy); fy += 8; }

  doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
  doc.line(M, PH - 30, M + W, PH - 30);
  doc.setFontSize(7);
  doc.text(model.footer, M, PH - 20);

  return doc;
}

// Returns the generated filename (stored on the saved record as _file).
export function makePDF(v, meta = {}) {
  const doc = buildPDF(v, meta);
  const fn = vobName(v) + ".pdf";
  doc.save(fn);
  return fn;
}
