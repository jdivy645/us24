import { useEffect, useRef, useState } from "react";

const SR = 16000;

// Decode any container the browser can read down to mono 16 kHz, which is what
// Whisper expects. Web Audio is unavailable inside a worker, so this must run here.
async function decode(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC || !OAC) throw new Error("This browser can't decode audio.");
  const ctx = new AC();
  let buf;
  try {
    buf = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("This browser can't read that audio format — convert it to MP3 or WAV, or paste the transcript instead.");
  } finally {
    ctx.close();
  }
  // Resample explicitly rather than trusting a decode-time hint: feeding Whisper
  // 44.1 kHz samples as if they were 16 kHz stretches the speech and the model
  // returns repetitive nonsense. OfflineAudioContext also downmixes to mono.
  const frames = Math.max(1, Math.ceil(buf.duration * SR));
  const off = new OAC(1, frames, SR);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0).slice();
}

// Converts an uploaded recording to text with Whisper running locally in a
// worker. No microphone, no playback, no upload.
export default function useTranscriber() {
  const [status, setStatus] = useState("idle"); // idle|decoding|loading|running|done|error
  const [pct, setPct] = useState(0);
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [device, setDevice] = useState("");
  const [error, setError] = useState("");

  const workerRef = useRef(null);
  const busyRef = useRef(false);
  const doneRef = useRef(null);
  const textRef = useRef("");

  const getWorker = () => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("../workers/whisper.worker.js", import.meta.url), { type: "module" });
    }
    return workerRef.current;
  };

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; }, []);

  const transcribe = async (file, onFinished) => {
    if (busyRef.current || !file) return;
    busyRef.current = true;
    doneRef.current = onFinished;
    textRef.current = "";
    setError(""); setText(""); setPct(0); setSeconds(0); setStatus("decoding");

    let audio;
    try {
      audio = await decode(file);
    } catch (e) {
      busyRef.current = false;
      setStatus("error"); setError(e.message);
      return;
    }
    setDuration(audio.length / SR);
    setStatus("loading");

    const worker = getWorker();
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "device") { setDevice(m.device); return; }
      if (m.type === "loading") { setStatus("loading"); setPct(m.pct); return; }
      if (m.type === "ready") { setStatus("running"); setPct(0); return; }
      if (m.type === "partial") {
        textRef.current = m.text;
        setText(m.text); setSeconds(m.seconds);
        setPct(Math.round((m.done / m.total) * 100));
        setStatus("running");
        return;
      }
      if (m.type === "done" || m.type === "cancelled") {
        busyRef.current = false;
        textRef.current = m.text;
        setText(m.text); setPct(100); setStatus("done");
        doneRef.current?.(m.text, m.type === "cancelled");
        doneRef.current = null;
        return;
      }
      if (m.type === "error") {
        busyRef.current = false;
        setStatus("error"); setError(m.message);
        doneRef.current = null;
      }
    };
    worker.onerror = (e) => {
      busyRef.current = false;
      setStatus("error");
      setError(e.message || "The speech model failed to start.");
    };
    worker.postMessage({ type: "transcribe", audio }, [audio.buffer]);
  };

  const cancel = () => { if (busyRef.current) workerRef.current?.postMessage({ type: "cancel" }); };

  const reset = () => {
    busyRef.current = false;
    doneRef.current = null;
    textRef.current = "";
    setStatus("idle"); setPct(0); setText(""); setSeconds(0); setDuration(0); setError("");
  };

  return {
    status, pct, text, seconds, duration, device, error,
    active: status === "decoding" || status === "loading" || status === "running",
    supported: typeof Worker !== "undefined",
    finalText: text,
    transcribe, cancel, reset,
    result: () => (textRef.current ? { transcript: textRef.current } : null),
  };
}
