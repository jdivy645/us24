// Deciding when two records are the same patient, payer or case. Pure functions
// only — every rule here is testable without a database.
//
// The governing principle: a duplicate is visible and cheap to fix, a wrong merge
// silently interleaves two patients' financial histories and is close to
// impossible to spot afterwards. So these functions identify candidates; they
// never merge on their own.

export const norm = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");

// Identity is last + first + DOB. Without a DOB the key collides across genuinely
// different people ("SMITH|JOHN|"), so callers must treat those as provisional.
export const patientKey = (p) => `${norm(p.lastName)}|${norm(p.firstName)}|${(p.dob || "").trim()}`;
export const isProvisional = (p) => !(p.dob || "").trim();

export const carrierKey = (name) => norm(name);

// Policy IDs are written with spaces, dashes and case at random.
export const policyKey = (s) => norm(s);

// "PT/OT" and "OT/PT" are the same pair of disciplines; "PT" alone is not.
export const serviceKey = (s) =>
  String(s || "").toUpperCase().split(/[^A-Z]+/).filter(Boolean).sort().join("/") || "PT";

export const caseKey = (patientId, carrierId, policyId, serviceType) =>
  `${patientId}|${carrierId}|${policyKey(policyId)}|${serviceKey(serviceType)}`;

// Bounded edit distance — returns true when a and b are within `max` edits.
export function editDistanceAtMost(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[n] <= max;
}

// Does `b` look like a mistyping of `a`? Deliberately quiet: a one-digit slip in a
// long member ID splits a patient's history in two, but short codes collide by
// coincidence far too often to guess at.
export function similarPolicy(a, b) {
  const x = policyKey(a), y = policyKey(b);
  if (!x || !y || x === y) return false;
  if (x.length < 6 || y.length < 6) return false;
  if (Math.abs(x.length - y.length) > 2) return false;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  return editDistanceAtMost(x, y, 2);
}

// TAJ / TAJUDEEN is one person recorded two ways. ROBERT / RICHARD is not.
export function looksSameName(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  return x.length >= 4 && y.length >= 4 && editDistanceAtMost(x, y, 1);
}

// Candidate cases that may really be the one being verified. Reasons are ranked so
// the caller can say WHY it is asking, which is what makes the prompt answerable.
export function findSimilarCases(cases, { patientId, carrierId, policyId, serviceType }) {
  const out = [];
  for (const c of cases) {
    if (c.patientId !== patientId) continue;
    if (c.carrierId === carrierId && c.policyKey === policyKey(policyId)) {
      if (c.serviceKey !== serviceKey(serviceType)) out.push({ case: c, reason: "other-service", score: 0.9 });
      continue;
    }
    if (c.carrierId === carrierId && similarPolicy(c.policyId, policyId)) {
      out.push({ case: c, reason: "policy-typo", score: 0.8 });
      continue;
    }
    if (c.carrierId !== carrierId) out.push({ case: c, reason: "other-carrier", score: 0.3 });
  }
  return out.sort((a, b) => b.score - a.score);
}
