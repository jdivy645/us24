// Shared artifact naming so PDF, audio and transcript files stay in lockstep.
export const vobName = (v) =>
  `VOB_${(v.lastName || "PATIENT").toUpperCase().replace(/\W+/g, "")}_${(v.insName || "PAYER").toUpperCase().replace(/\W+/g, "")}_${(v.today || new Date().toISOString().slice(0, 10)).replace(/-/g, "_")}`;

export const extFromMime = (m) => (m && m.includes("mp4") ? "m4a" : "webm");

export const downloadBlob = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

export const downloadText = (text, name) =>
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), name);
