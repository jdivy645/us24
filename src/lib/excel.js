import * as XLSX from "xlsx";
import { buildSheets } from "./excelSheets.js";

// Thin shell: buildSheets() holds the logic and is tested on its own, since
// XLSX.writeFile needs a browser.
export function exportExcel(records) {
  const wb = XLSX.utils.book_new();
  for (const s of buildSheets(records)) {
    const ws = XLSX.utils.json_to_sheet(s.rows, { header: s.header });
    ws["!cols"] = s.widths.map((wch) => ({ wch }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, `US24_VOB_Log_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
