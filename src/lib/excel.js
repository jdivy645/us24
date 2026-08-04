import * as XLSX from "xlsx";
import { HEAD } from "../data/fields.js";

export function exportExcel(records) {
  const keys = Object.keys(HEAD);
  const rows = records.map((v) => {
    const o = {};
    keys.forEach((k) => {
      const x = v[k];
      const s = Array.isArray(x) ? x.join(", ") : x == null ? "" : x;
      // Excel rejects anything past 32,767 characters in one cell
      o[HEAD[k]] = typeof s === "string" && s.length > 32000 ? s.slice(0, 32000) + "… [truncated]" : s;
    });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(rows, { header: keys.map((k) => HEAD[k]) });
  ws["!cols"] = keys.map((k) => ({ wch: k === "_transcript" ? 60 : k === "_blank" || k === "_mismatch" ? 40 : Math.max(HEAD[k].length + 2, 14) }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "VOB Log");
  XLSX.writeFile(wb, `US24_VOB_Log_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
