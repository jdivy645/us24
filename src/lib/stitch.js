// Transcription windows overlap by a couple of seconds so no word is cut in half.
// That means the start of each new window repeats the end of the previous one —
// drop the longest such repeat rather than duplicating words in the transcript.
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

export function stitch(prev, next, look = 12) {
  const b = words(next);
  if (!b.length) return prev;
  if (!prev.trim()) return b.join(" ");
  const a = words(prev).slice(-look).map(norm);
  const bn = b.map(norm);
  const max = Math.min(a.length, bn.length);
  for (let n = max; n >= 2; n--) {
    let ok = true;
    for (let k = 0; k < n; k++) if (a[a.length - n + k] !== bn[k]) { ok = false; break; }
    if (ok) return (prev.trim() + " " + b.slice(n).join(" ")).trim();
  }
  return prev.trim() + " " + b.join(" ");
}
