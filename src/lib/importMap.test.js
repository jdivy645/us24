import test from "node:test";
import assert from "node:assert/strict";
import {
  detectHeaderRow, mapHeaders, mapOwnExport, coerceId, coerceDate, coercePhone,
  splitName, parseRows, detectKind,
} from "./importMap.js";
import { HEAD } from "../data/fields.js";

/* ------------------------------------------------------------ header row */

test("the header row is found past a title and a blank line", () => {
  const grid = [
    ["Patient roster — August 2026"],
    [],
    ["Patient Last Name", "First", "DOB", "Member ID", "Grp #", "Primary Insurance"],
    ["YUSUFF", "TAJUDEEN", "12/31/1957", "101619535700", "000003-TX", "AETNA"],
  ];
  assert.equal(detectHeaderRow(grid), 2);
});

/* --------------------------------------------------------------- mapping */

test("real-world headers map to field keys", () => {
  const { mapping } = mapHeaders(["Patient Last Name", "First", "DOB", "Member ID", "Grp #", "Primary Insurance"]);
  assert.equal(mapping.lastName, 0);
  assert.equal(mapping.firstName, 1);
  assert.equal(mapping.dob, 2);
  assert.equal(mapping.policyId, 3);
  assert.equal(mapping.groupId, 4);
  assert.equal(mapping.insName, 5);
});

test("a bare ID column does not steal policyId from Member ID", () => {
  const { mapping, unmapped } = mapHeaders(["ID", "Member ID", "Last Name"]);
  assert.equal(mapping.policyId, 1, "the specific column wins");
  assert.deepEqual(unmapped.map((u) => u.index), [0], "the bare column is reported, not silently dropped");
});

test("unmapped columns are always returned so they can be assigned by hand", () => {
  const { unmapped } = mapHeaders(["Last Name", "Referring Provider", "Notes"]);
  assert.deepEqual(unmapped.map((u) => u.header), ["Referring Provider", "Notes"]);
});

test("the app's own Excel export can be read back in", () => {
  const headers = [HEAD.lastName, HEAD.firstName, HEAD.dob, HEAD.policyId, HEAD.insName, HEAD._verdict];
  const mapping = mapOwnExport(headers);
  assert.equal(mapping.lastName, 0);
  assert.equal(mapping.policyId, 3);
  assert.equal(mapping._verdict, undefined, "metadata columns are not form fields");
});

test("a sheet of carrier data is recognised as such", () => {
  assert.equal(detectKind(mapHeaders(["Payer", "Payer ID", "Timely Filing"]).mapping), "carriers");
  assert.equal(detectKind(mapHeaders(["Last Name", "DOB"]).mapping), "patients");
});

/* ------------------------------------------------------------- coercions */

test("a long member ID keeps every digit instead of becoming an exponent", () => {
  // This is the single most common way a spreadsheet import corrupts data.
  assert.equal(coerceId(101619535700, "101619535700"), "101619535700");
  assert.equal(coerceId(1.0161953570012e14, "100161953570012"), "100161953570012");
  assert.equal(coerceId("W-101 619", "W-101 619"), "W-101 619");
});

test("leading zeros survive", () => {
  assert.equal(coerceId("  0012 ", "0012"), "0012");
  assert.equal(coerceId(3, "000003-TX"), "000003-TX");
});

test("dates are normalised from every shape a sheet produces", () => {
  assert.equal(coerceDate(new Date(1957, 11, 31)).value, "1957-12-31");
  assert.equal(coerceDate(21185).value, "1957-12-31", "an Excel serial");
  assert.equal(coerceDate("12/31/1957").value, "1957-12-31");
  assert.equal(coerceDate("31/12/1957").value, "1957-12-31", "day > 12 settles the order");
  assert.equal(coerceDate("1957-12-31").value, "1957-12-31");
});

test("an ambiguous date is read as US and flagged rather than guessed silently", () => {
  const d = coerceDate("05/06/1957");
  assert.equal(d.value, "1957-05-06");
  assert.match(d.issues[0], /ambiguous/);
  assert.deepEqual(coerceDate("12/31/1957").issues, []);
});

test("an unreadable date reports rather than throwing", () => {
  assert.equal(coerceDate("13/13/1957").value, "");
  assert.match(coerceDate("not a date").issues[0], /unreadable/);
});

test("phones are normalised, and left alone when they are not phones", () => {
  assert.equal(coercePhone("(800) 624-0756"), "800-624-0756");
  assert.equal(coercePhone("1-800-624-0756"), "800-624-0756");
  assert.equal(coercePhone("ext 4412"), "ext 4412");
});

test("a single name column splits in either order, flagging the guess", () => {
  assert.deepEqual(splitName("MOUSE, MICKIE"), { lastName: "MOUSE", firstName: "MICKIE", guessed: false });
  assert.deepEqual(splitName("Mickie Mouse"), { lastName: "MOUSE", firstName: "MICKIE", guessed: true });
});

/* ------------------------------------------------------------------ rows */

const HEADERS = ["Last Name", "First Name", "DOB", "Member ID", "Primary Insurance"];
const build = (rows) => {
  const raw = [HEADERS, ...rows];
  return { raw, formatted: raw.map((r) => r.map((c) => String(c ?? ""))), headerRow: 0, mapping: mapHeaders(HEADERS).mapping };
};

test("a clean row imports", () => {
  const rows = parseRows(build([["YUSUFF", "TAJUDEEN", "12/31/1957", "101619535700", "AETNA"]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "import");
  assert.equal(rows[0].values.dob, "1957-12-31");
  assert.equal(rows[0].values.policyId, "101619535700");
});

test("a row with no name and no member ID is skipped, not imported empty", () => {
  const rows = parseRows(build([["", "", "", "", "AETNA"]]));
  assert.equal(rows[0].action, "skip");
});

test("a name with no DOB imports as provisional, with the reason attached", () => {
  const rows = parseRows(build([["SMITH", "JOHN", "", "555", "AETNA"]]));
  assert.equal(rows[0].action, "warn");
  assert.match(rows[0].issues[0].msg, /provisional/);
});

test("a clash with an existing patient is a conflict for the operator to settle", () => {
  const rows = parseRows({ ...build([["YUSUFF", "TAJUDEEN", "12/31/1957", "101619535700", "AETNA"]]),
    existingKeys: new Set(["YUSUFF|TAJUDEEN|1957-12-31"]) });
  assert.equal(rows[0].action, "conflict");
});

test("an all-blank row is dropped rather than reported as an error", () => {
  const rows = parseRows(build([["", "", "", "", ""], ["MOUSE", "MICKIE", "01/01/1990", "12345678", "UHC"]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.lastName, "MOUSE");
});

test("a duplicate inside one sheet is flagged", () => {
  const rows = parseRows(build([
    ["MOUSE", "MICKIE", "01/01/1990", "1", "UHC"],
    ["MOUSE", "MICKIE", "01/01/1990", "1", "UHC"],
  ]));
  assert.ok(rows[1].issues.some((i) => /duplicate/.test(i.msg)));
});
