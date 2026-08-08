import * as XLSX from "xlsx";

// The only place SheetJS is touched for reading. Kept thin so importMap.js — where
// all the judgement lives — stays testable without a binary fixture.
//
// Every sheet is read twice on purpose: `raw` gives the underlying values (Excel
// serial dates, numeric IDs) and `formatted` gives what the sheet DISPLAYS. A long
// member ID arrives as 1.0161953570012e+14 in the raw pass and intact in the
// formatted one, and coerceId() needs both to tell which to trust.
export async function readWorkbook(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    sheets[name] = {
      raw: XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "", raw: true }),
      formatted: XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "", raw: false }),
    };
  }
  return { sheetNames: wb.SheetNames, sheets };
}
