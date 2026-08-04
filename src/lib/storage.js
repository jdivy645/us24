// Same localStorage key as the original single-file app, so records saved
// there show up in the React version too.
const KEY = "us24_vob_records";

export const load = () => JSON.parse(localStorage.getItem(KEY) || "[]");
export const store = (r) => localStorage.setItem(KEY, JSON.stringify(r));
