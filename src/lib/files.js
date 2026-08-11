// Shared artifact naming so PDF, audio and transcript files stay in lockstep.
//
// The client asked for the project and the operator's name in the filename, with
// today's date, underscore-separated. Patient and payer stay in it: a folder of
// PDFs is searched by patient far more often than by anything else, and dropping
// them to make room would trade the common case for the new one.
//
// Parts that are missing are left out rather than filled with a placeholder, so a
// record saved before projects existed still produces a sane name.
const part = (s) => String(s || "").toUpperCase().replace(/\W+/g, "");

export const vobName = (v) =>
  ["VOB",
    part(v.projectName),
    part(v.lastName) || "PATIENT",
    part(v.insName) || "PAYER",
    part(v.username || v.verifiedBy),
    (v.today || new Date().toISOString().slice(0, 10)).replace(/-/g, "_"),
  ].filter(Boolean).join("_");

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
