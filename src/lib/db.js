// The only thing components talk to about stored data.
//
// Everything is async and takes/returns plain JSON — no IDBRequest crosses this
// boundary. That is deliberate: when this team outgrows one browser, replacing
// these bodies with fetch("/api/…") is a file swap, not a refactor.
import * as idb from "./idb.js";
import { load as loadLegacy, store as storeLegacy } from "./storage.js";
import { patientKey, carrierKey, policyKey, serviceKey, caseKey, norm, isProvisional, looksSameName, findSimilarCases } from "./identity.js";
import { CARRIER_FIELDS } from "./schema.js";
import { changedKeys } from "./history.js";
import { migrateLegacy, toLegacyRow } from "./migrate.js";
import { buildPrefillForm, referenceFrom, carrierLearnings } from "./prefill.js";
import { newWorkflow, applyTransition, refusal, topPriority, errorCount, unresolved, recordScore, OPEN_STATUSES } from "./workflow.js";
import { recordFlags, needsAuthWork } from "./flags.js";
import { F } from "../data/fields.js";

const nowISO = () => new Date().toISOString();
const newId = (p) => `${p}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
const val = (o, k) => String((o || {})[k] ?? "").trim();

// How many rows the legacy localStorage mirror keeps. Enough for the old
// standalone HTML to stay useful, small enough that quota is never in play.
const MIRROR_ROWS = 60;

/* ---------------------------------------------------------------- lifecycle */

let _ready = null;
export function ready() {
  if (!_ready) _ready = (async () => {
    await idb.openDb();
    const done = await idb.getMeta("legacyMigratedAt");
    const out = done ? { migrated: false } : await runMigration();
    // Runs after the legacy migration so records that have only just arrived from
    // localStorage are backfilled in the same pass.
    return { ...out, backfilled: await backfillWorkflow() };
  })().catch((e) => { _ready = null; throw e; });
  return _ready;
}

// v2 → v3. Every record that predates the work-management layer gets a project, an
// operator and a status. They are stamped `finished` on purpose: a year of history
// arriving in the QA queue on the morning of the upgrade would bury the day's work.
//
// Idempotent and guarded by a meta key, the same shape as legacyMigratedAt.
async function backfillWorkflow() {
  if (await idb.getMeta("workflowBackfilledAt")) return false;

  const versions = await idb.getAll("versions");
  const projects = await idb.getAll("projects");
  let unassigned = projects.find((p) => p.key === norm(UNASSIGNED));
  if (!unassigned) unassigned = blankProject({ name: UNASSIGNED });

  const patched = versions
    .filter((v) => !v.workflow)
    .map((v) => ({
      ...v,
      form: { ...v.form, projectName: v.form?.projectName || UNASSIGNED, username: v.form?.username || v.form?.verifiedBy || "" },
      workflow: {
        ...newWorkflow({ status: "finished", username: v.form?.verifiedBy || "", at: v.savedAt || nowISO() }),
        finishedAt: v.savedAt || nowISO(),
      },
      flags: v.flags || recordFlags(v.form || {}),
    }));

  await idb.tx(["projects", "versions"], "readwrite", (s) => {
    s.projects.put(unassigned);
    for (const v of patched) s.versions.put(v);
  });
  await idb.setMeta("workflowBackfilledAt", nowISO());
  await idb.setMeta("schemaVersion", 3);
  return patched.length;
}

async function runMigration() {
  const rows = loadLegacy();
  if (!rows.length) {
    await idb.setMeta("legacyMigratedAt", nowISO());
    return { migrated: false };
  }
  // Keep the original bytes before touching anything. It lives in IndexedDB, so it
  // costs no localStorage quota, and it is the only copy of data that cannot be
  // regenerated from anywhere else.
  await idb.setMeta("legacyBackupV1", JSON.stringify(rows));

  const out = migrateLegacy(rows, { now: nowISO() });
  await idb.tx(["patients", "carriers", "cases", "versions", "transcripts"], "readwrite", (s) => {
    for (const p of out.patients) s.patients.put(p);
    for (const c of out.carriers) s.carriers.put(c);
    for (const k of out.cases) s.cases.put(k);
    for (const v of out.versions) s.versions.put(v);
    for (const t of out.transcripts) s.transcripts.put(t);
  });
  await idb.setMeta("legacyMigratedAt", nowISO());
  await idb.setMeta("schemaVersion", 2);
  await refreshMirror();
  idb.requestPersistence();
  return { migrated: true, counts: { patients: out.patients.length, carriers: out.carriers.length, cases: out.cases.length, versions: out.versions.length } };
}

export async function stats() {
  const [patients, carriers, cases, versions, projects, users, errs] = await Promise.all(
    ["patients", "carriers", "cases", "versions", "projects", "users", "errors"].map((s) => idb.getAll(s)));
  return {
    patients: patients.length, carriers: carriers.length,
    cases: cases.length, versions: versions.length,
    projects: projects.filter((p) => !p.archived).length, users: users.filter((u) => u.active).length,
    errors: errs.filter((e) => e.priority !== "NONE").length,
    quota: await idb.storageEstimate(),
  };
}

/* ----------------------------------------------------------------- projects */

// Where records that predate projects land, and where a record with no project
// chosen would land. Named rather than blank so it is visible in a filter.
export const UNASSIGNED = "UNASSIGNED";

// IndexedDB keys cannot be booleans, so the index is on a "0"/"1" string. `archived`
// stays a real boolean for everything that reads the record.
const blankProject = (patch = {}) => ({
  id: newId("prj"), name: "", category: "",
  // Per request mode, because a fax request and a phone call cannot produce the
  // same evidence. `add` names extra required fields, `exempt` drops standard ones.
  required: { CALL: { add: [], exempt: [] }, FAX: { add: [], exempt: [] }, WEBSITE: { add: [], exempt: [] } },
  archived: false, createdAt: nowISO(), updatedAt: nowISO(),
  ...patch,
  key: norm(patch.name || ""),
  archivedFlag: patch.archived ? "1" : "0",
});

export const listProjects = () => idb.getAll("projects");

export async function upsertProject(patch) {
  const existing = patch.id ? await idb.get("projects", patch.id) : null;
  if (!existing && !String(patch.name || "").trim()) throw new Error("A project needs a name");

  const all = await idb.getAll("projects");
  const key = norm(patch.name ?? existing?.name);
  // The unique index would abort the transaction with a ConstraintError, which
  // surfaces as an unreadable DOMException. Catch it here where the name is known.
  const clash = all.find((p) => p.key === key && p.id !== (patch.id || ""));
  if (clash) throw new Error(`A project called "${clash.name}" already exists`);

  const rec = blankProject({ ...existing, ...patch, name: patch.name ?? existing?.name, updatedAt: nowISO() });
  if (existing) rec.id = existing.id;
  await idb.put("projects", rec);
  return rec;
}

export const archiveProject = (id, archived = true) =>
  idb.get("projects", id).then((p) => (p ? upsertProject({ ...p, archived }) : null));

// The required-field rule in force for a record. Returns { add, exempt } — the
// shape checkCompleteness() takes — so the caller never has to know it came from a
// project record rather than from a default.
export async function projectRequirements(projectName, requestMode = "CALL") {
  const key = norm(projectName);
  if (!key) return { add: [], exempt: [] };
  const project = (await idb.getAll("projects")).find((p) => p.key === key);
  const rule = project?.required?.[String(requestMode || "CALL").toUpperCase()];
  return { add: rule?.add || [], exempt: rule?.exempt || [] };
}

/* -------------------------------------------------------------------- users */

// Attribution and queue routing, not security. Nobody signs in; the point is that a
// record says who entered it and who checked it, and that the QA queue can be told
// apart from the entry queue.
const blankUser = (patch = {}) => ({
  id: newId("usr"), name: "", role: "agent", active: true,
  createdAt: nowISO(), updatedAt: nowISO(),
  ...patch,
  key: norm(patch.name || ""),
});

export const listUsers = () => idb.getAll("users");

export async function upsertUser(patch) {
  const existing = patch.id ? await idb.get("users", patch.id) : null;
  if (!existing && !String(patch.name || "").trim()) throw new Error("A user needs a name");
  const all = await idb.getAll("users");
  const key = norm(patch.name ?? existing?.name);
  const clash = all.find((u) => u.key === key && u.id !== (patch.id || ""));
  if (clash) throw new Error(`A user called "${clash.name}" already exists`);

  const rec = blankUser({ ...existing, ...patch, name: patch.name ?? existing?.name, updatedAt: nowISO() });
  if (existing) rec.id = existing.id;
  await idb.put("users", rec);
  return rec;
}

export async function currentUser() {
  const id = await idb.getMeta("currentUserId");
  if (!id) return null;
  return (await idb.get("users", id)) || null;
}

export const setCurrentUser = (id) => idb.setMeta("currentUserId", id || "");

/* ----------------------------------------------------------------- patients */

export async function findPatient({ lastName, firstName, dob }) {
  const all = await idb.getAll("patients");
  const key = patientKey({ lastName, firstName, dob });
  const exact = all.find((p) => p.key === key) || null;
  // Same surname and DOB with a shortened first name is one person recorded twice.
  // Offered as a candidate, never merged silently.
  const candidates = exact ? [] : all.filter((p) =>
    norm(p.lastName) === norm(lastName) &&
    (dob ? p.dob === dob : false) &&
    looksSameName(p.firstName, firstName));
  return { exact, candidates };
}

export const getPatient = (id) => idb.get("patients", id);
export const listPatients = () => idb.getAll("patients");

/* ----------------------------------------------------------------- carriers */

export async function findCarrier({ insName, payerId }) {
  const all = await idb.getAll("carriers");
  const key = carrierKey(insName);
  const byName = all.find((c) => c.key === key || (c.aliases || []).includes(key));
  if (byName) return byName;
  // Payer ID is the strong key and the name is the weak one, which is what makes
  // "AETNA" and "AETNA BETTER HEALTH OF TX" converge without a lookup table.
  const pid = norm(payerId);
  return (pid && all.find((c) => norm(c.payerId) === pid)) || null;
}

export const listCarriers = () => idb.getAll("carriers");
export const getCarrier = (id) => idb.get("carriers", id);

export async function upsertCarrier(patch) {
  const existing = patch.id ? await idb.get("carriers", patch.id) : null;
  const rec = {
    id: patch.id || newId("car"), aliases: [], fieldsUpdatedAt: {}, confirmCount: {},
    createdAt: nowISO(), ...existing, ...patch, updatedAt: nowISO(),
  };
  rec.key = carrierKey(rec.name);
  await idb.put("carriers", rec);
  return rec;
}

/* -------------------------------------------------------------------- cases */

export async function findCase({ patientId, carrierId, policyId, serviceType }) {
  const all = await idb.getAll("cases");
  const key = caseKey(patientId, carrierId, policyId, serviceType);
  const match = all.find((c) => c.caseKey === key) || null;
  const candidates = match ? [] : findSimilarCases(all, { patientId, carrierId, policyId, serviceType });
  return { match, candidates };
}

export const getCase = (id) => idb.get("cases", id);
export const listCases = () => idb.getAll("cases");

export async function getCaseHistory(caseId) {
  const versions = await idb.byIndex("versions", "by_case", caseId);
  return versions.sort((a, b) => a.seq - b.seq);
}

/* ------------------------------------------------------------------ prefill */

// Everything known about this patient and payer before the call starts.
//
// Prefill reaches wider than history does: the case key includes the discipline so
// PT and OT keep clean separate histories, but starting an OT verification for a
// patient who had PT last month should still fill in the plan-level facts.
export async function buildPrefill({ lastName, firstName, dob, insName, policyId, serviceType }) {
  const { exact: patient, candidates } = await findPatient({ lastName, firstName, dob });
  const carrier = insName ? await findCarrier({ insName }) : null;
  if (!patient) return { form: {}, prov: {}, reference: null, patient: null, carrier, matchedCase: null, candidates };

  const all = await idb.getAll("cases");
  const mine = all.filter((c) => c.patientId === patient.id && !c.archived);
  const pk = policyKey(policyId);
  const sk = serviceKey(serviceType);

  const sameService = mine.find((c) => c.policyKey === pk && c.serviceKey === sk);
  const samePolicy = mine.find((c) => c.policyKey === pk);
  const matchedCase = sameService || samePolicy || mine[0] || null;

  const priorVersion = matchedCase?.latestVersionId ? await idb.get("versions", matchedCase.latestVersionId) : null;
  const { form, prov } = buildPrefillForm({ patient, carrier, priorVersion, matchedCase });
  return {
    form, prov, reference: referenceFrom(priorVersion),
    patient, carrier, matchedCase, priorVersion, candidates,
    isSameCase: !!sameService,
  };
}

/* --------------------------------------------------------------- the writer */

// The only place anything is written. One transaction across every store, so a
// half-saved record is not a state this app can reach.
//
// `resolve` answers the question saveVerification asks when it is not sure two
// records are the same case. Without it, an ambiguous save returns
// { status: "needs-decision" } and writes nothing.
export async function saveVerification({ form, transcript, verify, completeness, meta, file, source, resolve, status = "submitted" }) {
  // Everything that is not an IDB call happens up here. Awaiting anything once the
  // transaction is open would let it auto-commit underneath us.
  const patients = await idb.getAll("patients");
  const carriers = await idb.getAll("carriers");
  const cases = await idb.getAll("cases");

  const pk = patientKey(form);
  let patient = patients.find((p) => p.key === pk);
  if (!patient) {
    patient = {
      id: newId("pat"), key: pk,
      lastName: val(form, "lastName"), firstName: val(form, "firstName"), dob: val(form, "dob"),
      lastNameNorm: norm(form.lastName), provisional: isProvisional(form),
      createdAt: nowISO(), updatedAt: nowISO(), source: "manual",
    };
  }

  const ck = carrierKey(form.insName) || "UNKNOWN";
  let carrier = carriers.find((c) => c.key === ck || (c.aliases || []).includes(ck));
  if (!carrier && val(form, "payerId")) {
    const byPid = carriers.find((c) => norm(c.payerId) === norm(form.payerId));
    if (byPid) { carrier = { ...byPid, aliases: [...new Set([...(byPid.aliases || []), ck])] }; }
  }
  if (!carrier) {
    carrier = {
      id: newId("car"), key: ck, name: val(form, "insName") || "UNKNOWN",
      aliases: [], fieldsUpdatedAt: {}, confirmCount: {}, createdAt: nowISO(), updatedAt: nowISO(), source: "manual",
    };
  }

  const key = caseKey(patient.id, carrier.id, form.policyId, form.serviceType);
  let kase = cases.find((c) => c.caseKey === key);

  if (!kase && !resolve) {
    // A one-digit slip in a member ID would otherwise split a patient's deductible
    // history in two, silently. Ask; never guess.
    const similar = findSimilarCases(cases, {
      patientId: patient.id, carrierId: carrier.id, policyId: form.policyId, serviceType: form.serviceType,
    }).filter((s) => s.reason === "policy-typo");
    if (similar.length) return { status: "needs-decision", reason: "policy-typo", candidates: similar };
  }
  if (resolve?.action === "same-case") kase = cases.find((c) => c.id === resolve.caseId) || kase;

  const isNewCase = !kase;
  if (isNewCase) {
    kase = {
      id: newId("case"), caseKey: key, patientId: patient.id, carrierId: carrier.id,
      policyId: val(form, "policyId"), policyKey: policyKey(form.policyId),
      groupId: val(form, "groupId"), planType: val(form, "planType"), planName: val(form, "planName"),
      projectName: val(form, "projectName"), category: val(form, "category"),
      serviceType: val(form, "serviceType") || "PT", serviceKey: serviceKey(form.serviceType),
      versionCount: 0, latest: null, latestVersionId: null,
      firstVerifiedAt: "", lastVerifiedAt: "", policyHistory: [],
      archived: false, createdAt: nowISO(), updatedAt: nowISO(),
    };
  } else if (resolve?.action === "same-case" && policyKey(form.policyId) !== kase.policyKey) {
    kase = {
      ...kase,
      policyHistory: [...(kase.policyHistory || []), { from: kase.policyId, to: val(form, "policyId"), at: nowISO() }],
      policyId: val(form, "policyId"), policyKey: policyKey(form.policyId),
      caseKey: caseKey(patient.id, carrier.id, form.policyId, form.serviceType),
    };
  }

  const prior = kase.latestVersionId ? await idb.get("versions", kase.latestVersionId) : null;
  const snapshot = Object.fromEntries(F.map((k) => [k, val(form, k)]));
  const changed = prior ? changedKeys(prior.form, snapshot) : [];

  const versionId = newId("ver");
  const version = {
    id: versionId, caseId: kase.id, seq: (kase.versionCount || 0) + 1,
    verifiedOn: val(form, "today") || nowISO().slice(0, 10),
    savedAt: nowISO(), savedAtLabel: new Date().toLocaleString(),
    form: snapshot, changed, provenance: meta || {},
    verify: verify || {}, completeness: completeness || {},
    file: file || "", source: source || "",
    hasTranscript: !!(transcript || "").trim(),
    // Who did the work and where it is in the QA cycle. Kept beside the snapshot
    // rather than inside it: the snapshot is what was checked against the call and
    // must not move once it is written, and QA happens afterwards.
    //
    // A record being sent on is routed by the same question as every later
    // transition: if the payer said an authorization is required and nobody has one
    // yet, the next stop is the authorization queue, not QA. A draft is not sent
    // anywhere, so it is not routed.
    workflow: newWorkflow({
      status: status === "draft" ? "draft"
        : needsAuthWork(snapshot, meta || {}) ? "auth_pending" : "submitted",
      username: val(form, "username") || val(form, "verifiedBy"),
    }),
    // Counted by the dashboard. Derived rather than typed, so the count and the
    // answer it came from cannot drift apart.
    flags: recordFlags(snapshot),
  };

  // Only from values the operator typed AND the rep confirmed. Learning from a
  // prefilled value would let a wrong carrier record re-confirm itself forever.
  const learned = carrierLearnings(form, meta, verify);
  const nextCarrier = { ...carrier, updatedAt: nowISO(), fieldsUpdatedAt: { ...carrier.fieldsUpdatedAt }, confirmCount: { ...carrier.confirmCount } };
  for (const [k, value] of Object.entries(learned)) {
    nextCarrier[k] = value;
    nextCarrier.fieldsUpdatedAt[k] = nowISO();
    nextCarrier.confirmCount[k] = (nextCarrier.confirmCount[k] || 0) + 1;
  }

  const nextCase = {
    ...kase,
    versionCount: version.seq, latest: snapshot, latestVersionId: versionId,
    lastVerifiedAt: version.verifiedOn,
    firstVerifiedAt: kase.firstVerifiedAt || version.verifiedOn,
    groupId: val(form, "groupId") || kase.groupId,
    planType: val(form, "planType") || kase.planType,
    planName: val(form, "planName") || kase.planName || "",
    // Held on the case as well as on each version so a project filter over cases
    // does not have to open every version to answer.
    projectName: val(form, "projectName") || kase.projectName || "",
    category: val(form, "category") || kase.category || "",
    updatedAt: nowISO(),
  };

  await idb.tx(["patients", "carriers", "cases", "versions", "transcripts"], "readwrite", (s) => {
    s.patients.put({ ...patient, updatedAt: nowISO() });
    s.carriers.put(nextCarrier);
    s.cases.put(nextCase);
    s.versions.put(version);
    if (version.hasTranscript) s.transcripts.put({ id: versionId, text: transcript });
  });

  await refreshMirror();
  idb.requestPersistence();
  return {
    status: "saved", caseId: nextCase.id, versionId, seq: version.seq, changed, isNewCase,
    // Where it landed, so the caller can say so rather than guess.
    workflow: version.workflow,
    learned: Object.keys(learned),
  };
}

/* --------------------------------------------------------------- QA and log */

// The one place a record's status changes. Validation lives in workflow.js so the
// rules can be tested without a database; this applies what it decides.
//
// `role` is passed in rather than read here because the caller already holds the
// current user, and a second read would let the two disagree mid-action.
export async function setStatus(versionId, action, { by = "", role = "agent", note = "" } = {}) {
  const version = await idb.get("versions", versionId);
  if (!version) return { status: "not-found" };

  const errors = await idb.byIndex("errors", "by_version", versionId);
  // Both the gate and the destination are properties of the record, so both are
  // read from it here rather than passed in by whichever screen called.
  const outstanding = needsAuthWork(version.form || {}, version.provenance || {});
  const why = refusal(action, {
    status: version.workflow?.status || "finished",
    role,
    errors,
    blocking: 0,
    incomplete: (version.completeness?.blankCount || 0) > 0 && action === "submit",
    authOutcome: (version.form || {}).authStatus || "",
  });
  if (why) return { status: "refused", reason: why };

  const next = {
    ...version,
    workflow: applyTransition(version.workflow, action, { by, note, needsAuthWork: outstanding }),
  };
  await idb.put("versions", next);
  await refreshMirror();
  return { status: "ok", workflow: next.workflow, routedToAuth: next.workflow.status === "auth_pending" };
}

// The authorization stage writes back to the record it belongs to. Deliberately not
// saveVerification: that mints a new version, and chasing an authorization is the
// same piece of work continuing, not a second verification of the same benefits.
export async function updateAuth(versionId, patch, { by = "" } = {}) {
  const version = await idb.get("versions", versionId);
  if (!version) return { status: "not-found" };

  const AUTH_KEYS = ["authNum", "authDates", "authHow", "authAfter", "authWindow", "authStatus"];
  const form = { ...version.form };
  for (const k of AUTH_KEYS) if (patch[k] !== undefined) form[k] = String(patch[k] ?? "").trim();

  const next = {
    ...version, form,
    flags: recordFlags(form),
    authTouchedAt: nowISO(), authTouchedBy: by,
  };
  await idb.put("versions", next);
  await refreshMirror();
  return { status: "ok", form };
}

// A correction is the SAME version put right, not a new one.
//
// Routing it through saveVerification would mint version 2 and leave QA's findings
// attached to version 1 — the return would vanish from the record and the loop
// would never close. So this writes in place, keeps the id, the sequence number,
// the findings and the history, and parks the pre-correction snapshot in
// `correctedFrom` so the original answers are still recoverable.
export async function saveCorrection(versionId, { form, meta, verify, completeness, by = "", note = "" }) {
  const version = await idb.get("versions", versionId);
  if (!version) return { status: "not-found" };

  const errors = await idb.byIndex("errors", "by_version", versionId);
  const why = refusal("submit", { status: version.workflow?.status || "finished", role: "agent", errors });
  if (why) return { status: "refused", reason: why };

  const snapshot = Object.fromEntries(F.map((k) => [k, val(form, k)]));
  const outstanding = needsAuthWork(snapshot, meta || {});
  const next = {
    ...version,
    form: snapshot,
    provenance: meta || version.provenance || {},
    verify: verify || version.verify || {},
    completeness: completeness || version.completeness || {},
    flags: recordFlags(snapshot),
    // Only the first correction records the original. A second one is correcting a
    // correction, and what matters then is still what the record said when QA first
    // saw it.
    correctedFrom: version.correctedFrom || version.form,
    correctedAt: nowISO(),
    correctedBy: by,
    workflow: applyTransition(version.workflow, "submit", {
      by, at: nowISO(), note: note || "corrected", needsAuthWork: outstanding,
    }),
  };

  const kase = await idb.get("cases", version.caseId);
  await idb.tx(["versions", "cases"], "readwrite", (s) => {
    s.versions.put(next);
    // The case's cached "latest" must follow, or the records list keeps showing the
    // uncorrected values.
    if (kase && kase.latestVersionId === versionId) s.cases.put({ ...kase, latest: snapshot, updatedAt: nowISO() });
  });
  await refreshMirror();
  return { status: "ok", workflow: next.workflow, seq: next.seq };
}

// Records waiting on somebody. `status` may be a single value or a list.
export async function listQueue({ status = OPEN_STATUSES, projectName = "", limit = 200 } = {}) {
  const wanted = new Set(Array.isArray(status) ? status : [status]);
  const rows = await listRecent({ limit: 1000 });
  return rows
    .filter((r) => wanted.has(r._status))
    .filter((r) => !projectName || norm(r.projectName) === norm(projectName))
    .slice(0, limit);
}

// One QA finding. `fieldKey` is optional: some errors are about the record as a
// whole ("wrong patient"), not about one box on the form.
export async function addError({ versionId, priority, category = "OTHER", fieldKey = "", note = "", by = "" }) {
  const version = await idb.get("versions", versionId);
  const rec = {
    id: newId("err"), versionId,
    caseId: version?.caseId || "", projectId: version?.form?.projectName || "",
    priority: String(priority || "NONE").toUpperCase(),
    category: String(category || "OTHER").toUpperCase(),
    fieldKey, note,
    // Who the finding is against — the operator, not the checker. Needed to score
    // an operator without re-reading every record the finding hangs off.
    against: version?.form?.username || version?.form?.verifiedBy || "",
    by, at: nowISO(), resolvedAt: "", resolvedBy: "",
  };
  await idb.put("errors", rec);
  await refreshMirror();
  return rec;
}

export async function listErrors({ versionId = "", projectName = "", priority = "", category = "", state = "", against = "", by = "", from = "", to = "" } = {}) {
  const all = versionId ? await idb.byIndex("errors", "by_version", versionId) : await idb.getAll("errors");
  return all
    .filter((e) => !projectName || norm(e.projectId) === norm(projectName))
    .filter((e) => !priority || e.priority === priority)
    .filter((e) => !category || e.category === category)
    .filter((e) => !against || norm(e.against) === norm(against))
    .filter((e) => !by || norm(e.by) === norm(by))
    .filter((e) => !state || (state === "open" ? !e.resolvedAt : !!e.resolvedAt))
    .filter((e) => !from || String(e.at).slice(0, 10) >= from)
    .filter((e) => !to || String(e.at).slice(0, 10) <= to)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Undo for a resolve. Marking something fixed by mistake must not need a delete —
// deleting a finding takes it out of the quality score, which is not the same thing.
export async function reopenError(id) {
  const rec = await idb.get("errors", id);
  if (!rec) return null;
  const next = { ...rec, resolvedAt: "", resolvedBy: "" };
  await idb.put("errors", next);
  await refreshMirror();
  return next;
}

export async function resolveError(id, by = "") {
  const rec = await idb.get("errors", id);
  if (!rec) return null;
  const next = { ...rec, resolvedAt: nowISO(), resolvedBy: by };
  await idb.put("errors", next);
  return next;
}

export const deleteError = (id) => idb.del("errors", id);

// Append-only. A comment thread whose history can be edited is not a record of
// anything, and QA notes are exactly the thing someone would want to soften later.
export async function addComment({ versionId, text, by = "" }) {
  const body = String(text || "").trim();
  if (!body) throw new Error("A comment needs some text");
  const rec = { id: newId("cmt"), versionId, text: body, by, at: nowISO() };
  await idb.put("comments", rec);
  return rec;
}

export const listComments = (versionId) =>
  idb.byIndex("comments", "by_version", versionId)
    .then((rows) => rows.sort((a, b) => String(a.at).localeCompare(String(b.at))));

/* ------------------------------------------------------------------- reads */

export async function listRecent({ limit = 200 } = {}) {
  const [cases, versions, errs, cmts] = await Promise.all(
    [idb.getAll("cases"), idb.getAll("versions"), idb.getAll("errors"), idb.getAll("comments")]);
  const byCase = new Map(cases.map((c) => [c.id, c]));

  // Grouped once rather than looked up per row: a hundred records with findings
  // would otherwise be a hundred index reads to render one table.
  const errsBy = new Map(), cmtsBy = new Map();
  for (const e of errs) errsBy.set(e.versionId, [...(errsBy.get(e.versionId) || []), e]);
  for (const c of cmts) cmtsBy.set(c.versionId, [...(cmtsBy.get(c.versionId) || []), c]);

  return versions
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
    .slice(0, limit)
    .map((v) => {
      const mine = errsBy.get(v.id) || [];
      return toLegacyRow(v, byCase.get(v.caseId), "", {
        errors: mine,
        errorCount: errorCount(mine),
        openCount: unresolved(mine).length,
        topPriority: topPriority(mine),
        score: mine.length ? recordScore(mine) : null,
        comments: cmtsBy.get(v.id) || [],
      });
    });
}

// Free-text lookup over saved records, plus the filters the records screen offers.
// Deliberately a scan rather than an index: the whole point of this tool is that one
// team's year of work fits in one browser, and a scan over a few thousand rows is
// faster than the round trips a multi-index query would cost.
export async function searchRecords({ q = "", projectName = "", status = "", verdict = "", priority = "", from = "", to = "", limit = 500 } = {}) {
  const rows = await listRecent({ limit: 5000 });
  const needle = String(q || "").trim().toLowerCase();
  const hit = (r) => {
    if (!needle) return true;
    return [r.lastName, r.firstName, r.dob, r.policyId, r.groupId, r.insName, r.projectName,
      r.category, r.username, r._qaName, r.authNum, r.callRef, r.repName]
      .some((x) => String(x || "").toLowerCase().includes(needle));
  };
  return rows
    .filter(hit)
    .filter((r) => !projectName || norm(r.projectName) === norm(projectName))
    .filter((r) => !status || r._status === status)
    .filter((r) => !verdict || r._verdict === verdict)
    .filter((r) => !priority || r._topPriority === priority)
    .filter((r) => !from || String(r.today || "") >= from)
    .filter((r) => !to || String(r.today || "") <= to)
    .slice(0, limit);
}

export const getVersion = (id) => idb.get("versions", id);
export const getTranscript = async (versionId) => (await idb.get("transcripts", versionId))?.text || "";

export async function deleteVersion(id) {
  const version = await idb.get("versions", id);
  if (!version) return;
  const rest = (await idb.byIndex("versions", "by_case", version.caseId)).filter((v) => v.id !== id);
  const kase = await idb.get("cases", version.caseId);
  const newest = rest.sort((a, b) => a.seq - b.seq).pop() || null;
  // QA findings and comments belong to the record. Left behind they would be
  // orphans that still count on the dashboard.
  const [errs, cmts] = await Promise.all([
    idb.byIndex("errors", "by_version", id), idb.byIndex("comments", "by_version", id)]);
  await idb.tx(["versions", "transcripts", "cases", "errors", "comments"], "readwrite", (s) => {
    s.versions.delete(id);
    s.transcripts.delete(id);
    for (const e of errs) s.errors.delete(e.id);
    for (const c of cmts) s.comments.delete(c.id);
    if (!kase) return;
    if (!rest.length) s.cases.delete(kase.id);
    else s.cases.put({ ...kase, versionCount: rest.length, latest: newest.form, latestVersionId: newest.id, lastVerifiedAt: newest.verifiedOn });
  });
  await refreshMirror();
}

export async function clearAll() {
  await idb.tx(["patients", "carriers", "cases", "versions", "transcripts", "imports", "errors", "comments"], "readwrite", (s) => {
    for (const k of Object.keys(s)) s[k].clear();
  });
  storeLegacy([]);
}

/* ------------------------------------------------------------------ import */

// Rows land in patients/carriers; only the mapping and the counts are kept in
// `imports`. Prefill reads patients/carriers and never the import, which is what
// keeps precedence a simple static table instead of a search across sources.
//
// Existing values win by default. A stale roster must not overwrite something a
// call confirmed — it only fills what is blank.
export async function applyImport({ kind, rows, mapping, fileName, sheetName }) {
  const patients = await idb.getAll("patients");
  const carriers = await idb.getAll("carriers");
  const byPatient = new Map(patients.map((p) => [p.key, p]));
  const byCarrier = new Map(carriers.map((c) => [c.key, c]));

  const writes = { patients: [], carriers: [] };
  const counts = { created: 0, updated: 0, skipped: 0 };

  for (const row of rows) {
    const v = row.values || {};
    if (row.action === "skip") { counts.skipped++; continue; }

    if (kind === "carriers") {
      const key = carrierKey(v.insName);
      if (!key) { counts.skipped++; continue; }
      const existing = byCarrier.get(key);
      const rec = existing
        ? { ...existing, updatedAt: nowISO() }
        : { id: newId("car"), key, name: v.insName, aliases: [], fieldsUpdatedAt: {}, confirmCount: {}, createdAt: nowISO(), updatedAt: nowISO(), source: "import" };
      let touched = !existing;
      for (const f of CARRIER_FIELDS) {
        if (v[f] && !rec[f]) { rec[f] = v[f]; rec.fieldsUpdatedAt = { ...rec.fieldsUpdatedAt, [f]: nowISO() }; touched = true; }
      }
      if (touched) { writes.carriers.push(rec); byCarrier.set(key, rec); existing ? counts.updated++ : counts.created++; }
      else counts.skipped++;
      continue;
    }

    const key = patientKey(v);
    const existing = byPatient.get(key);
    if (existing) {
      const rec = { ...existing };
      let touched = false;
      for (const f of ["lastName", "firstName", "dob"]) if (v[f] && !rec[f]) { rec[f] = v[f]; touched = true; }
      if (touched) { rec.updatedAt = nowISO(); rec.provisional = isProvisional(rec); writes.patients.push(rec); counts.updated++; }
      else counts.skipped++;
      continue;
    }
    const rec = {
      id: newId("pat"), key,
      lastName: v.lastName || "", firstName: v.firstName || "", dob: v.dob || "",
      lastNameNorm: norm(v.lastName), provisional: isProvisional(v),
      createdAt: nowISO(), updatedAt: nowISO(), source: "import",
    };
    writes.patients.push(rec);
    byPatient.set(key, rec);
    counts.created++;
  }

  const record = {
    id: newId("imp"), fileName: fileName || "", sheetName: sheetName || "", kind,
    mapping, rowCount: rows.length, counts, importedAt: nowISO(),
  };

  await idb.tx(["patients", "carriers", "imports"], "readwrite", (s) => {
    for (const p of writes.patients) s.patients.put(p);
    for (const c of writes.carriers) s.carriers.put(c);
    s.imports.put(record);
  });
  return counts;
}

export const listImports = () => idb.getAll("imports");

// The keys parseRows() needs in order to flag a row as already on file.
export async function patientKeySet() {
  return new Set((await idb.getAll("patients")).map((p) => p.key));
}

/* ------------------------------------------------------------------ backup */

export async function exportAll() {
  const names = ["patients", "carriers", "cases", "versions", "transcripts", "imports", "projects", "users", "errors", "comments"];
  const data = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await idb.getAll(n)])));
  await idb.setMeta("lastBackupAt", nowISO());
  return { app: "us24-vob", schemaVersion: 2, exportedAt: nowISO(), ...data };
}

export async function importAll(bundle, { mode = "merge" } = {}) {
  const names = ["patients", "carriers", "cases", "versions", "transcripts", "imports", "projects", "users", "errors", "comments"];
  await idb.tx(names, "readwrite", (s) => {
    for (const n of names) {
      if (mode === "replace") s[n].clear();
      for (const rec of bundle[n] || []) s[n].put(rec);
    }
  });
  await refreshMirror();
}

export const lastBackupAt = () => idb.getMeta("lastBackupAt");

/* ------------------------------------------------------------------ mirror */

// localStorage keeps a slim, transcript-free copy so the legacy standalone
// US24_VOB_Generator_5.html still lists and exports records — while the ~5 MB
// quota, which a dozen long transcripts used to exhaust, stops being a factor.
async function refreshMirror() {
  try {
    const rows = await listRecent({ limit: MIRROR_ROWS });
    // The findings and comments are joined data, not part of the legacy row shape,
    // and they are the fastest way back to a full localStorage quota.
    const slim = rows.map((r) => ({ ...r, _transcript: "", _errors: [], _comments: [], _workflow: undefined, _flags: undefined }));
    try { storeLegacy(slim); }
    catch { try { storeLegacy(slim.slice(0, 20)); } catch { storeLegacy([]); } }
  } catch { /* the mirror is a convenience; never fail a save over it */ }
}
