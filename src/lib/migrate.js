// Folding the flat localStorage log into patients / carriers / cases / versions.
//
// Pure: takes the old rows, returns the new records. runMigration() in db.js is the
// thin shell that writes them. That split is what makes this testable, and it is
// worth testing — it runs once, on data that cannot be regenerated.
import { F } from "../data/fields.js";
import { patientKey, carrierKey, policyKey, serviceKey, caseKey, norm, isProvisional } from "./identity.js";
import { CARRIER_FIELDS } from "./schema.js";
import { changedKeys } from "./history.js";

const val = (r, k) => String(r[k] ?? "").trim();

// Deterministic ids so a re-run produces the same graph rather than duplicates.
const idFor = (prefix, key) => `${prefix}_${norm(key).slice(0, 48) || "x"}`;

const parseSavedAt = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export function migrateLegacy(rows, { now = "1970-01-01T00:00:00.000Z" } = {}) {
  const patients = new Map(), carriers = new Map(), cases = new Map();
  const versions = [], transcripts = [];

  // The log is newest-first; walk it oldest-first so seq ascends naturally.
  const ordered = [...(rows || [])].reverse();

  for (const r of ordered) {
    if (!r || typeof r !== "object") continue;

    const pk = patientKey(r);
    if (!patients.has(pk)) {
      patients.set(pk, {
        id: idFor("pat", pk), key: pk,
        lastName: val(r, "lastName"), firstName: val(r, "firstName"), dob: val(r, "dob"),
        lastNameNorm: norm(r.lastName), provisional: isProvisional(r),
        createdAt: parseSavedAt(r._savedAt) || now, updatedAt: parseSavedAt(r._savedAt) || now,
        source: "legacy",
      });
    }
    const patient = patients.get(pk);

    const ck = carrierKey(r.insName) || "UNKNOWN";
    if (!carriers.has(ck)) {
      carriers.set(ck, {
        id: idFor("car", ck), key: ck, name: val(r, "insName") || "UNKNOWN",
        aliases: [], fieldsUpdatedAt: {}, confirmCount: {},
        createdAt: now, updatedAt: now, source: "legacy",
      });
    }
    const carrier = carriers.get(ck);
    // Seeding the carrier master from history is what makes the feature useful on
    // day one instead of after fifty more calls.
    for (const key of CARRIER_FIELDS) {
      const value = val(r, key);
      if (value && !carrier[key]) {
        carrier[key] = value;
        carrier.fieldsUpdatedAt[key] = parseSavedAt(r._savedAt) || now;
      }
    }

    const key = caseKey(patient.id, carrier.id, r.policyId, r.serviceType);
    if (!cases.has(key)) {
      cases.set(key, {
        id: idFor("case", key), caseKey: key,
        patientId: patient.id, carrierId: carrier.id,
        policyId: val(r, "policyId"), policyKey: policyKey(r.policyId),
        groupId: val(r, "groupId"), planType: val(r, "planType"),
        serviceType: val(r, "serviceType") || "PT", serviceKey: serviceKey(r.serviceType),
        versionCount: 0, latest: null, latestVersionId: null,
        firstVerifiedAt: "", lastVerifiedAt: "", policyHistory: [],
        archived: false, createdAt: now, updatedAt: now,
      });
    }
    const kase = cases.get(key);

    const form = Object.fromEntries(F.map((k) => [k, val(r, k)]));
    const prev = versions.filter((x) => x.caseId === kase.id).pop();
    // Reusing _id as the version id is what keeps any audio blob saved under it
    // reachable, with nothing to move.
    const id = r._id || idFor("ver", key + "|" + (kase.versionCount + 1));

    versions.push({
      id, caseId: kase.id, seq: kase.versionCount + 1,
      verifiedOn: val(r, "today") || (parseSavedAt(r._savedAt) || now).slice(0, 10),
      savedAt: parseSavedAt(r._savedAt) || now,
      savedAtLabel: val(r, "_savedAt"),
      form,
      changed: prev ? changedKeys(prev.form, form) : [],
      provenance: r._meta || {},
      verify: {
        verdict: r._verdict || "", matched: r._matched ?? 0, total: r._total ?? 0,
        missing: r._missing || [], mismatch: r._mismatch || [],
        bypassed: r._bypassed || [], carrier: r._carrier || [],
      },
      completeness: { blank: r._blank || [], blankCount: r._blankCount ?? 0, required: r._required ?? 0 },
      file: val(r, "_file"), source: val(r, "_source"),
      audioFile: val(r, "_audioFile"), hasAudio: !!val(r, "_audioFile"),
      hasTranscript: !!val(r, "_transcript"),
    });

    if (r._transcript) transcripts.push({ id, text: String(r._transcript) });

    kase.versionCount += 1;
    kase.latest = form;
    kase.latestVersionId = id;
    kase.lastVerifiedAt = versions[versions.length - 1].verifiedOn;
    if (!kase.firstVerifiedAt) kase.firstVerifiedAt = kase.lastVerifiedAt;
    kase.updatedAt = versions[versions.length - 1].savedAt;
  }

  return {
    patients: [...patients.values()],
    carriers: [...carriers.values()],
    cases: [...cases.values()],
    versions,
    transcripts,
  };
}

// The flat row shape the Excel export and the legacy standalone HTML understand.
//
// `extra` carries the counts that live in other stores (QA findings, comments). The
// caller passes them because looking them up here would mean a database read per
// row — and this function has to stay pure enough to test without one.
export function toLegacyRow(version, kase, transcriptText = "", extra = {}) {
  const v = version.verify || {}, c = version.completeness || {};
  const w = version.workflow || {};
  const f = version.flags || {};
  return {
    ...version.form,
    // Written after the save, so they are envelope fields rather than form fields.
    _status: w.status || "finished", _qaName: w.qaName || "",
    _submittedAt: w.submittedAt || "", _qaAt: w.qaAt || "", _finishedAt: w.finishedAt || "",
    _workflow: w,
    _authRequired: f.authRequired ? "YES" : "NO",
    _flags: f,
    _errorCount: extra.errorCount ?? 0, _topPriority: extra.topPriority || "",
    _errors: extra.errors || [], _comments: extra.comments || [],
    _id: version.id, _savedAt: version.savedAtLabel || version.savedAt, _file: version.file,
    _verdict: v.verdict, _matched: v.matched, _total: v.total,
    _missing: v.missing, _mismatch: v.mismatch, _bypassed: v.bypassed, _carrier: v.carrier,
    _blank: c.blank, _blankCount: c.blankCount, _required: c.required,
    // The transcript itself lives in its own store and is loaded on demand, so the
    // row carries only whether there is one to load.
    _transcript: transcriptText, _hasTranscript: !!version.hasTranscript, _source: version.source,
    _audioFile: version.audioFile, _meta: version.provenance,
    _caseId: version.caseId, _seq: version.seq, _versionCount: kase ? kase.versionCount : 1,
  };
}
