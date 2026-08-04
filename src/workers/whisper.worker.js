// Whisper runs here, off the main thread — a long recording would otherwise
// freeze the UI. The model reads the decoded audio directly; nothing is played
// and nothing leaves the machine.
import { pipeline } from "@huggingface/transformers";
import { stitch } from "../lib/stitch.js";

const MODEL = "onnx-community/whisper-base.en";
const SR = 16000;
const WINDOW = 28 * SR;   // whisper's receptive field is 30s
const OVERLAP = 2 * SR;   // so a word split by a boundary is seen whole once

let asr = null;
let cancelled = false;

const post = (m) => self.postMessage(m);

async function getModel() {
  if (asr) return asr;
  const device = self.navigator?.gpu ? "webgpu" : "wasm";
  post({ type: "device", device });
  // The encoder must stay full precision — a quantised encoder mangles the
  // acoustics ("coinsurance" -> "cold insurance") and sends the decoder into
  // repetition loops. This is the combination HF's own Whisper WebGPU demo ships.
  const dtype = device === "webgpu"
    ? { encoder_model: "fp32", decoder_model_merged: "q4" }
    : "q8";
  const seen = {};
  asr = await pipeline("automatic-speech-recognition", MODEL, {
    device, dtype,
    progress_callback: (p) => {
      if (!p || !p.file) return;
      if (p.status === "progress" || p.status === "download") {
        seen[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        let loaded = 0, total = 0;
        for (const f of Object.values(seen)) { loaded += f.loaded; total += f.total; }
        if (total) post({ type: "loading", pct: Math.min(99, Math.round((loaded / total) * 100)) });
      }
    },
  });
  post({ type: "ready" });
  return asr;
}

const rms = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 16) s += a[i] * a[i]; // sampled — this is a gate, not a measurement
  return Math.sqrt(s / Math.ceil(a.length / 16));
};

// A quietly recorded call must not be mistaken for silence, so the gate follows
// the recording's own level instead of a fixed number.
const silenceGate = (audio) => Math.max(0.0005, rms(audio) * 0.06);

async function run(audio) {
  const model = await getModel();
  const step = WINDOW - OVERLAP;
  const total = Math.max(1, Math.ceil(Math.max(0, audio.length - OVERLAP) / step));
  const gate = silenceGate(audio);
  let text = "";
  for (let i = 0, w = 0; i < audio.length; i += step, w++) {
    if (cancelled) { post({ type: "cancelled", text: text.trim() }); return; }
    const chunk = audio.subarray(i, Math.min(i + WINDOW, audio.length));
    if (chunk.length < SR * 0.4) break; // trailing sliver, nothing to hear
    if (rms(chunk) > gate) {
      // no language/task options: whisper-base.en is English-only and rejects them
      const out = await model(chunk);
      const piece = (out?.text || "").trim();
      if (piece) text = stitch(text, piece);
    }
    post({ type: "partial", text: text.trim(), done: Math.min(w + 1, total), total, seconds: Math.min((i + WINDOW) / SR, audio.length / SR) });
  }
  post({ type: "done", text: text.trim() });
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "cancel") { cancelled = true; return; }
  if (msg.type !== "transcribe") return;
  cancelled = false;
  try {
    await run(msg.audio);
  } catch (err) {
    post({ type: "error", message: String(err?.message || err) });
  }
};
