import test from "node:test";
import assert from "node:assert/strict";
import { checkCompleteness, requiredFor, MANDATORY_FIELDS, MODE_EXEMPT } from "./completeness.js";
import { setBypass } from "./bypass.js";
import { recordFlags, turnaroundDays } from "./flags.js";
import { classOf } from "./schema.js";
import { NEVER_EXTRACT } from "./extract.js";
import { VERIFY_FIELDS } from "./verify.js";
import { buildVobDoc } from "./vobTemplate.js";
import { sampleForm } from "../data/fields.js";
import { vobName } from "./files.js";

const keysOf = (v, cfg) => requiredFor(v, cfg).map((f) => f.key);

/* ---------------- what the client named as required ---------------- */

test("every field named as required on the call is required", () => {
  const required = new Set(MANDATORY_FIELDS.map((f) => f.key));
  // From the 10 Aug call: authorization, insurance name, PCP, plan type, plan name,
  // initial treatment, project, request date, and who entered it.
  for (const k of ["authEval", "authTx", "insName", "pcpRef", "planType", "planName",
    "initialTx", "projectName", "requestDate", "username", "requestMode"]) {
    assert.ok(required.has(k), `${k} was named as required on the call but is not`);
  }
});

test("a required field is satisfied by Not Applicable, with the reason on the record", () => {
  // The escape hatch the client asked for at 4:15. It is not a way of skipping the
  // question — the reason and the author are stored with it.
  const v = { ...sampleForm(), planName: "" };
  assert.ok(checkCompleteness(v, {}).blank.some((f) => f.key === "planName"));

  const meta = setBypass({}, "planName", "NOT_APPLICABLE", "payer quotes no plan name", "SP");
  const c = checkCompleteness(v, meta);
  assert.ok(!c.blank.some((f) => f.key === "planName"));
  assert.ok(c.bypassed.includes("planName"));
  assert.equal(meta.planName.bypass.by, "SP");
});

test("PAT is the operator's own box: manual, optional, never read from the call", () => {
  // Added on request as a free-text entry in the summary. Three things have to hold
  // together or it stops being that: nothing may fill it, nothing may grade it, and
  // nobody may be stopped from saving because it is empty.
  assert.ok(!requiredFor({}).some((f) => f.key === "pat"), "PAT must not be required by default");
  assert.ok(NEVER_EXTRACT.has("pat"), "PAT must never be filled from a transcript");
  assert.ok(!VERIFY_FIELDS.some((f) => f.key === "pat"), "PAT must never be checked against the call");
  assert.equal(classOf("pat"), "internal");
  // …but a project that wants it answered can still say so.
  assert.ok(requiredFor({}, { add: ["pat"] }).some((f) => f.key === "pat"));
});

test("what is typed in PAT reaches the document", () => {
  const doc = buildVobDoc({ ...sampleForm(), pat: "ACCT 88213 — split billing" }, {});
  assert.match(JSON.stringify(doc.rows), /ACCT 88213 — split billing/);
});

/* ---------------- per project and per request mode ---------------- */

test("a fax request is not chased for a rep name or a call reference", () => {
  const call = keysOf({ requestMode: "CALL" });
  const fax = keysOf({ requestMode: "FAX" });
  for (const k of MODE_EXEMPT.FAX) {
    assert.ok(call.includes(k), `${k} should be required of a phone call`);
    assert.ok(!fax.includes(k), `${k} cannot come from a fax and must not be required`);
  }
});

test("a project can require a field nobody else does", () => {
  assert.ok(!keysOf({}).includes("insPhone"));
  assert.ok(keysOf({}, { add: ["insPhone"] }).includes("insPhone"));
});

test("a project can drop a standard requirement", () => {
  assert.ok(keysOf({}).includes("groupId"));
  assert.ok(!keysOf({}, { exempt: ["groupId"] }).includes("groupId"));
});

test("a project rule cannot list the same field twice", () => {
  // `add` naming something already standard would double it in the count, and the
  // form would say "2 still to ask" about one empty box.
  const keys = keysOf({}, { add: ["groupId", "policyId"] });
  assert.equal(new Set(keys).size, keys.length);
});

test("exempt wins over add, so a rule can never contradict itself into a loop", () => {
  assert.ok(!keysOf({}, { add: ["insPhone"], exempt: ["insPhone"] }).includes("insPhone"));
});

test("no config behaves exactly as it did before projects existed", () => {
  const v = sampleForm();
  assert.deepEqual(checkCompleteness(v, {}, {}).requiredKeys, checkCompleteness(v, {}).requiredKeys);
});

/* ---------------- asking the rep vs filling it in ourselves ---------------- */

test("the two blank lists are complementary and never overlap", () => {
  const c = checkCompleteness({}, {});
  const ask = new Set(c.stillToAsk.map((f) => f.key));
  const ours = c.blank.filter((f) => !ask.has(f.key));
  assert.equal(ask.size + ours.length, c.blank.length);
  assert.ok(ask.size > 0 && ours.length > 0, "both lists should have something in them on an empty form");
  for (const f of c.stillToAsk) assert.ok(c.blank.some((b) => b.key === f.key), `${f.key} is asked for but not required`);
});

/* ---------------- derived flags ---------------- */

test("authorization required is true if any route to it is", () => {
  assert.equal(recordFlags({ authEval: "YES" }).authRequired, true);
  assert.equal(recordFlags({ authTx: "YES" }).authRequired, true);
  assert.equal(recordFlags({ authNum: "A12345" }).authRequired, true);
  assert.equal(recordFlags({ authEval: "NO", authTx: "NO" }).authRequired, false);
  assert.equal(recordFlags({}).authRequired, false);
});

test("turnaround is null when a date is missing, not zero", () => {
  // Zero would be indistinguishable from a same-day turnaround and would drag the
  // median down for every record nobody filled a request date on.
  assert.equal(turnaroundDays({ requestDate: "2026-08-03", today: "2026-08-10" }), 7);
  assert.equal(turnaroundDays({ requestDate: "", today: "2026-08-10" }), null);
  assert.equal(turnaroundDays({ requestDate: "2026-08-10", today: "2026-08-10" }), 0);
});

/* ---------------- artifact naming ---------------- */

test("the PDF name carries the project, patient, payer, operator and date", () => {
  assert.equal(
    vobName({ projectName: "EC Marvel", lastName: "Yusuff", insName: "Aetna", username: "SP", today: "2026-08-10" }),
    "VOB_ECMARVEL_YUSUFF_AETNA_SP_2026_08_10");
});

test("a record saved before projects existed still gets a sane filename", () => {
  assert.equal(
    vobName({ lastName: "Yusuff", insName: "Aetna", today: "2026-08-10" }),
    "VOB_YUSUFF_AETNA_2026_08_10");
});
